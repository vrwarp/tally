/**
 * The one road a kiosk's record takes to the register.
 *
 * Driven against the in-memory double: every outcome, the owner's
 * earlier-wins rule in both directions, the fifteen-minute bounds, parking,
 * ordering inside a call, one record's failure not costing its neighbours, and
 * the count the Team page reads.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import type { TransactionLike } from '../firestore.js';
import { SILENT_LOGGER } from '../firestore.js';
import {
  LandingInputError,
  PARKED_COLLECTION,
  parseLandRequest,
  runLandKioskRecords,
} from './landing.js';

const MINUTE = 60_000;
const OPENS = Date.parse('2026-09-27T16:00:00Z'); // 9:00 in the lobby
const START = OPENS + 30 * MINUTE;
const END = START + 90 * MINUTE;
const EVENT = 'sunday-kids-2026-09-27';
const DEVICE = 'kiosk-lobby-00000001';
const KIOSK = `kiosk_${DEVICE}`;
const ADA = 'student-ada';

function dbWithSunday(): FakeFirestore {
  const db = new FakeFirestore();
  db.seed(`events/${EVENT}`, {
    title: 'Sunday Kids',
    seriesId: 'sunday-kids',
    startAt: Timestamp.fromMillis(START),
    endAt: Timestamp.fromMillis(END),
    checkInOpensAt: Timestamp.fromMillis(OPENS),
    checkInClosesAt: Timestamp.fromMillis(END),
  });
  db.seed(`kioskDevices/${DEVICE}`, { lastSeenAt: null, boundChain: 'sunday-kids', retiredAt: null });
  return db;
}

const student = { firstName: 'Ada', lastName: 'Lovelace', grade: 3, searchName: 'ada lovelace' };

function checkIn(tappedAtMs: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `in-${tappedAtMs}-aaaa`,
    kind: 'check-in',
    eventId: EVENT,
    studentId: ADA,
    tappedAtMs,
    arrivalId: 'arrival-1',
    student,
    gathering: 'Sunday Kids',
    ...overrides,
  };
}

function checkOut(tappedAtMs: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `out-${tappedAtMs}-aaaa`, kind: 'check-out', eventId: EVENT, studentId: ADA, tappedAtMs, ...overrides };
}

async function land(
  db: FakeFirestore,
  records: Record<string, unknown>[],
  nowMs: number,
  stillOnTablet = { count: 0, oldestTappedAtMs: null as number | null },
) {
  return runLandKioskRecords({
    db,
    request: parseLandRequest({ records, stillOnTablet }),
    caller: { uid: KIOSK, deviceId: DEVICE },
    now: new Date(nowMs),
    logger: SILENT_LOGGER,
  });
}

const attendance = (db: FakeFirestore) => db.get(`events/${EVENT}/attendance/${ADA}`);
const ms = (value: unknown) => (value as Timestamp).toMillis();

/* -------------------------------------------------------------------------- */

describe('parseLandRequest', () => {
  it('refuses what is not a request at all', () => {
    expect(() => parseLandRequest(null)).toThrow(LandingInputError);
    expect(() => parseLandRequest({ records: 'nope' })).toThrow(LandingInputError);
    expect(() => parseLandRequest({ records: [{ kind: 'check-in' }] })).toThrow(LandingInputError);
    expect(() =>
      parseLandRequest({ records: Array.from({ length: 26 }, (_, i) => checkIn(START + i)) }),
    ).toThrow(LandingInputError);
    expect(() => parseLandRequest({ records: [checkIn(START), checkIn(START)] })).toThrow(
      /once per call/,
    );
  });

  it('keeps an unreadable record, rather than refusing the records beside it', () => {
    const parsed = parseLandRequest({
      records: [checkIn(START, { eventId: 'a/b' }), checkIn(START + 1, { student: undefined })],
    });
    expect(parsed.records.map((r) => r.ok)).toEqual([false, false]);
  });

  it('reads a malformed count as nothing known, not as a failure', () => {
    expect(parseLandRequest({ records: [], stillOnTablet: { count: -3 } }).stillOnTablet).toEqual({
      count: 0,
      oldestTappedAtMs: null,
    });
  });
});

