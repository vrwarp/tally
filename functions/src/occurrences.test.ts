/**
 * Materialising one occurrence, driven against the in-memory Firestore.
 *
 * The projection itself is tested exhaustively on the app side — this file's
 * job is the parts that only exist on a server: decoding stored documents, the
 * create-only write, and the property the whole design rests on. Any active
 * member may call this, so what it *refuses* is load-bearing: a request names a
 * chain and an instant and nothing else, and anything the projection does not
 * independently recognise has to come back as a refusal rather than a document.
 */
import { describe, expect, it } from 'vitest';
import {
  materializeOccurrence,
  pruneMaterializedOccurrences,
  repairDetachedOccurrences,
  EVENTS,
  MINISTRY_TIME_ZONE,
} from './occurrences.js';
import { SILENT_LOGGER } from './firestore.js';
import { FakeFirestore } from './testing/fakeFirestore.js';

/** Fri 24 Jul 2026, 19:00 local. */
const FRIDAY = new Date(2026, 6, 24, 19, 0);
/** The Friday after it — the one a counselor is standing in front of. */
const NEXT_FRIDAY = new Date(2026, 6, 31, 19, 0);

const CHAIN = 'friday-fellowship';
const UID = 'counselor-1';

const WEEKLY_FRIDAY = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [5],
  monthlyMode: 'dayOfMonth',
  until: null,
  count: null,
};

function eventDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const startAt = (overrides.startAt as Date) ?? FRIDAY;
  const endAt = (overrides.endAt as Date) ?? new Date(startAt.getTime() + 2 * 3_600_000);

  return {
    title: 'Friday Fellowship',
    mode: 'recurring',
    seriesId: 'friday-fellowship',
    recurrence: WEEKLY_FRIDAY,
    recurrenceRootId: null,
    startAt,
    endAt,
    checkInOpensAt: new Date(startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(endAt.getTime() + 3_600_000),
    location: 'Fellowship Hall',
    notes: null,
    status: 'scheduled',
    ...overrides,
  };
}

function seeded(overrides: Record<string, unknown> = {}): FakeFirestore {
  const db = new FakeFirestore();
  db.seed(`${EVENTS}/friday-fellowship-2026-07-24`, eventDoc(overrides));
  return db;
}

function eventIds(db: FakeFirestore): string[] {
  return [...db.data.keys()]
    .filter((key) => key.startsWith(`${EVENTS}/`))
    .map((key) => key.slice(EVENTS.length + 1))
    .sort();
}

/** The common case: a counselor opens check-in on a projected Friday. */
function materialize(
  db: FakeFirestore,
  startAt: Date = NEXT_FRIDAY,
  chain: string = CHAIN,
  now: Date = FRIDAY,
) {
  return materializeOccurrence(db, { chain, startAt, uid: UID }, now, SILENT_LOGGER);
}

