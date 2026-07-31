/**
 * Deleting gatherings, driven against the in-memory Firestore.
 *
 * Three claims, and they are the three ways this can go wrong quietly. It has
 * to reach the subcollections, because a document delete does not and the
 * leftovers are invisible from every screen. It has to agree with `chainKey`
 * about what "this repeating gathering" means, or a delete either misses half a
 * chain or takes a different one with it. And the preview has to count exactly
 * what the delete would remove while writing nothing at all — a confirmation
 * that promises one number and deletes another is worse than no confirmation.
 */
import { describe, expect, it } from 'vitest';
import { deleteEvents } from './eventDeletion.js';
import { EVENTS } from './occurrences.js';
import { SILENT_LOGGER } from './firestore.js';
import { FakeFirestore } from './testing/fakeFirestore.js';

const WEEKLY_FRIDAY = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [5],
  monthlyMode: 'dayOfMonth',
  until: null,
  count: null,
};

function eventDoc(startAt: Date, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Friday Fellowship',
    mode: 'recurring',
    seriesId: null,
    recurrence: WEEKLY_FRIDAY,
    recurrenceRootId: null,
    predictFromChain: null,
    startAt,
    endAt: new Date(startAt.getTime() + 2 * 3_600_000),
    checkInOpensAt: new Date(startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(startAt.getTime() + 3 * 3_600_000),
    location: 'Fellowship Hall',
    notes: null,
    status: 'scheduled',
    ...overrides,
  };
}

/** A gathering with `count` students checked in and one RSVP. */
function seedEvent(
  db: FakeFirestore,
  id: string,
  startAt: Date,
  count: number,
  overrides: Record<string, unknown> = {},
): void {
  db.seed(`${EVENTS}/${id}`, eventDoc(startAt, overrides));
  for (let index = 0; index < count; index += 1) {
    db.seed(`${EVENTS}/${id}/attendance/student-${index}`, {
      studentId: `student-${index}`,
      eventId: id,
    });
  }
  db.seed(`${EVENTS}/${id}/rsvps/student-0`, { studentId: 'student-0', eventId: id });
}

function paths(db: FakeFirestore, prefix: string): string[] {
  return [...db.data.keys()].filter((key) => key.startsWith(prefix)).sort();
}

const APPLY = { apply: true };

describe('deleting one gathering', () => {
  it('takes its check-ins and RSVPs with it', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'friday-2026-07-24', new Date(2026, 6, 24, 19, 0), 3);
    seedEvent(db, 'friday-2026-07-31', new Date(2026, 6, 31, 19, 0), 2);

    const summary = await deleteEvents(
      db,
      { scope: 'event', eventId: 'friday-2026-07-24' },
      SILENT_LOGGER,
      APPLY,
    );

    expect(summary).toEqual({
      events: 1,
      checkIns: 3,
      rsvps: 1,
      unlinked: 0,
      title: 'Friday Fellowship',
    });
    expect(paths(db, `${EVENTS}/friday-2026-07-24`)).toEqual([]);
    // The Friday after it is untouched — one night, not the chain.
    expect(paths(db, `${EVENTS}/friday-2026-07-31`)).toHaveLength(4);
  });

  it('refuses an event that is not there', async () => {
    const db = new FakeFirestore();

    await expect(
      deleteEvents(db, { scope: 'event', eventId: 'never-existed' }, SILENT_LOGGER, APPLY),
    ).resolves.toBeNull();
  });

  it('counts without writing when previewing', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'friday-2026-07-24', new Date(2026, 6, 24, 19, 0), 3);

    const summary = await deleteEvents(
      db,
      { scope: 'event', eventId: 'friday-2026-07-24' },
      SILENT_LOGGER,
    );

    expect(summary?.checkIns).toBe(3);
    expect(db.writes).toEqual([]);
    expect(paths(db, `${EVENTS}/friday-2026-07-24`)).toHaveLength(5);
  });
});