describe('an arrival', () => {
  it('lands with the moment of the tap, when it reached Tally, and the date patch', async () => {
    const db = dbWithSunday();
    const tap = START + 11 * MINUTE;
    const result = await land(db, [checkIn(tap)], tap + 26 * 60 * MINUTE);

    expect(result.outcomes).toEqual([{ id: `in-${tap}-aaaa`, outcome: 'landed' }]);
    const held = attendance(db)!;
    expect(ms(held.checkedInAt)).toBe(tap);
    expect(ms(held.recordedAt)).toBe(tap + 26 * 60 * MINUTE);
    expect(held).toMatchObject({
      studentId: ADA,
      eventId: EVENT,
      seriesId: 'sunday-kids',
      checkedInBy: KIOSK,
      method: 'kiosk',
      isFirstEver: true,
      arrivalId: 'arrival-1',
      kioskRecordId: `in-${tap}-aaaa`,
    });
    expect(held.timeUncertain).toBeUndefined();

    const child = db.get(`students/${ADA}`)!;
    expect(child).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', grade: 3, updatedBy: KIOSK });
    expect(ms(child.firstAttendedAt)).toBe(START);
    expect(ms(child.lastAttendedAt)).toBe(START);
  });

  it('is not a first visit for a child who has been before, and never moves their first visit', async () => {
    const db = dbWithSunday();
    const lastWeek = START - 7 * 24 * 60 * MINUTE;
    db.seed(`students/${ADA}`, {
      firstName: 'Ada',
      firstAttendedAt: Timestamp.fromMillis(lastWeek),
      lastAttendedAt: Timestamp.fromMillis(lastWeek),
    });
    await land(db, [checkIn(START)], START + MINUTE);

    expect(attendance(db)!.isFirstEver).toBe(false);
    expect(ms(db.get(`students/${ADA}`)!.firstAttendedAt)).toBe(lastWeek);
    expect(ms(db.get(`students/${ADA}`)!.lastAttendedAt)).toBe(START);
  });

  it('is already recorded when sent again — the reply that was lost', async () => {
    const db = dbWithSunday();
    await land(db, [checkIn(START)], START + MINUTE);
    const writes = db.writes.length;
    const again = await land(db, [checkIn(START)], START + 2 * MINUTE);

    expect(again.outcomes[0]!.outcome).toBe('already-recorded');
    expect(db.writtenPaths('events/')).toHaveLength(1);
    // The count is still written; the register is not.
    expect(db.writes.slice(writes).every((w) => w.path.startsWith('kioskDevices/'))).toBe(true);
  });

  it('takes the earlier moment when a counselor recorded the same child later, and keeps theirs beside it', async () => {
    const db = dbWithSunday();
    const counselorAt = Timestamp.fromMillis(START + 60 * MINUTE);
    db.seed(`events/${EVENT}/attendance/${ADA}`, {
      studentId: ADA,
      eventId: EVENT,
      checkedInAt: counselorAt,
      checkedInBy: 'uid-counselor',
      method: 'tap',
      isFirstEver: false,
    });
    const kioskTap = START + 11 * MINUTE;
    const result = await land(db, [checkIn(kioskTap)], START + 26 * 60 * MINUTE);

    expect(result.outcomes[0]!.outcome).toBe('already-recorded');
    const held = attendance(db)!;
    expect(ms(held.checkedInAt)).toBe(kioskTap);
    expect(held).toMatchObject({ checkedInBy: KIOSK, method: 'kiosk', arrivalId: 'arrival-1', isFirstEver: false });
    expect(held.laterCheckIn).toEqual({ at: counselorAt, by: 'uid-counselor', method: 'tap' });
  });

  it('replaces the displaced entry whole — no stale "time not known", no stale arrival', async () => {
    // A tablet with a clock three hours fast landed Ada first — pulled back to
    // the server's now and flagged — under its own arrival. Another kiosk's
    // trustworthy tap, earlier and with no arrival of its own, then arrives.
    const db = dbWithSunday();
    const firstNow = START + 20 * MINUTE;
    await land(db, [checkIn(firstNow + 3 * 60 * MINUTE, { arrivalId: 'arrival-fast' })], firstNow);
    expect(ms(attendance(db)!.checkedInAt)).toBe(firstNow);
    expect(attendance(db)!.timeUncertain).toBe(true);

    const trustworthy = checkIn(START + 5 * MINUTE, { id: 'in-trust-aaaa', arrivalId: undefined });
    await land(db, [trustworthy], START + 25 * MINUTE);

    const held = attendance(db)!;
    expect(ms(held.checkedInAt)).toBe(START + 5 * MINUTE);
    expect(held.timeUncertain).toBeUndefined();
    expect(held.arrivalId).toBeUndefined();
    expect(held.kioskRecordId).toBe('in-trust-aaaa');
    // What else the document held stays as it was.
    expect(held).toMatchObject({ studentId: ADA, eventId: EVENT, isFirstEver: true });
  });

  it('keeps the counselor’s entry beside it however many earlier taps arrive after', async () => {
    const db = dbWithSunday();
    const counselorAt = Timestamp.fromMillis(START + 60 * MINUTE);
    db.seed(`events/${EVENT}/attendance/${ADA}`, {
      studentId: ADA,
      eventId: EVENT,
      checkedInAt: counselorAt,
      checkedInBy: 'uid-counselor',
      method: 'tap',
      isFirstEver: false,
    });
    await land(db, [checkIn(START + 20 * MINUTE)], START + 2 * 60 * MINUTE);
    await land(db, [checkIn(START + 10 * MINUTE, { id: 'in-second-aaaa' })], START + 2 * 60 * MINUTE);

    const held = attendance(db)!;
    expect(ms(held.checkedInAt)).toBe(START + 10 * MINUTE);
    expect(held.laterCheckIn).toEqual({ at: counselorAt, by: 'uid-counselor', method: 'tap' });
  });

  it('changes nothing when the register already has the child earlier', async () => {
    const db = dbWithSunday();
    db.seed(`events/${EVENT}/attendance/${ADA}`, {
      checkedInAt: Timestamp.fromMillis(START),
      checkedInBy: 'uid-counselor',
      method: 'tap',
    });
    const result = await land(db, [checkIn(START + 20 * MINUTE)], START + 30 * MINUTE);

    expect(result.outcomes[0]!.outcome).toBe('already-recorded');
    expect(attendance(db)!.checkedInBy).toBe('uid-counselor');
  });

  it('pulls ordinary clock drift to the window in silence, and flags a clock that is badly wrong', async () => {
    const drifted = dbWithSunday();
    await land(drifted, [checkIn(OPENS - 4 * MINUTE)], START);
    expect(ms(attendance(drifted)!.checkedInAt)).toBe(OPENS);
    expect(attendance(drifted)!.timeUncertain).toBeUndefined();

    const wrong = dbWithSunday();
    await land(wrong, [checkIn(OPENS - 3 * 60 * MINUTE)], START);
    expect(ms(attendance(wrong)!.checkedInAt)).toBe(OPENS);
    expect(attendance(wrong)!.timeUncertain).toBe(true);
  });

  it('never records a time in the future', async () => {
    const db = dbWithSunday();
    const now = START + 5 * MINUTE;
    await land(db, [checkIn(now + 2 * MINUTE)], now);
    expect(ms(attendance(db)!.checkedInAt)).toBe(now);
  });
});

