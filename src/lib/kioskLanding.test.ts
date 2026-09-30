import { describe, expect, it } from 'vitest';
import {
  PICKUP_WAIT_MS,
  TAP_SLACK_MS,
  arrivalDates,
  boundTapTime,
  decideCheckIn,
  decideCheckOut,
  isRecordId,
  parkedRecordId,
  pickupWaitsUntil,
} from '@/lib/kioskLanding';

const NINE = Date.UTC(2026, 8, 27, 16, 0); // 9:00 in the lobby
const MINUTE = 60_000;

describe('isRecordId', () => {
  it('accepts what the kiosk mints', () => {
    expect(isRecordId('3178f37e-32b1-4be2-b694-e454ac92c738')).toBe(true);
    expect(isRecordId('r_12345678')).toBe(true);
  });

  it('refuses a path, a paste or nothing', () => {
    expect(isRecordId('a/b-12345678')).toBe(false);
    expect(isRecordId('short')).toBe(false);
    expect(isRecordId('x'.repeat(65))).toBe(false);
    expect(isRecordId(12345678)).toBe(false);
    expect(isRecordId(null)).toBe(false);
  });
});

describe('boundTapTime', () => {
  it('leaves a time inside its bounds exactly as tapped', () => {
    expect(boundTapTime(NINE + 5 * MINUTE, NINE, NINE + 60 * MINUTE)).toEqual({
      atMs: NINE + 5 * MINUTE,
      uncertain: false,
    });
  });

  it('pulls ordinary drift to the bound and says nothing more', () => {
    // A tablet a few minutes slow, and one a few minutes fast.
    expect(boundTapTime(NINE - 3 * MINUTE, NINE, NINE + 60 * MINUTE)).toEqual({
      atMs: NINE,
      uncertain: false,
    });
    expect(boundTapTime(NINE + 63 * MINUTE, NINE, NINE + 60 * MINUTE)).toEqual({
      atMs: NINE + 60 * MINUTE,
      uncertain: false,
    });
  });

  it('holds fifteen minutes exactly as drift, and one millisecond more as a wrong clock', () => {
    expect(boundTapTime(NINE - TAP_SLACK_MS, NINE, NINE + MINUTE).uncertain).toBe(false);
    expect(boundTapTime(NINE - TAP_SLACK_MS - 1, NINE, NINE + MINUTE).uncertain).toBe(true);
    expect(boundTapTime(NINE + MINUTE + TAP_SLACK_MS, NINE, NINE + MINUTE).uncertain).toBe(false);
    expect(boundTapTime(NINE + MINUTE + TAP_SLACK_MS + 1, NINE, NINE + MINUTE).uncertain).toBe(true);
  });

  it('never lets a time into the future, even where the bounds cross', () => {
    // The tablet is two minutes fast: it believes the window opened at 9:00,
    // and the server's clock says 8:58.
    const serverNow = NINE - 2 * MINUTE;
    expect(boundTapTime(NINE + 30_000, NINE, serverNow)).toEqual({ atMs: serverNow, uncertain: false });
  });

  it('flags a tablet whose clock is a day out, and keeps the time it can defend', () => {
    expect(boundTapTime(NINE + 24 * 60 * MINUTE, NINE, NINE + 60 * MINUTE)).toEqual({
      atMs: NINE + 60 * MINUTE,
      uncertain: true,
    });
  });
});

describe('decideCheckIn', () => {
  it('creates an arrival the register does not have', () => {
    expect(decideCheckIn(null, NINE)).toBe('create');
  });

  it('keeps the earlier moment when two devices saw the same arrival', () => {
    // A counselor re-recorded the child at 10:30 during the outage; the kiosk
    // saw her at 9:41.
    expect(decideCheckIn(NINE + 90 * MINUTE, NINE + 41 * MINUTE)).toBe('move-earlier');
    expect(decideCheckIn(NINE + 41 * MINUTE, NINE + 90 * MINUTE)).toBe('already');
  });

  it('treats the same moment twice as the same record — a lost reply, sent again', () => {
    expect(decideCheckIn(NINE, NINE)).toBe('already');
  });
});

describe('decideCheckOut', () => {
  const base = { arrivalParked: false, tapMs: NINE + 105 * MINUTE, nowMs: NINE + 110 * MINUTE, waitsUntilMs: NINE + 30 * 60 * MINUTE };

  it('records a first pickup', () => {
    expect(decideCheckOut({ ...base, arrival: { checkedOutAtMs: null } })).toBe('record');
  });

  it('keeps the earlier pickup, and changes nothing for a later one', () => {
    expect(decideCheckOut({ ...base, arrival: { checkedOutAtMs: NINE + 135 * MINUTE } })).toBe(
      'move-earlier',
    );
    expect(decideCheckOut({ ...base, arrival: { checkedOutAtMs: NINE + 100 * MINUTE } })).toBe('already');
    expect(decideCheckOut({ ...base, arrival: { checkedOutAtMs: base.tapMs } })).toBe('already');
  });

  it('waits for an arrival that may still be on another device', () => {
    expect(decideCheckOut({ ...base, arrival: null })).toBe('wait');
  });

  it('parks a pickup whose arrival never came, once the wait is over', () => {
    expect(decideCheckOut({ ...base, arrival: null, nowMs: base.waitsUntilMs + 1 })).toEqual({
      park: 'no-arrival',
    });
    expect(decideCheckOut({ ...base, arrival: null, nowMs: base.waitsUntilMs })).toBe('wait');
  });

  it('parks a pickup with its parked arrival straight away', () => {
    expect(decideCheckOut({ ...base, arrival: null, arrivalParked: true })).toEqual({
      park: 'arrival-parked',
    });
  });
});

describe('pickupWaitsUntil', () => {
  it('is a day after the later of the end and the window closing', () => {
    expect(pickupWaitsUntil(NINE + 90 * MINUTE, NINE + 120 * MINUTE)).toBe(
      NINE + 120 * MINUTE + PICKUP_WAIT_MS,
    );
    expect(pickupWaitsUntil(NINE + 90 * MINUTE, NINE + 60 * MINUTE)).toBe(
      NINE + 90 * MINUTE + PICKUP_WAIT_MS,
    );
    expect(pickupWaitsUntil(NINE + 90 * MINUTE, null)).toBe(NINE + 90 * MINUTE + PICKUP_WAIT_MS);
  });
});

describe('arrivalDates', () => {
  it('writes both dates for a child who has never come', () => {
    expect(arrivalDates(null, null, NINE)).toEqual({ firstAttendedAtMs: NINE, lastAttendedAtMs: NINE });
  });

  it('never moves the first visit, and moves the last one only forward', () => {
    const lastWeek = NINE - 7 * 24 * 60 * MINUTE;
    expect(arrivalDates(lastWeek, lastWeek, NINE)).toEqual({ lastAttendedAtMs: NINE });
    // Recording an old gathering after a newer one changes nothing.
    expect(arrivalDates(lastWeek, NINE, lastWeek)).toBeNull();
  });
});

describe('parkedRecordId', () => {
  it('is one document per child, gathering and verb', () => {
    expect(parkedRecordId('check-in', 'sunday-2026-09-27', 'pco-1')).toBe(
      'check-in:sunday-2026-09-27:pco-1',
    );
    expect(parkedRecordId('check-out', 'sunday-2026-09-27', 'pco-1')).not.toBe(
      parkedRecordId('check-in', 'sunday-2026-09-27', 'pco-1'),
    );
  });
});