describe('materializeOccurrence', () => {
  it('writes down the one gathering it was asked for, and no others', async () => {
    const db = seeded();
    const result = await materialize(db);

    expect(result).toEqual({ id: 'friday-fellowship-2026-07-31', created: true });
    // The point of the whole migration: the rest of the horizon stays computed.
    expect(eventIds(db)).toEqual([
      'friday-fellowship-2026-07-24',
      'friday-fellowship-2026-07-31',
    ]);
  });

  it('derives the gathering from the chain, not from the request', async () => {
    const db = seeded();
    await materialize(db);

    const next = db.get(`${EVENTS}/friday-fellowship-2026-07-31`);
    expect(next?.title).toBe('Friday Fellowship');
    expect(next?.location).toBe('Fellowship Hall');
    expect(next?.seriesId).toBe('friday-fellowship');
    expect(next?.recurrence).toEqual(WEEKLY_FRIDAY);
    // The chain's root, so the ids stay derivable from here on.
    expect(next?.recurrenceRootId).toBe('friday-fellowship-2026-07-24');
    expect(next?.startAt).toEqual(NEXT_FRIDAY);
    expect(next?.endAt).toEqual(new Date(2026, 6, 31, 21, 0));
    expect(next?.checkInOpensAt).toEqual(new Date(2026, 6, 31, 18, 0));
    expect(next?.status).toBe('scheduled');
    // A recurring gathering is never an RSVP list.
    expect(next?.requiresRsvp).toBe(false);
    // Somebody did press something, and it was them.
    expect(next?.createdBy).toBe(UID);
  });

  it('refuses a date the rule does not land on', async () => {
    const db = seeded();

    // A Thursday, and a Friday from before the chain began. This is the check
    // that stops a counselor's client inventing a gathering — or backdating one
    // and filing attendance under it.
    expect(await materialize(db, new Date(2026, 6, 30, 19, 0))).toBeNull();
    expect(await materialize(db, new Date(2026, 6, 17, 19, 0))).toBeNull();
    expect(eventIds(db)).toEqual(['friday-fellowship-2026-07-24']);
  });

  it('refuses a chain that does not exist', async () => {
    const db = seeded();
    expect(await materialize(db, NEXT_FRIDAY, 'sunday-school')).toBeNull();
    expect(eventIds(db)).toEqual(['friday-fellowship-2026-07-24']);
  });

  it('refuses one past the horizon', async () => {
    const db = seeded();
    expect(await materialize(db, new Date(2027, 6, 30, 19, 0))).toBeNull();
  });

  it('refuses a gathering the rule stopped describing', async () => {
    // A leader turned the weekly gathering monthly while a counselor's screen
    // still showed the old Fridays. Their tap must not restore one.
    const db = seeded({
      recurrence: { ...WEEKLY_FRIDAY, frequency: 'monthly', weekdays: [] },
    });

    expect(await materialize(db)).toBeNull();
    expect(await materialize(db, new Date(2026, 7, 24, 19, 0))).not.toBeNull();
  });

  it('is idempotent — a second tap addresses the same document', async () => {
    const db = seeded();
    await materialize(db);
    const after = db.writes.length;

    // "Make sure it exists" succeeds when it already does. A screen holding a
    // copy from before another device materialised the night would otherwise
    // have its check-in refused.
    const again = await materialize(db);

    expect(again).toEqual({ id: 'friday-fellowship-2026-07-31', created: false });
    expect(db.writes.length).toBe(after);
  });

  it('reports a document written *during* the call rather than failing', async () => {
    const db = seeded();

    // The genuine race: two counselors tap at the same instant, so `create` is
    // what discovers the collision. The id is derived, so they addressed the
    // same document and it already says what this would have said.
    const contended = `${EVENTS}/friday-fellowship-2026-07-31`;
    const racing = {
      ...db,
      collection: (path: string) => db.collection(path),
      doc: (path: string) => {
        const ref = db.doc(path);
        if (path !== contended) return ref;
        return {
          ...ref,
          create: async () => {
            const error = new Error('ALREADY_EXISTS') as Error & { code?: number };
            error.code = 6;
            throw error;
          },
        };
      },
      batch: () => db.batch(),
    };

    expect(await materialize(racing as unknown as FakeFirestore)).toEqual({
      id: 'friday-fellowship-2026-07-31',
      created: false,
    });
  });

  it('never overwrites a gathering somebody moved on purpose', async () => {
    const db = seeded();
    // Materialised for the 31st, then pushed back half an hour.
    db.seed(
      `${EVENTS}/friday-fellowship-2026-07-31`,
      eventDoc({ startAt: new Date(2026, 6, 31, 19, 30), location: 'Youth room' }),
    );

    // The document is handed back as it stands. Nothing is written, so the
    // half hour and the room a leader chose survive.
    expect(await materialize(db)).toEqual({
      id: 'friday-fellowship-2026-07-31',
      created: false,
    });
    expect(db.get(`${EVENTS}/friday-fellowship-2026-07-31`)?.startAt).toEqual(
      new Date(2026, 6, 31, 19, 30),
    );
    expect(db.get(`${EVENTS}/friday-fellowship-2026-07-31`)?.location).toBe('Youth room');
  });

  it('does not resurrect a cancelled gathering', async () => {
    const db = seeded();
    db.seed(
      `${EVENTS}/friday-fellowship-2026-07-31`,
      eventDoc({ startAt: NEXT_FRIDAY, status: 'cancelled' }),
    );

    expect(await materialize(db)).toEqual({
      id: 'friday-fellowship-2026-07-31',
      created: false,
    });
    expect(db.get(`${EVENTS}/friday-fellowship-2026-07-31`)?.status).toBe('cancelled');
  });

  it('leaves one-offs and rule-less events out of the projection', async () => {
    const db = new FakeFirestore();
    db.seed(`${EVENTS}/retreat`, eventDoc({ mode: 'oneoff', seriesId: null, recurrence: null }));

    expect(await materialize(db, NEXT_FRIDAY, 'retreat')).toBeNull();
    expect(eventIds(db)).toEqual(['retreat']);
  });

  it('skips a document with no usable schedule instead of projecting the epoch', async () => {
    const db = seeded();
    db.seed(`${EVENTS}/corrupt`, { title: 'No dates', mode: 'recurring' });

    const warnings: string[] = [];
    const result = await materializeOccurrence(
      db,
      { chain: CHAIN, startAt: NEXT_FRIDAY, uid: UID },
      FRIDAY,
      { ...SILENT_LOGGER, warn: (message) => warnings.push(message) },
    );

    expect(warnings).toHaveLength(1);
    // The healthy chain still resolved.
    expect(result?.created).toBe(true);
  });

  it('reads a legacy "daily" rule as every weekday', async () => {
    const db = seeded({ recurrence: { frequency: 'daily', interval: 1 } });

    // The Saturday after: only a rule meaning every weekday puts one there.
    expect(await materialize(db, new Date(2026, 6, 25, 19, 0))).toEqual({
      id: 'friday-fellowship-2026-07-25',
      created: true,
    });
  });

  it("writes wall-clock times in the ministry's timezone, not the container's", async () => {
    // The failure this guards: a Cloud Functions container is UTC, and the
    // expander builds dates with the local-time constructor. Without the TZ the
    // entry point sets from MINISTRY_TIME_ZONE, a 19:00 Friday would be written
    // as 19:00 UTC — lunchtime in Hayward, and the wrong calendar day either
    // side of a clock change.
    const original = process.env.TZ;
    try {
      process.env.TZ = MINISTRY_TIME_ZONE;
      const friday = new Date(2026, 6, 24, 19, 0);
      const db = new FakeFirestore();
      db.seed(`${EVENTS}/friday-fellowship-2026-07-24`, eventDoc({ startAt: friday }));

      await materialize(db, new Date(2026, 6, 31, 19, 0), CHAIN, friday);

      // 19:00 Pacific on the Friday, which is 02:00Z the next morning.
      const next = db.get(`${EVENTS}/friday-fellowship-2026-07-31`)?.startAt as Date;
      expect(next.toISOString()).toBe('2026-08-01T02:00:00.000Z');
    } finally {
      process.env.TZ = original;
    }
  });

  it('holds the same evening across the autumn clock change', async () => {
    // Pacific goes back an hour on 1 November 2026. A 19:00 gathering on the
    // Friday before has to still be a 19:00 gathering on the Friday after —
    // the whole reason dates are built locally rather than by adding 604800000
    // milliseconds to the last one.
    const original = process.env.TZ;
    try {
      process.env.TZ = MINISTRY_TIME_ZONE;
      const beforeChange = new Date(2026, 9, 30, 19, 0); // Fri 30 Oct, PDT
      const db = new FakeFirestore();
      db.seed(`${EVENTS}/friday-fellowship-2026-10-30`, eventDoc({ startAt: beforeChange }));

      await materialize(db, new Date(2026, 10, 6, 19, 0), CHAIN, beforeChange);

      const after = db.get(`${EVENTS}/friday-fellowship-2026-11-06`)?.startAt as Date;
      expect(after.getHours()).toBe(19);
      // An hour further from UTC than the one before it: PDT became PST.
      expect(after.toISOString()).toBe('2026-11-07T03:00:00.000Z');
    } finally {
      process.env.TZ = original;
    }
  });

  it('ignores history older than the lookback', async () => {
    const db = new FakeFirestore();
    const ancient = new Date(2024, 0, 5, 19, 0);
    db.seed(`${EVENTS}/friday-fellowship-2024-01-05`, eventDoc({ startAt: ancient }));

    // The chain is real, but nothing recent enough to project from was read.
    expect(await materialize(db)).toBeNull();
  });
});