describe('a pickup', () => {
  it('lands on its arrival, bounded by it, with when it reached Tally', async () => {
    const db = dbWithSunday();
    const pickup = END - 10 * MINUTE;
    const result = await land(db, [checkIn(START), checkOut(pickup)], END + 24 * 60 * MINUTE);

    expect(result.outcomes.map((o) => o.outcome)).toEqual(['landed', 'landed']);
    const held = attendance(db)!;
    expect(ms(held.checkedOutAt)).toBe(pickup);
    expect(held.checkedOutBy).toBe(KIOSK);
    expect(ms(held.checkedOutRecordedAt)).toBe(END + 24 * 60 * MINUTE);
  });

  it('takes the earlier pickup over a counselor tidying the room later, and keeps theirs beside it', async () => {
    const db = dbWithSunday();
    const tidy = Timestamp.fromMillis(END + 15 * MINUTE);
    db.seed(`events/${EVENT}/attendance/${ADA}`, {
      checkedInAt: Timestamp.fromMillis(START),
      checkedInBy: KIOSK,
      checkedOutAt: tidy,
      checkedOutBy: 'uid-counselor',
    });
    const parent = END - 15 * MINUTE;
    const result = await land(db, [checkOut(parent)], END + 60 * MINUTE);

    expect(result.outcomes[0]!.outcome).toBe('already-recorded');
    expect(ms(attendance(db)!.checkedOutAt)).toBe(parent);
    expect(attendance(db)!.laterCheckOut).toEqual({ at: tidy, by: 'uid-counselor' });
  });

  it('changes nothing when the pickup on the register is earlier', async () => {
    const db = dbWithSunday();
    db.seed(`events/${EVENT}/attendance/${ADA}`, {
      checkedInAt: Timestamp.fromMillis(START),
      checkedOutAt: Timestamp.fromMillis(END - 30 * MINUTE),
      checkedOutBy: 'uid-counselor',
    });
    const result = await land(db, [checkOut(END - 10 * MINUTE)], END);
    expect(result.outcomes[0]!.outcome).toBe('already-recorded');
    expect(attendance(db)!.checkedOutBy).toBe('uid-counselor');
  });

  it('waits for an arrival that may still be on another device, then is parked a day after', async () => {
    const db = dbWithSunday();
    const waiting = await land(db, [checkOut(END - 5 * MINUTE)], END + 60 * MINUTE);
    expect(waiting.outcomes[0]).toMatchObject({ outcome: 'waiting', waitingFor: 'arrival' });
    expect(attendance(db)).toBeUndefined();

    const parked = await land(db, [checkOut(END - 5 * MINUTE)], END + 25 * 60 * MINUTE);
    expect(parked.outcomes[0]).toMatchObject({ outcome: 'parked', reason: 'no-arrival' });
    expect(db.get(`${PARKED_COLLECTION}/check-out:${EVENT}:${ADA}`)).toMatchObject({
      reason: 'no-arrival',
      gathering: 'Sunday Kids',
      deviceId: DEVICE,
    });
  });

  it('follows an arrival that was parked, straight away', async () => {
    const db = dbWithSunday();
    db.seed(`${PARKED_COLLECTION}/check-in:${EVENT}:${ADA}`, { reason: 'frozen' });
    const result = await land(db, [checkOut(END - 5 * MINUTE)], END);
    expect(result.outcomes[0]).toMatchObject({ outcome: 'parked', reason: 'arrival-parked' });
  });
});

