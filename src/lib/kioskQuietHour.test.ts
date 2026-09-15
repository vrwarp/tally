/**
 * The hour is a shared fact, and these tests are about it staying one.
 *
 * `KioskApp` reloads in it and `docs/tablet-management.md` points Android's
 * system update window at it. The interesting assertion is not that 4 is 4 —
 * it is that the window the policy states and the hour the kiosk reloads in
 * are derived from the same constant, so a change to one cannot leave the
 * other behind.
 */
import { describe, expect, it } from 'vitest';
import { KIOSK_QUIET_HOUR, isQuietHour, quietWindowMinutes } from '@/lib/kioskQuietHour';

/** Local time, because the kiosk and the tablet's clock both are. */
function at(hour: number, minute = 0): Date {
  const d = new Date(2026, 8, 15, hour, minute, 0, 0);
  return d;
}

describe('isQuietHour', () => {
  it('is true through the whole of the quiet hour and false either side', () => {
    expect(isQuietHour(at(KIOSK_QUIET_HOUR - 1, 59))).toBe(false);
    expect(isQuietHour(at(KIOSK_QUIET_HOUR, 0))).toBe(true);
    expect(isQuietHour(at(KIOSK_QUIET_HOUR, 59))).toBe(true);
    expect(isQuietHour(at(KIOSK_QUIET_HOUR + 1, 0))).toBe(false);
  });

  it('never says yes during a gathering', () => {
    for (const hour of [9, 10, 11, 17, 18, 19, 20]) {
      expect(isQuietHour(at(hour))).toBe(false);
    }
  });
});

describe('quietWindowMinutes', () => {
  it('starts at the hour the kiosk reloads in', () => {
    expect(quietWindowMinutes().startMinutes).toBe(KIOSK_QUIET_HOUR * 60);
  });

  it('is wide enough that Android does not widen it for us', () => {
    // Android extends any window shorter than 30 minutes; a window it has to
    // correct is a window that no longer means what the policy says.
    const { startMinutes, endMinutes } = quietWindowMinutes();
    expect(endMinutes - startMinutes).toBeGreaterThanOrEqual(30);
  });

  it('is over long before anybody arrives', () => {
    // 7am is the earliest a volunteer opens a room. The window must be done.
    expect(quietWindowMinutes().endMinutes).toBeLessThan(7 * 60);
  });

  it('stays inside the day, so the window never spans midnight', () => {
    // A window whose end is less than its start means something different to
    // Android: it wraps. Nothing here intends that.
    const { startMinutes, endMinutes } = quietWindowMinutes();
    expect(startMinutes).toBeGreaterThanOrEqual(0);
    expect(endMinutes).toBeLessThanOrEqual(1439);
    expect(endMinutes).toBeGreaterThan(startMinutes);
  });
});
