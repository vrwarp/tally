/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/kioskDevice.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * Who a kiosk is, to the server.
 *
 * A kiosk is a room, not a volunteer. Its session is a custom token minted for
 * a uid of its own — `kiosk_<deviceId>` — carrying `{ kiosk: true, deviceId }`,
 * where the device id is one the kiosk mints for itself and keeps in its own
 * storage (`src/kiosk/storage.ts`). Its standing is the `kioskDevices/{deviceId}`
 * row the claim writes, and nothing about the person who approved the pairing.
 *
 * Shared with the functions (`scripts/sync-functions-shared.mjs`) so the uid
 * the server mints, the uid the rules restate as `'kiosk_' + deviceId`, and
 * the uid the register export recognises as a lobby screen cannot drift.
 */

/**
 * Minted by the kiosk: opaque, bounded, one path segment, no `/`.
 *
 * The disable below is about the runner, not about the tests. Both constants
 * here are module-level, evaluated once when the file loads, so Stryker's
 * per-test hot-swap never gets to substitute them and reports them survived
 * without having run a test against them — `ignoreStatic` in
 * `stryker.config.json` notwithstanding. They are neither equivalent nor
 * untested: apply any of the four regex mutants by hand and
 * `kioskDevice.test.ts` fails three times over, on the leading anchor, the
 * trailing anchor and the bound.
 */
// Stryker disable next-line Regex: static; see above.
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

// Stryker disable next-line StringLiteral: static, as above — and emptying it
// makes every well-formed uid read as a device, which `deviceIdOfUid` is
// asserted against directly.
export const KIOSK_UID_PREFIX = 'kiosk_';

export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

/** The uid a kiosk's token is minted for. */
export function kioskUid(deviceId: string): string {
  return `${KIOSK_UID_PREFIX}${deviceId}`;
}

/** The device id inside a kiosk uid, or null for a person's. */
export function deviceIdOfUid(uid: string): string | null {
  if (!uid.startsWith(KIOSK_UID_PREFIX)) return null;
  const id = uid.slice(KIOSK_UID_PREFIX.length);
  return isDeviceId(id) ? id : null;
}

/**
 * The longest name a kiosk may carry, in UTF-16 units — so a name within it is
 * within any count of characters the rules make (`firestore.rules`).
 *
 * Short on purpose: a name lands inside sentences on the event page and the
 * counselors' register — *Lobby hasn't been heard from since 9:41* — and on a
 * phone's one line.
 */
export const KIOSK_NAME_MAX = 40;

/**
 * A kiosk's name as typed, tidied: *Lobby*, *Nursery door*. Null for anything
 * that says nothing, which every screen reads as "no name" and falls back to
 * the device id.
 *
 * Whoever pairs a kiosk may name it, and the core team may rename it later;
 * both paths tidy through here so a name cannot mean two things. Cut at a
 * whole character, never inside one.
 */
export function kioskName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tidy = value.replace(/\s+/g, ' ').trim();
  let name = '';
  for (const character of tidy) {
    if (name.length + character.length > KIOSK_NAME_MAX) break;
    name += character;
  }
  // A cut that lands just after a space would leave it hanging.
  name = name.trimEnd();
  return name.length > 0 ? name : null;
}
