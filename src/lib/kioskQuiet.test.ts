import { describe, expect, it } from 'vitest';
import { HELD_LATE_MS } from '@/lib/kioskLanding';
import { KIOSK_LIVE_WITHIN_MS, LATE_AFTER_MS, lateFromKiosks, quietOn } from '@/lib/kioskQuiet';
import { makeAttendance } from '../../tests/factories';

const MINUTE = 60_000;
// Sunday Kids, Sept 27: check-in 9:00–10:30, over at 11:00.
const SUNDAY = {
  checkInOpensAt: new Date(2026, 8, 27, 9, 0),
  checkInClosesAt: new Date(2026, 8, 27, 10, 30),
  endAt: new Date(2026, 8, 27, 11, 0),
};
const NINE_FORTY_ONE = new Date(2026, 8, 27, 9, 41);
const LOBBY = 'kiosk_kiosk-3f9a1c2e7b4d';

describe('quietOn', () => {
  it('is a kiosk that went quiet on the gathering’s day and has not been heard from since', () => {
    expect(quietOn(NINE_FORTY_ONE, SUNDAY, new Date(2026, 8, 27, 10, 15).getTime())).toBe(true);
    // Still quiet on Monday: the line is about Sunday, and still true.
    expect(quietOn(NINE_FORTY_ONE, SUNDAY, new Date(2026, 8, 28, 9, 0).getTime())).toBe(true);
  });

  it('is not a kiosk still reporting', () => {
    const nowMs = NINE_FORTY_ONE.getTime() + KIOSK_LIVE_WITHIN_MS - 1;
    expect(quietOn(NINE_FORTY_ONE, SUNDAY, nowMs)).toBe(false);
    expect(quietOn(NINE_FORTY_ONE, SUNDAY, nowMs + 1)).toBe(true);
  });

  it('counts a kiosk set up before the window opened, and one quiet after it closed, on the same day', () => {
    const later = new Date(2026, 8, 28, 9, 0).getTime();
    expect(quietOn(new Date(2026, 8, 27, 0, 0), SUNDAY, later)).toBe(true);
    expect(quietOn(new Date(2026, 8, 27, 23, 59, 59), SUNDAY, later)).toBe(true);
    // The day's last millisecond is still the day.
    expect(quietOn(new Date(2026, 8, 27, 23, 59, 59, 999), SUNDAY, later)).toBe(true);
  });

  it('says nothing about a kiosk that went quiet on another occurrence of the chain', () => {
    const lastSunday = new Date(2026, 8, 20, 9, 41);
    expect(quietOn(lastSunday, SUNDAY, new Date(2026, 8, 27, 10, 0).getTime())).toBe(false);
    expect(quietOn(new Date(2026, 8, 26, 23, 59, 59), SUNDAY, new Date(2026, 8, 27, 10, 0).getTime())).toBe(
      false,
    );
    expect(quietOn(new Date(2026, 8, 28, 0, 0), SUNDAY, new Date(2026, 8, 28, 9, 0).getTime())).toBe(false);
  });

  it('measures the day to whichever is later, the window’s close or the gathering’s end', () => {
    const lateNight = { ...SUNDAY, checkInClosesAt: new Date(2026, 8, 28, 0, 30), endAt: null };
    expect(quietOn(new Date(2026, 8, 28, 0, 10), lateNight, new Date(2026, 8, 28, 9, 0).getTime())).toBe(true);
    const longEvent = { ...SUNDAY, endAt: new Date(2026, 8, 28, 1, 0) };
    expect(quietOn(new Date(2026, 8, 28, 0, 40), longEvent, new Date(2026, 8, 28, 9, 0).getTime())).toBe(true);
  });

  it('says nothing about a kiosk that has never reported', () => {
    expect(quietOn(null, SUNDAY, new Date(2026, 8, 27, 10, 0).getTime())).toBe(false);
  });
});

