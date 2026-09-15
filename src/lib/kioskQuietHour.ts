/**
 * The one hour of the day the kiosk is allowed to be unavailable.
 *
 * A lobby screen runs for weeks without a reload. Somewhere in that run it has
 * to shed what Chromium accumulates and pick up whatever has been deployed, and
 * `KioskApp` does both at once by reloading itself — but only while unbound and
 * unattended, because the one thing worse than a stale kiosk is a blank one
 * with a parent in front of it.
 *
 * This lives in `lib` rather than inside `KioskApp` because the hour is no
 * longer only the kiosk's business. A managed tablet wants Android's own system
 * update window pointed at the same hour (`docs/tablet-management.md` §4.1), so
 * that the OS, Play and the kiosk all disturb the room at the same time and at
 * no other. Two numbers that must agree should not be invisible to each other,
 * and the setup page that states the second one reads it from here.
 *
 * Local time throughout. A church gathers on local Sunday morning and the
 * tablet's clock is the only one anybody in the building can check.
 */

/** Local hour the kiosk reloads in: 4am. */
export const KIOSK_QUIET_HOUR = 4;

/**
 * How long the window is, in hours.
 *
 * The reload takes seconds; the width is for the *system update* window, which
 * Android treats as a maintenance period rather than an instant and extends to
 * 30 minutes if given less. Ninety minutes is comfortably more than that and
 * still finishes long before anybody arrives.
 */
export const KIOSK_QUIET_HOURS_WIDE = 1.5;

/** Whether `at` falls in the quiet hour. Defaults to now, as the caller means. */
export function isQuietHour(at: Date = new Date()): boolean {
  return at.getHours() === KIOSK_QUIET_HOUR;
}

/**
 * The same hour as Android's `systemUpdate` window wants it: minutes after
 * local midnight, start and end.
 *
 * Stated here so the policy a church pastes into its device management console
 * cannot drift from the hour the kiosk actually reloads in.
 */
export function quietWindowMinutes(): { startMinutes: number; endMinutes: number } {
  const startMinutes = KIOSK_QUIET_HOUR * 60;
  return { startMinutes, endMinutes: startMinutes + Math.round(KIOSK_QUIET_HOURS_WIDE * 60) };
}