describe('deleting a chain', () => {
  it('removes every instance grouped under one recurrence root', async () => {
    const db = new FakeFirestore();
    // The hand-made event the chain grew from, plus two occurrences
    // materialised out of its rule.
    seedEvent(db, 'root-friday', new Date(2026, 5, 26, 19, 0), 4);
    seedEvent(db, 'root-friday-2026-07-24', new Date(2026, 6, 24, 19, 0), 6, {
      recurrenceRootId: 'root-friday',
    });
    seedEvent(db, 'root-friday-2026-07-31', new Date(2026, 6, 31, 19, 0), 0, {
      recurrenceRootId: 'root-friday',
      title: 'Friday Fellowship (summer)',
    });
    // A different gathering entirely, on its own root.
    seedEvent(db, 'sunday-school', new Date(2026, 6, 26, 9, 0), 5);

    const summary = await deleteEvents(
      db,
      { scope: 'chain', chain: 'root-friday' },
      SILENT_LOGGER,
      APPLY,
    );

    expect(summary).toEqual({
      events: 3,
      checkIns: 10,
      rsvps: 3,
      unlinked: 0,
      // The latest instance names the chain, the way the projection templates
      // from it: renamed in July means renamed here.
      title: 'Friday Fellowship (summer)',
    });
    expect(paths(db, `${EVENTS}/root-friday`)).toEqual([]);
    expect(paths(db, `${EVENTS}/sunday-school`)).toHaveLength(7);
  });

  it('groups by series when there is one', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'seeded-a', new Date(2026, 6, 24, 19, 0), 2, { seriesId: 'friday-fellowship' });
    seedEvent(db, 'seeded-b', new Date(2026, 6, 31, 19, 0), 1, {
      seriesId: 'friday-fellowship',
      // A different root under the same series is still the same gathering:
      // `chainKey` reads `seriesId` first.
      recurrenceRootId: 'some-other-root',
    });

    const summary = await deleteEvents(
      db,
      { scope: 'chain', chain: 'friday-fellowship' },
      SILENT_LOGGER,
      APPLY,
    );

    expect(summary?.events).toBe(2);
    expect(paths(db, `${EVENTS}/`)).toEqual([]);
  });

  it('clears the trips that borrowed its regulars', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'root-friday', new Date(2026, 6, 24, 19, 0), 2);
    seedEvent(db, 'winter-retreat', new Date(2026, 11, 4, 17, 0), 0, {
      mode: 'oneoff',
      recurrence: null,
      predictFromChain: 'root-friday',
      title: 'Winter Retreat',
    });

    const summary = await deleteEvents(
      db,
      { scope: 'chain', chain: 'root-friday' },
      SILENT_LOGGER,
      APPLY,
    );

    expect(summary?.unlinked).toBe(1);
    expect(db.get(`${EVENTS}/winter-retreat`)?.predictFromChain).toBeNull();
    // The retreat itself survives; only its borrowed prediction goes.
    expect(db.get(`${EVENTS}/winter-retreat`)?.title).toBe('Winter Retreat');
  });

  it('reports zeroes for a chain nothing is left of', async () => {
    const db = new FakeFirestore();

    await expect(
      deleteEvents(db, { scope: 'chain', chain: 'long-gone' }, SILENT_LOGGER, APPLY),
    ).resolves.toEqual({ events: 0, checkIns: 0, rsvps: 0, unlinked: 0, title: null });
  });

  it('takes a one-off with it when the chain is the event itself', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'winter-retreat', new Date(2026, 11, 4, 17, 0), 3, {
      mode: 'oneoff',
      recurrence: null,
    });

    const summary = await deleteEvents(
      db,
      { scope: 'chain', chain: 'winter-retreat' },
      SILENT_LOGGER,
      APPLY,
    );

    expect(summary?.events).toBe(1);
    expect(summary?.checkIns).toBe(3);
  });

  it('still deletes an instance too broken to project', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'root-friday', new Date(2026, 6, 24, 19, 0), 1);
    // No timestamps at all: `toSource` refuses this, and it is still a document
    // sitting in the chain that a delete has to reach.
    db.seed(`${EVENTS}/root-friday-2026-08-07`, {
      title: 'Friday Fellowship',
      recurrenceRootId: 'root-friday',
    });

    const summary = await deleteEvents(
      db,
      { scope: 'chain', chain: 'root-friday' },
      SILENT_LOGGER,
      APPLY,
    );

    expect(summary?.events).toBe(2);
    expect(paths(db, `${EVENTS}/`)).toEqual([]);
  });
});

describe('the order of the writes', () => {
  it('removes attendance before the gathering that holds it', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'friday-2026-07-24', new Date(2026, 6, 24, 19, 0), 2);

    await deleteEvents(db, { scope: 'event', eventId: 'friday-2026-07-24' }, SILENT_LOGGER, APPLY);

    const order = db.writes.map((write) => write.path);
    // A run that dies partway should leave attendance under an event that still
    // exists — untidy and fixable — rather than the other way round.
    expect(order.at(-1)).toBe(`${EVENTS}/friday-2026-07-24`);
    expect(order).toHaveLength(4);
  });
});
