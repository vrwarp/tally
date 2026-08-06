/**
 * The participation builder's claims: chains are keyed the way the app keys
 * them, a year is a year, and the two knobs come from the settings document.
 *
 * The rule itself is tested in `src/lib/participation.test.ts` — this is about
 * turning Firestore into that function's input without losing anything.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { buildParticipationIndex, PARTICIPATION_DOC } from './participation.js';

const NOW = new Date('2026-08-07T03:20:00Z');
const DAY_MS = 86_400_000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

/**
 * One stored event with the four timestamps `toSource` insists on, plus its
 * register. Attendance is seeded as documents because the builder reads their
 * ids and nothing else.
 */
function seedEvent(
  db: FakeFirestore,
  id: string,
  options: {
    startAt: Date;
    seriesId?: string | null;
    recurrenceRootId?: string | null;
    mode?: 'recurring' | 'oneoff';
    status?: 'scheduled' | 'cancelled';
    present?: string[];
  },
): void {
  const start = Timestamp.fromDate(options.startAt);
  db.seed(`events/${id}`, {
    title: id,
    mode: options.mode ?? 'recurring',
    status: options.status ?? 'scheduled',
    seriesId: options.seriesId ?? null,
    recurrenceRootId: options.recurrenceRootId ?? null,
    startAt: start,
    endAt: start,
    checkInOpensAt: start,
    checkInClosesAt: start,
  });
  for (const studentId of options.present ?? []) {
    db.seed(`events/${id}/attendance/${studentId}`, { studentId });
  }
}

function scopes(db: FakeFirestore): Record<string, { participated: string[]; recent: string[] }> {
  return db.get(PARTICIPATION_DOC)?.chains as Record<
    string,
    { participated: string[]; recent: string[] }
  >;
}