describe('pruneMaterializedOccurrences', () => {
  /** A chain with history behind it and the old horizon written out ahead. */
  function writtenAhead(): FakeFirestore {
    const db = new FakeFirestore();
    // Two Fridays already held, then the eight the sweep used to write.
    for (const day of [10, 17, 24]) {
      const startAt = new Date(2026, 6, day, 19, 0);
      db.seed(`${EVENTS}/friday-fellowship-2026-07-${day}`, eventDoc({ startAt }));
    }
    for (const [month, day] of [
      [6, 31],
      [7, 7],
      [7, 14],
      [7, 21],
      [7, 28],
      [8, 4],
      [8, 11],
      [8, 18],
    ] as const) {
      const startAt = new Date(2026, month, day, 19, 0);
      const id = `friday-fellowship-2026-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      db.seed(`${EVENTS}/${id}`, eventDoc({ startAt }));
    }
    return db;
  }

  it('reports without writing unless told to apply', async () => {
    const db = writtenAhead();
    const result = await pruneMaterializedOccurrences(db, FRIDAY, SILENT_LOGGER);

    expect(result.pruned).toHaveLength(8);
    expect(db.writes).toHaveLength(0);
    expect(eventIds(db)).toHaveLength(11);
  });

  it('hands the calendar ahead back to the projection', async () => {
    const db = writtenAhead();
    await pruneMaterializedOccurrences(db, FRIDAY, SILENT_LOGGER, { apply: true });

    // Only what actually happened is left standing.
    expect(eventIds(db)).toEqual([
      'friday-fellowship-2026-07-10',
      'friday-fellowship-2026-07-17',
      'friday-fellowship-2026-07-24',
    ]);
  });

  it('keeps a gathering somebody was checked in to', async () => {
    const db = writtenAhead();
    db.seed(`${EVENTS}/friday-fellowship-2026-08-07/attendance/student-1`, {
      studentId: 'student-1',
    });

    const result = await pruneMaterializedOccurrences(db, FRIDAY, SILENT_LOGGER, { apply: true });

    expect(result.attended).toEqual(['friday-fellowship-2026-08-07']);
    expect(eventIds(db)).toContain('friday-fellowship-2026-08-07');
  });

  it('keeps one somebody moved, and one somebody called off', async () => {
    const db = writtenAhead();
    // Dragged to the Saturday: its id no longer derives from its own date.
    db.seed(
      `${EVENTS}/friday-fellowship-2026-08-07`,
      eventDoc({ startAt: new Date(2026, 7, 8, 19, 0) }),
    );
    db.seed(
      `${EVENTS}/friday-fellowship-2026-08-14`,
      eventDoc({ startAt: new Date(2026, 7, 14, 19, 0), status: 'cancelled' }),
    );

    await pruneMaterializedOccurrences(db, FRIDAY, SILENT_LOGGER, { apply: true });

    expect(eventIds(db)).toContain('friday-fellowship-2026-08-07');
    expect(eventIds(db)).toContain('friday-fellowship-2026-08-14');
  });

  it('never strands a chain with nothing to project from', async () => {
    // A weekly gathering created last week for next Friday: every instance of
    // it is still ahead, so pruning them all would erase the series.
    const db = new FakeFirestore();
    db.seed(`${EVENTS}/friday-fellowship-2026-07-31`, eventDoc({ startAt: NEXT_FRIDAY }));

    const result = await pruneMaterializedOccurrences(db, FRIDAY, SILENT_LOGGER, { apply: true });

    expect(result.pruned).toEqual([]);
    expect(result.retained).toEqual(['friday-fellowship-2026-07-31']);
    expect(eventIds(db)).toEqual(['friday-fellowship-2026-07-31']);
  });

  it('leaves history and one-offs alone', async () => {
    const db = writtenAhead();
    db.seed(
      `${EVENTS}/retreat`,
      eventDoc({ mode: 'oneoff', seriesId: null, recurrence: null, startAt: NEXT_FRIDAY }),
    );

    await pruneMaterializedOccurrences(db, FRIDAY, SILENT_LOGGER, { apply: true });

    expect(eventIds(db)).toContain('retreat');
    expect(eventIds(db)).toContain('friday-fellowship-2026-07-10');
  });
});

/*
 * The documents an edit detached before the editor stopped detaching them.
 *
 * `chainKey` reads `seriesId ?? recurrenceRootId ?? id`, so an instance that
 * lost both references became a chain of one carrying the same weekly rule —
 * projected alongside the chain it came from, invisible to that chain's
 * history, and outside its access list. Nothing on a screen can put it back:
 * the editor has no field for a recurrence root, and it would be the wrong
 * place for one.
 */
describe('repairDetachedOccurrences', () => {
  /** A root and three of its Fridays, the middle one detached by an edit. */
  function detached(): FakeFirestore {
    const db = new FakeFirestore();
    db.seed(`${EVENTS}/saturday-root`, eventDoc({ seriesId: null, recurrenceRootId: null }));
    for (const day of [10, 17, 24]) {
      db.seed(
        `${EVENTS}/saturday-root-2026-07-${day}`,
        eventDoc({
          seriesId: null,
          // 17 July is the one somebody edited.
          recurrenceRootId: day === 17 ? null : 'saturday-root',
          startAt: new Date(2026, 6, day, 19, 0),
        }),
      );
    }
    return db;
  }

  it('reports without writing unless told to apply', async () => {
    const db = detached();
    const result = await repairDetachedOccurrences(db, SILENT_LOGGER);

    expect(result.repaired).toEqual([
      { id: 'saturday-root-2026-07-17', chain: 'saturday-root' },
    ]);
    expect(db.writes).toHaveLength(0);
  });

  it('puts the instance back into the chain its id names', async () => {
    const db = detached();
    await repairDetachedOccurrences(db, SILENT_LOGGER, { apply: true });

    expect(db.data.get(`${EVENTS}/saturday-root-2026-07-17`)?.recurrenceRootId).toBe(
      'saturday-root',
    );
  });

  it('leaves alone everything that still has a chain of its own', async () => {
    const db = detached();
    // An instance keyed on its series, which is what most of the calendar is.
    db.seed(`${EVENTS}/friday-fellowship-2026-07-24`, eventDoc({ recurrenceRootId: null }));

    const result = await repairDetachedOccurrences(db, SILENT_LOGGER, { apply: true });

    expect(result.repaired.map((entry) => entry.id)).toEqual(['saturday-root-2026-07-17']);
    // The root is a root: null is what it should say.
    expect(db.data.get(`${EVENTS}/saturday-root`)?.recurrenceRootId).toBeNull();
    // And a series-keyed instance is not missing a root, it does not need one.
    expect(db.data.get(`${EVENTS}/friday-fellowship-2026-07-24`)?.recurrenceRootId).toBeNull();
  });

  it('does not touch a one-off, which is keyed on itself by design', async () => {
    const db = new FakeFirestore();
    db.seed(`${EVENTS}/saturday-root`, eventDoc({ seriesId: null, recurrenceRootId: null }));
    db.seed(
      `${EVENTS}/saturday-root-2026-07-17`,
      eventDoc({ mode: 'oneoff', seriesId: null, recurrenceRootId: null, recurrence: null }),
    );

    const result = await repairDetachedOccurrences(db, SILENT_LOGGER, { apply: true });

    expect(result.repaired).toEqual([]);
    expect(db.writes).toHaveLength(0);
  });

  /*
   * A title ending in a date is a real thing a leader types — "Summer Camp
   * 2026-07-17" — and it is not a detached occurrence. Guessing wrong here
   * would file a standalone gathering under a chain that has nothing to do
   * with it, so an unrecognised prefix is reported instead.
   */
  it('refuses to guess when the id names a chain nothing else knows about', async () => {
    const db = new FakeFirestore();
    db.seed(
      `${EVENTS}/summer-camp-2026-07-17`,
      eventDoc({ seriesId: null, recurrenceRootId: null }),
    );

    const result = await repairDetachedOccurrences(db, SILENT_LOGGER, { apply: true });

    expect(result.repaired).toEqual([]);
    expect(result.unknown).toEqual(['summer-camp-2026-07-17']);
    expect(db.writes).toHaveLength(0);
  });

  it('is safe to run twice', async () => {
    const db = detached();
    await repairDetachedOccurrences(db, SILENT_LOGGER, { apply: true });
    const second = await repairDetachedOccurrences(db, SILENT_LOGGER, { apply: true });

    expect(second.repaired).toEqual([]);
  });

  /*
   * A chain whose root was deleted still has instances that were never
   * detached, and their `recurrenceRootId` is enough to recognise the name.
   */
  it('recognises a chain that only its surviving instances still name', async () => {
    const db = new FakeFirestore();
    db.seed(
      `${EVENTS}/saturday-root-2026-07-10`,
      eventDoc({ seriesId: null, recurrenceRootId: 'saturday-root' }),
    );
    db.seed(
      `${EVENTS}/saturday-root-2026-07-17`,
      eventDoc({ seriesId: null, recurrenceRootId: null }),
    );

    const result = await repairDetachedOccurrences(db, SILENT_LOGGER, { apply: true });

    expect(result.repaired).toEqual([
      { id: 'saturday-root-2026-07-17', chain: 'saturday-root' },
    ]);
  });
});
