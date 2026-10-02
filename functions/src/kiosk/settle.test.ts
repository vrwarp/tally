/**
 * The core team deciding about what the lobby kiosk parked: let it go with a
 * name on it, or record it once the reason it was parked has gone — through
 * the same path the kiosk's own upload takes.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { SILENT_LOGGER } from '../firestore.js';
import { PARKED_COLLECTION, runLandKioskRecords, parseLandRequest } from './landing.js';
import { runSettleParked } from './settle.js';

const MINUTE = 60_000;
const OPENS = Date.parse('2026-09-27T16:00:00Z'); // 9:00 in the lobby
const START = OPENS + 30 * MINUTE;
const END = START + 90 * MINUTE;
const MONDAY = END + 24 * 60 * MINUTE;
const EVENT = 'sunday-kids-2026-09-27';
const DEVICE = 'kiosk-lobby-00000001';
const KIOSK = `kiosk_${DEVICE}`;
const NOAH = 'student-noah';
const DANA = { uid: 'uid-dana', name: 'Dana Ortiz' };

const IN_CARD = `check-in:${EVENT}:${NOAH}`;
const OUT_CARD = `check-out:${EVENT}:${NOAH}`;

function sunday(): FakeFirestore {
  const db = new FakeFirestore();
  db.seed(`events/${EVENT}`, {
    title: 'Sunday Kids',
    seriesId: 'sunday-kids',
    startAt: Timestamp.fromMillis(START),
    endAt: Timestamp.fromMillis(END),
    checkInOpensAt: Timestamp.fromMillis(OPENS),
    checkInClosesAt: Timestamp.fromMillis(END),
  });
  db.seed(`kioskDevices/${DEVICE}`, { boundChain: 'sunday-kids', retiredAt: null });
  db.seed(`students/${NOAH}`, {
    firstName: 'Noah',
    lastName: 'Park',
    searchName: 'noah park',
    grade: 2,
    upstreamRecordMissing: true,
  });
  return db;
}

/** The kiosk sends Noah's 9:43 arrival (and, optionally, his 10:52 pickup) while he is frozen. */
async function parkFrozen(db: FakeFirestore, withPickup = false): Promise<void> {
  const records: Record<string, unknown>[] = [
    {
      id: 'in-noah-00000001',
      kind: 'check-in',
      eventId: EVENT,
      studentId: NOAH,
      tappedAtMs: START + 13 * MINUTE,
      arrivalId: 'arrival-7',
      student: { firstName: 'Noah', lastName: 'Parke', grade: 2, searchName: 'noah parke' },
      gathering: 'Sunday Kids',
    },
  ];
  if (withPickup) {
    records.push({
      id: 'out-noah-0000001',
      kind: 'check-out',
      eventId: EVENT,
      studentId: NOAH,
      tappedAtMs: START + 82 * MINUTE,
    });
  }
  await runLandKioskRecords({
    db,
    request: parseLandRequest({ records, stillOnTablet: { count: 0, oldestTappedAtMs: null } }),
    caller: { uid: KIOSK, deviceId: DEVICE },
    now: new Date(END),
    logger: SILENT_LOGGER,
  });
}

function settle(db: FakeFirestore, id: string, decision: 'record' | 'let-go', nowMs = MONDAY) {
  return runSettleParked({ db, id, decision, settler: DANA, now: new Date(nowMs), logger: SILENT_LOGGER });
}

const card = (db: FakeFirestore, id: string) => db.get(`${PARKED_COLLECTION}/${id}`)!;
const attendanceOf = (db: FakeFirestore, studentId = NOAH) =>
  db.get(`events/${EVENT}/attendance/${studentId}`);
const ms = (value: unknown) => (value as Timestamp).toMillis();

describe('letting a record go', () => {
  it('keeps the card, with who let it go and when', async () => {
    const db = sunday();
    await parkFrozen(db);

    expect(await settle(db, IN_CARD, 'let-go')).toEqual({ status: 'settled' });
    expect(card(db, IN_CARD)).toMatchObject({
      reason: 'frozen',
      decision: 'let-go',
      settledBy: 'uid-dana',
      settledByName: 'Dana Ortiz',
    });
    expect(ms(card(db, IN_CARD).settledAt)).toBe(MONDAY);
    expect(attendanceOf(db)).toBeUndefined();
  });

  it('lets a child’s arrival and pickup go together, from either card', async () => {
    const db = sunday();
    await parkFrozen(db, true);

    await settle(db, OUT_CARD, 'let-go');
    expect(card(db, IN_CARD).decision).toBe('let-go');
    expect(card(db, OUT_CARD).decision).toBe('let-go');
  });

  it('answers a card somebody already settled, and one that is not there', async () => {
    const db = sunday();
    await parkFrozen(db);
    await settle(db, IN_CARD, 'let-go');

    expect(await settle(db, IN_CARD, 'record')).toEqual({ status: 'already-settled' });
    expect(card(db, IN_CARD).decision).toBe('let-go');
    expect(await settle(db, 'check-in:nothing:here', 'let-go')).toEqual({ status: 'not-found' });
  });
});