describe('buildParticipationIndex', () => {
  it('writes both windows per chain', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'f1', { startAt: daysAgo(7), seriesId: 'friday', present: ['ada', 'bo'] });
    seedEvent(db, 'f2', { startAt: daysAgo(14), seriesId: 'friday', present: ['ada', 'bo'] });
    seedEvent(db, 'f3', { startAt: daysAgo(21), seriesId: 'friday', present: ['ada'] });
    seedEvent(db, 'f4', { startAt: daysAgo(300), seriesId: 'friday', present: ['cyd'] });

    const summary = await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

    expect(summary).toMatchObject({ chains: 1, instances: 4, students: 3 });
    expect(scopes(db).friday).toEqual({
      participated: ['ada', 'bo', 'cyd'],
      recent: ['ada', 'bo'],
    });
  });

  /*
   * The reason this document exists at all. A weekly gathering created in the
   * app has a recurrence root and no series document, so keying on the stored
   * `seriesId` would file every one of its instances under its own id and leave
   * the chain with a window of one.
   */
  it('keys a chain by chainKey, not by the stored seriesId', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'sat-1', { startAt: daysAgo(7), recurrenceRootId: 'sat', present: ['ada'] });
    seedEvent(db, 'sat-2', { startAt: daysAgo(14), recurrenceRootId: 'sat', present: ['ada'] });

    await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

    expect(Object.keys(scopes(db))).toEqual(['sat']);
    expect(scopes(db).sat.recent).toEqual(['ada']);
  });

  it('falls back to the event id when a chain has neither', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'lonely', { startAt: daysAgo(7), present: ['ada'] });

    await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

    expect(Object.keys(scopes(db))).toEqual(['lonely']);
  });

  it('leaves one-offs out entirely', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'retreat', { startAt: daysAgo(30), mode: 'oneoff', present: ['ada'] });

    const summary = await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

    expect(summary.chains).toBe(0);
    expect(scopes(db)).toEqual({});
  });

  it('never reads the register of a cancelled instance', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'f1', {
      startAt: daysAgo(7),
      seriesId: 'friday',
      status: 'cancelled',
      present: ['ghost'],
    });
    seedEvent(db, 'f2', { startAt: daysAgo(14), seriesId: 'friday', present: ['ada'] });

    const summary = await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

    expect(summary.instances).toBe(1);
    expect(scopes(db).friday.participated).toEqual(['ada']);
  });

  it('drops anything older than the year and anything still ahead', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'old', { startAt: daysAgo(400), seriesId: 'friday', present: ['gone'] });
    seedEvent(db, 'soon', {
      startAt: new Date(NOW.getTime() + DAY_MS),
      seriesId: 'friday',
      present: ['early'],
    });
    seedEvent(db, 'now', { startAt: daysAgo(7), seriesId: 'friday', present: ['ada'] });

    await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

    expect(scopes(db).friday.participated).toEqual(['ada']);
  });

  it('skips an event document with no usable schedule', async () => {
    const db = new FakeFirestore();
    db.seed('events/broken', { title: 'no timestamps', mode: 'recurring' });
    seedEvent(db, 'f1', { startAt: daysAgo(7), seriesId: 'friday', present: ['ada'] });

    const summary = await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

    expect(summary.instances).toBe(1);
  });

  describe('the prediction knobs', () => {
    const fridays = (db: FakeFirestore) => {
      seedEvent(db, 'f1', { startAt: daysAgo(7), seriesId: 'friday', present: ['ada'] });
      seedEvent(db, 'f2', { startAt: daysAgo(14), seriesId: 'friday', present: ['ada', 'bo'] });
      seedEvent(db, 'f3', { startAt: daysAgo(21), seriesId: 'friday', present: ['ada', 'bo'] });
      seedEvent(db, 'f4', { startAt: daysAgo(28), seriesId: 'friday', present: ['bo'] });
    };

    it('defaults to 2 of 3 when no settings document exists', async () => {
      const db = new FakeFirestore();
      fridays(db);

      await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

      expect(db.get(PARTICIPATION_DOC)).toMatchObject({ ofLastN: 3, minAttended: 2 });
      // Over f1..f3: Ada three times, Bo twice.
      expect(scopes(db).friday.recent).toEqual(['ada', 'bo']);
    });

    it('reads them from config/settings', async () => {
      const db = new FakeFirestore();
      fridays(db);
      db.seed('config/settings', { predictiveOfLastN: 2, predictiveMinAttended: 2 });

      await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

      // Over f1..f2 only: Ada twice, Bo once.
      expect(scopes(db).friday.recent).toEqual(['ada']);
    });

    it('clamps them the way the app clamps them on read', async () => {
      const db = new FakeFirestore();
      fridays(db);
      db.seed('config/settings', { predictiveOfLastN: 99, predictiveMinAttended: 99 });

      await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

      // ofLastN caps at 12; minAttended can never exceed it.
      expect(db.get(PARTICIPATION_DOC)).toMatchObject({ ofLastN: 12, minAttended: 12 });
      // Four held Fridays, so the threshold clamps again to 4: only Ada and Bo
      // came to all of them — neither did, so nobody is recent.
      expect(scopes(db).friday.recent).toEqual([]);
    });
  });

  it('records the window it measured, so a reader need not know this file', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'f1', { startAt: daysAgo(7), seriesId: 'friday', present: ['ada'] });

    await buildParticipationIndex(db, { builtBy: 'nightly', now: NOW });

    expect(db.get(PARTICIPATION_DOC)).toMatchObject({
      version: 1,
      builtBy: 'nightly',
      maxAgeDays: 365,
    });
  });

  it('writes an empty map rather than nothing when no chain has history', async () => {
    const db = new FakeFirestore();

    const summary = await buildParticipationIndex(db, { builtBy: 'test', now: NOW });

    // The kiosk reads an empty map as "nothing to scope by" and searches
    // everybody. A missing document would mean the same, but writing one is how
    // the kiosk can tell "built, and there is nothing" from "never built".
    expect(summary.chains).toBe(0);
    expect(scopes(db)).toEqual({});
  });
});