describe('parking', () => {
  it('keeps a record whose gathering was deleted, named by the title the kiosk knew', async () => {
    const db = dbWithSunday();
    db.data.delete(`events/${EVENT}`);
    const result = await land(db, [checkIn(START)], START + MINUTE);

    expect(result.outcomes[0]).toMatchObject({ outcome: 'parked', reason: 'gathering-deleted' });
    expect(db.get(`${PARKED_COLLECTION}/check-in:${EVENT}:${ADA}`)).toMatchObject({
      gathering: 'Sunday Kids',
      student,
      arrivalId: 'arrival-1',
    });
  });

  it('refuses a frozen child exactly as the rules do, and keeps the record for a person', async () => {
    const db = dbWithSunday();
    db.seed(`students/${ADA}`, { firstName: 'Ada', upstreamRecordMissing: true });
    const result = await land(db, [checkIn(START)], START + MINUTE);

    expect(result.outcomes[0]).toMatchObject({ outcome: 'parked', reason: 'frozen' });
    expect(attendance(db)).toBeUndefined();
  });

  it('keeps an unreadable record under its own id', async () => {
    const db = dbWithSunday();
    const result = await land(db, [checkIn(START, { id: 'weird-000001', eventId: '..' })], START);
    expect(result.outcomes[0]).toMatchObject({ outcome: 'parked', reason: 'unreadable' });
    expect(db.get(`${PARKED_COLLECTION}/unreadable:weird-000001`)).toMatchObject({ reason: 'unreadable' });
  });
});