describe('recording a record once its reason has gone', () => {
  it('refuses while the child’s record is still missing, and writes nothing', async () => {
    const db = sunday();
    await parkFrozen(db);

    expect(await settle(db, IN_CARD, 'record')).toEqual({ status: 'still-frozen' });
    expect(attendanceOf(db)).toBeUndefined();
    expect(card(db, IN_CARD).settledAt).toBeNull();
  });

  it('lands the arrival with the tap’s own time and the kiosk as its witness', async () => {
    const db = sunday();
    await parkFrozen(db);
    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park', searchName: 'noah park', grade: 2 });

    expect(await settle(db, IN_CARD, 'record')).toEqual({ status: 'settled' });
    const here = attendanceOf(db)!;
    expect(ms(here.checkedInAt)).toBe(START + 13 * MINUTE);
    expect(here).toMatchObject({ checkedInBy: KIOSK, method: 'kiosk', arrivalId: 'arrival-7' });
    expect(card(db, IN_CARD)).toMatchObject({ decision: 'recorded', settledBy: 'uid-dana' });
    expect(card(db, IN_CARD)).not.toHaveProperty('recordedAs');
  });

  it('keeps the names the student holds now, not the ones the kiosk had on Sunday', async () => {
    const db = sunday();
    await parkFrozen(db);
    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park', searchName: 'noah park', grade: 2 });

    await settle(db, IN_CARD, 'record');
    expect(db.get(`students/${NOAH}`)).toMatchObject({ lastName: 'Park', searchName: 'noah park' });
  });

  it('records the arrival before the pickup that closes it, and settles both', async () => {
    const db = sunday();
    await parkFrozen(db, true);
    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park', searchName: 'noah park', grade: 2 });

    // Asked from the pickup's card.
    expect(await settle(db, OUT_CARD, 'record')).toEqual({ status: 'settled' });
    const here = attendanceOf(db)!;
    expect(ms(here.checkedInAt)).toBe(START + 13 * MINUTE);
    expect(ms(here.checkedOutAt)).toBe(START + 82 * MINUTE);
    expect(card(db, IN_CARD).decision).toBe('recorded');
    expect(card(db, OUT_CARD).decision).toBe('recorded');
  });

  it('records a pickup parked before its arrival came, once that arrival is parked beside it', async () => {
    // Two tablets: the pickup reached Tally first, after the day's wait, so it
    // was parked as one whose arrival never came. The arrival then came from a
    // tablet that had been out of touch, by which time Noah was frozen. His
    // arrival is the card beside the pickup, so the pickup has something to
    // close after all: both are recorded once he is back.
    const DAY = 24 * 60 * MINUTE;
    const DEVICE_B = 'kiosk-lobby-00000002';
    const db = sunday();
    db.seed(`kioskDevices/${DEVICE_B}`, { boundChain: 'sunday-kids', retiredAt: null });
    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park', searchName: 'noah park', grade: 2 });
    const land = (deviceId: string, records: Record<string, unknown>[], nowMs: number) =>
      runLandKioskRecords({
        db,
        request: parseLandRequest({ records, stillOnTablet: { count: 0, oldestTappedAtMs: null } }),
        caller: { uid: `kiosk_${deviceId}`, deviceId },
        now: new Date(nowMs),
        logger: SILENT_LOGGER,
      });

    const pickup = await land(
      DEVICE_B,
      [{ id: 'out-noah-0000001', kind: 'check-out', eventId: EVENT, studentId: NOAH, tappedAtMs: START + 82 * MINUTE }],
      END + 2 * DAY,
    );
    expect(pickup.outcomes[0]).toMatchObject({ outcome: 'parked', reason: 'no-arrival' });

    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park', upstreamRecordMissing: true });
    const arrival = await land(
      DEVICE,
      [
        {
          id: 'in-noah-00000001',
          kind: 'check-in',
          eventId: EVENT,
          studentId: NOAH,
          tappedAtMs: START + 13 * MINUTE,
          arrivalId: 'arrival-7',
          student: { firstName: 'Noah', lastName: 'Park', grade: 2, searchName: 'noah park' },
        },
      ],
      END + 3 * DAY,
    );
    expect(arrival.outcomes[0]).toMatchObject({ outcome: 'parked', reason: 'frozen' });

    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park', searchName: 'noah park', grade: 2 });
    expect(await settle(db, IN_CARD, 'record', END + 4 * DAY)).toEqual({ status: 'settled' });
    const here = attendanceOf(db)!;
    expect(ms(here.checkedInAt)).toBe(START + 13 * MINUTE);
    expect(ms(here.checkedOutAt)).toBe(START + 82 * MINUTE);
    expect(here.checkedOutBy).toBe(`kiosk_${DEVICE_B}`);
    expect(card(db, IN_CARD).decision).toBe('recorded');
    expect(card(db, OUT_CARD).decision).toBe('recorded');
  });

  it('follows a child re-created upstream to the student who stands now, and says so', async () => {
    const db = sunday();
    await parkFrozen(db);
    db.seed(`students/${NOAH}`, {
      firstName: 'Noah',
      lastName: 'Park',
      status: 'inactive',
      upstreamRecordMissing: true,
      recreatedAsStudentId: 'student-noah-2',
    });
    db.seed('students/student-noah-2', { firstName: 'Noah', lastName: 'Park', mergedIntoStudentId: 'student-noah-3' });
    db.seed('students/student-noah-3', { firstName: 'Noah', lastName: 'Park' });

    expect(await settle(db, IN_CARD, 'record')).toEqual({ status: 'settled' });
    expect(attendanceOf(db)).toBeUndefined();
    expect(ms(attendanceOf(db, 'student-noah-3')!.checkedInAt)).toBe(START + 13 * MINUTE);
    expect(card(db, IN_CARD)).toMatchObject({ decision: 'recorded', recordedAs: 'student-noah-3' });
  });

  it('keeps the earlier moment when somebody recorded the child later meanwhile', async () => {
    const db = sunday();
    await parkFrozen(db);
    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park' });
    db.seed(`events/${EVENT}/attendance/${NOAH}`, {
      studentId: NOAH,
      eventId: EVENT,
      checkedInAt: Timestamp.fromMillis(START + 40 * MINUTE),
      checkedInBy: 'uid-counselor',
      method: 'search',
    });

    expect(await settle(db, IN_CARD, 'record')).toEqual({ status: 'settled' });
    const here = attendanceOf(db)!;
    expect(ms(here.checkedInAt)).toBe(START + 13 * MINUTE);
    expect(here.laterCheckIn).toMatchObject({ by: 'uid-counselor' });
  });

  it('has nothing to record onto for a gathering that is gone, or a pickup whose arrival never came', async () => {
    const deleted = sunday();
    deleted.seed(`${PARKED_COLLECTION}/${IN_CARD}`, {
      kind: 'check-in',
      eventId: EVENT,
      studentId: NOAH,
      reason: 'gathering-deleted',
      recordId: 'in-noah-00000001',
      tappedAt: Timestamp.fromMillis(START),
      deviceId: DEVICE,
      settledAt: null,
    });
    expect(await settle(deleted, IN_CARD, 'record')).toEqual({ status: 'cannot-record' });

    const noArrival = sunday();
    noArrival.seed(`${PARKED_COLLECTION}/${OUT_CARD}`, {
      kind: 'check-out',
      eventId: EVENT,
      studentId: NOAH,
      reason: 'no-arrival',
      recordId: 'out-noah-0000001',
      tappedAt: Timestamp.fromMillis(END),
      deviceId: DEVICE,
      settledAt: null,
    });
    expect(await settle(noArrival, OUT_CARD, 'record')).toEqual({ status: 'cannot-record' });
    // Either can still be let go.
    expect(await settle(noArrival, OUT_CARD, 'let-go')).toEqual({ status: 'settled' });
  });

  it('refuses a pickup parked with its arrival once that arrival was let go on its own', async () => {
    const db = sunday();
    await parkFrozen(db);
    await settle(db, IN_CARD, 'let-go');
    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park' });
    // Noah is back; his pickup reaches Tally and parks behind the arrival that was parked.
    await runLandKioskRecords({
      db,
      request: parseLandRequest({
        records: [{ id: 'out-noah-0000001', kind: 'check-out', eventId: EVENT, studentId: NOAH, tappedAtMs: END }],
        stillOnTablet: { count: 0, oldestTappedAtMs: null },
      }),
      caller: { uid: KIOSK, deviceId: DEVICE },
      now: new Date(END + MINUTE),
      logger: SILENT_LOGGER,
    });
    expect(card(db, OUT_CARD)).toMatchObject({ reason: 'arrival-parked' });

    expect(await settle(db, OUT_CARD, 'record')).toEqual({ status: 'cannot-record' });
    expect(card(db, OUT_CARD).settledAt).toBeNull();
  });

  it('answers a card the landing parks again — the gathering deleted since — as not recordable', async () => {
    const db = sunday();
    await parkFrozen(db);
    db.seed(`students/${NOAH}`, { firstName: 'Noah', lastName: 'Park' });
    db.data.delete(`events/${EVENT}`);

    expect(await settle(db, IN_CARD, 'record')).toEqual({ status: 'cannot-record' });
    expect(card(db, IN_CARD).settledAt).toBeNull();
  });

  it('cannot record for a child who is not there at all', async () => {
    const db = sunday();
    await parkFrozen(db);
    db.data.delete(`students/${NOAH}`);
    expect(await settle(db, IN_CARD, 'record')).toEqual({ status: 'cannot-record' });
  });
});