describe('lateFromKiosks', () => {
  const at = (minutes: number) => new Date(NINE_FORTY_ONE.getTime() + minutes * MINUTE);

  it('counts what each kiosk kept through an outage, arrivals and pickups, and when the last arrived', () => {
    const late = lateFromKiosks([
      makeAttendance({
        studentId: 'ada',
        checkedInBy: LOBBY,
        checkedInAt: at(0),
        recordedAt: at(24 * 60),
        checkedOutBy: LOBBY,
        checkedOutAt: at(70),
        checkedOutRecordedAt: at(24 * 60 + 1),
      }),
      makeAttendance({ studentId: 'byron', checkedInBy: LOBBY, checkedInAt: at(3), recordedAt: at(24 * 60) }),
    ]);
    expect(late).toEqual([{ deviceId: 'kiosk-3f9a1c2e7b4d', count: 3, allInAt: at(24 * 60 + 1) }]);
  });

  it('keeps the latest arrival as the moment it was all in, whatever order they come in', () => {
    const late = lateFromKiosks([
      makeAttendance({ studentId: 'a', checkedInBy: LOBBY, checkedInAt: at(0), recordedAt: at(90) }),
      makeAttendance({ studentId: 'b', checkedInBy: LOBBY, checkedInAt: at(0), recordedAt: at(30) }),
    ]);
    expect(late[0]!.allInAt).toEqual(at(90));
  });

  it('is not late at the kiosk’s own threshold, and late past it', () => {
    const one = (delay: number) =>
      lateFromKiosks([
        makeAttendance({
          studentId: 'a',
          checkedInBy: LOBBY,
          checkedInAt: at(0),
          recordedAt: new Date(at(0).getTime() + delay),
        }),
      ]);
    expect(one(LATE_AFTER_MS)).toEqual([]);
    expect(one(LATE_AFTER_MS + 1)).toHaveLength(1);
  });

  it('is the landing’s own measure, so "arrived late" and "all in Tally since" agree', () => {
    expect(LATE_AFTER_MS).toBe(HELD_LATE_MS);
  });

  it('says nothing of what a person recorded, or a kiosk record with no recorded moment', () => {
    expect(
      lateFromKiosks([
        makeAttendance({ studentId: 'a', checkedInBy: 'uid-casey', checkedInAt: at(0), recordedAt: at(90) }),
        makeAttendance({ studentId: 'b', checkedInBy: LOBBY, checkedInAt: at(0) }),
        makeAttendance({ studentId: 'c', checkedOutBy: LOBBY, checkedOutAt: null, checkedOutRecordedAt: at(90) }),
      ]),
    ).toEqual([]);
  });

  it('lists each kiosk apart, the one that kept the most first', () => {
    const NURSERY = 'kiosk_kiosk-8b13aa2c90ff';
    const late = lateFromKiosks([
      makeAttendance({ studentId: 'a', checkedInBy: NURSERY, checkedInAt: at(0), recordedAt: at(90) }),
      makeAttendance({ studentId: 'b', checkedInBy: LOBBY, checkedInAt: at(0), recordedAt: at(90) }),
      makeAttendance({ studentId: 'c', checkedInBy: LOBBY, checkedInAt: at(0), recordedAt: at(90) }),
    ]);
    expect(late.map((each) => [each.deviceId, each.count])).toEqual([
      ['kiosk-3f9a1c2e7b4d', 2],
      ['kiosk-8b13aa2c90ff', 1],
    ]);
  });

  it('orders kiosks that kept as many by id', () => {
    const late = lateFromKiosks([
      makeAttendance({ studentId: 'a', checkedInBy: 'kiosk_kiosk-zzzz0000', checkedInAt: at(0), recordedAt: at(90) }),
      makeAttendance({ studentId: 'b', checkedInBy: 'kiosk_kiosk-aaaa0000', checkedInAt: at(0), recordedAt: at(90) }),
    ]);
    expect(late.map((each) => each.deviceId)).toEqual(['kiosk-aaaa0000', 'kiosk-zzzz0000']);
  });
});