describe('one call', () => {
  it('lands the records beside one that fails, and asks for that one again', async () => {
    class Flaky extends FakeFirestore {
      private calls = 0;
      override async runTransaction<T>(update: (tx: TransactionLike) => Promise<T>): Promise<T> {
        this.calls += 1;
        if (this.calls === 1) throw new Error('contention');
        return super.runTransaction(update);
      }
    }
    const db = new Flaky();
    for (const [path, value] of dbWithSunday().data) db.seed(path, value);

    const other = { ...checkIn(START + MINUTE), id: 'in-other-aaaa', studentId: 'student-byron' };
    const result = await land(db, [checkIn(START), other], START + 5 * MINUTE);

    expect(result.outcomes).toEqual([
      { id: `in-${START}-aaaa`, outcome: 'waiting', waitingFor: 'retry' },
      { id: 'in-other-aaaa', outcome: 'landed' },
    ]);
  });
});

describe('a pickup behind an arrival that did not land', () => {
  it('waits with it, rather than being parked as a pickup whose arrival never came', async () => {
    class Flaky extends FakeFirestore {
      private calls = 0;
      override async runTransaction<T>(update: (tx: TransactionLike) => Promise<T>): Promise<T> {
        this.calls += 1;
        if (this.calls === 1) throw new Error('contention');
        return super.runTransaction(update);
      }
    }
    const db = new Flaky();
    for (const [path, value] of dbWithSunday().data) db.seed(path, value);

    // Two days after the gathering — past the day a pickup waits for its arrival.
    const result = await land(db, [checkIn(START), checkOut(END - 5 * MINUTE)], END + 2 * 24 * 60 * MINUTE);

    expect(result.outcomes).toEqual([
      { id: `in-${START}-aaaa`, outcome: 'waiting', waitingFor: 'retry' },
      { id: `out-${END - 5 * MINUTE}-aaaa`, outcome: 'waiting', waitingFor: 'arrival' },
    ]);
    expect(db.writtenPaths('kioskParkedRecords/')).toEqual([]);
  });
});

describe('what is still on the tablet', () => {
  const device = (db: FakeFirestore) => db.get(`kioskDevices/${DEVICE}`)!;

  it('is written onto the device row, the waiting records of this call included', async () => {
    const db = dbWithSunday();
    const oldest = START - 5 * MINUTE;
    await land(db, [checkOut(END - 5 * MINUTE)], END + MINUTE, { count: 11, oldestTappedAtMs: oldest });

    expect(device(db).waitingCount).toBe(12);
    expect(ms(device(db).waitingSinceAt)).toBe(oldest);
    expect(device(db).allInAt).toBeNull();
  });

  it('says when a tablet that was holding records is empty again — and only then', async () => {
    const db = dbWithSunday();
    db.seed(`kioskDevices/${DEVICE}`, { waitingCount: 12 });
    const monday = END + 24 * 60 * MINUTE;
    await land(db, [checkIn(START)], monday);
    expect(device(db).waitingCount).toBe(0);
    expect(ms(device(db).allInAt)).toBe(monday);

    // An ordinary tap on a tablet holding nothing leaves the moment alone.
    await land(db, [{ ...checkIn(START), id: 'in-next-aaaa', studentId: 'student-byron' }], monday + MINUTE);
    expect(ms(device(db).allInAt)).toBe(monday);
  });
});
