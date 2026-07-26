/**
 * The nightly occurrence sweep, driven against the in-memory Firestore.
 *
 * The expansion itself is tested exhaustively on the app side — this file's job
 * is the parts that only exist on a server: decoding stored documents, the
 * create-only write, and the properties that make a job safe to run every
 * night forever. Chiefly: running it twice must write nothing the second time.
 */
import { describe, expect, it } from 'vitest';
import { materializeDueOccurrences, EVENTS } from './occurrences.js';
import { SILENT_LOGGER } from './firestore.js';
import { FakeFirestore } from './testing/fakeFirestore.js';

/** Fri 24 Jul 2026, 19:00 local. */
const FRIDAY = new Date(2026, 6, 24, 19, 0);

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
    defaultGroupingMode: 'all',
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

describe('materializeDueOccurrences', () => {
  it('writes the horizon down from a single instance', async () => {
    const db = seeded();
    const result = await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    expect(result.created).toBe(8);
    expect(result.raced).toBe(0);
    expect(eventIds(db)).toEqual([
      'friday-fellowship-2026-07-24',
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-07',
      'friday-fellowship-2026-08-14',
      'friday-fellowship-2026-08-21',
      'friday-fellowship-2026-08-28',
      'friday-fellowship-2026-09-04',
      'friday-fellowship-2026-09-11',
      'friday-fellowship-2026-09-18',
    ]);
  });

  it('writes nothing on a second run — the property that makes it nightly', async () => {
    const db = seeded();
    await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);
    const after = db.writes.length;

    const again = await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    expect(again.created).toBe(0);
    expect(again.raced).toBe(0);
    expect(db.writes.length).toBe(after);
  });

  it('carries the gathering forward, not just its date', async () => {
    const db = seeded();
    await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    const next = db.get(`${EVENTS}/friday-fellowship-2026-07-31`);
    expect(next?.title).toBe('Friday Fellowship');
    expect(next?.location).toBe('Fellowship Hall');
    expect(next?.seriesId).toBe('friday-fellowship');
    expect(next?.recurrence).toEqual(WEEKLY_FRIDAY);
    // The chain's root, so the ids stay derivable from here on.
    expect(next?.recurrenceRootId).toBe('friday-fellowship-2026-07-24');
    expect(next?.startAt).toEqual(new Date(2026, 6, 31, 19, 0));
    expect(next?.endAt).toEqual(new Date(2026, 6, 31, 21, 0));
    expect(next?.checkInOpensAt).toEqual(new Date(2026, 6, 31, 18, 0));
    expect(next?.status).toBe('scheduled');
    // A recurring gathering is never an RSVP list.
    expect(next?.requiresRsvp).toBe(false);
  });

  it('skips an occurrence already on the calendar when the read happened', async () => {
    const db = seeded();
    // The app's own top-up landed this one before the sweep read the collection.
    db.seed(
      `${EVENTS}/friday-fellowship-2026-07-31`,
      eventDoc({ startAt: new Date(2026, 6, 31, 19, 0) }),
    );

    const result = await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    // Planned around, so it never reaches a write at all.
    expect(result.raced).toBe(0);
    expect(result.created).toBe(7);
  });

  it('counts a document written *during* the sweep rather than failing', async () => {
    const db = seeded();

    // The genuine race: the app commits between this run's read and its write,
    // so `create` is what discovers the collision. Losing it must be a tally,
    // not a thrown job that leaves the rest of the horizon unwritten.
    const contended = `${EVENTS}/friday-fellowship-2026-08-07`;
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

    const result = await materializeDueOccurrences(racing, FRIDAY, SILENT_LOGGER);

    expect(result.raced).toBe(1);
    expect(result.created).toBe(7);
    // Everything after the collision still got written.
    expect(eventIds(db)).toContain('friday-fellowship-2026-09-18');
  });

  it('never overwrites a gathering somebody moved on purpose', async () => {
    const db = seeded();
    await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    // A leader pushes the 7 August one back half an hour.
    const moved = { ...db.get(`${EVENTS}/friday-fellowship-2026-08-07`)! };
    moved.startAt = new Date(2026, 7, 7, 19, 30);
    moved.location = 'Youth room';
    db.seed(`${EVENTS}/friday-fellowship-2026-08-07`, moved);

    await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    expect(db.get(`${EVENTS}/friday-fellowship-2026-08-07`)?.startAt).toEqual(
      new Date(2026, 7, 7, 19, 30),
    );
    expect(db.get(`${EVENTS}/friday-fellowship-2026-08-07`)?.location).toBe('Youth room');
  });

  it('leaves one-offs and rule-less events alone', async () => {
    const db = new FakeFirestore();
    db.seed(`${EVENTS}/retreat`, eventDoc({ mode: 'oneoff', seriesId: null, recurrence: null }));
    db.seed(`${EVENTS}/plain`, eventDoc({ seriesId: null, recurrence: null }));

    const result = await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    expect(result.created).toBe(0);
    expect(eventIds(db)).toEqual(['plain', 'retreat']);
  });

  it('does not resurrect a cancelled gathering', async () => {
    const db = seeded();
    db.seed(
      `${EVENTS}/friday-fellowship-2026-07-31`,
      eventDoc({ startAt: new Date(2026, 6, 31, 19, 0), status: 'cancelled' }),
    );

    await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    expect(db.get(`${EVENTS}/friday-fellowship-2026-07-31`)?.status).toBe('cancelled');
  });

  it('skips a document with no usable schedule instead of scheduling the epoch', async () => {
    const db = seeded();
    db.seed(`${EVENTS}/corrupt`, { title: 'No dates', mode: 'recurring' });

    const warnings: string[] = [];
    const result = await materializeDueOccurrences(db, FRIDAY, {
      ...SILENT_LOGGER,
      warn: (message) => warnings.push(message),
    });

    expect(warnings).toHaveLength(1);
    // The healthy chain still ran.
    expect(result.created).toBe(8);
    expect(eventIds(db)).not.toContain('1970-01-01');
  });

  it('reads a legacy "daily" rule as every weekday', async () => {
    const db = seeded({ recurrence: { frequency: 'daily', interval: 1 } });
    const result = await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    // Ten a run, the per-chain cap.
    expect(result.created).toBe(10);
    expect(eventIds(db)).toContain('friday-fellowship-2026-07-25');
    expect(eventIds(db)).toContain('friday-fellowship-2026-07-26');
  });

  it('writes wall-clock times in the ministry\'s timezone, not the container\'s', async () => {
    // The failure this guards: a Cloud Functions container is UTC, and the
    // expander builds dates with the local-time constructor. Without the TZ the
    // entry point sets, a 19:00 Friday would be written as 19:00 UTC — an
    // afternoon in New York, and a different calendar day either side of a DST
    // change.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const friday = new Date(2026, 6, 24, 19, 0);
      const db = new FakeFirestore();
      db.seed(`${EVENTS}/friday-fellowship-2026-07-24`, eventDoc({ startAt: friday }));

      await materializeDueOccurrences(db, friday, SILENT_LOGGER);

      const next = db.get(`${EVENTS}/friday-fellowship-2026-07-31`)?.startAt as Date;
      expect(next.toISOString()).toBe('2026-07-31T23:00:00.000Z');
    } finally {
      process.env.TZ = original;
    }
  });

  it('ignores history older than the lookback', async () => {
    const db = new FakeFirestore();
    const ancient = new Date(2024, 0, 5, 19, 0);
    db.seed(`${EVENTS}/friday-fellowship-2024-01-05`, eventDoc({ startAt: ancient }));

    const result = await materializeDueOccurrences(db, FRIDAY, SILENT_LOGGER);

    expect(result.events).toBe(0);
    expect(result.created).toBe(0);
  });
});
