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

/** Minted by the kiosk: opaque, bounded, one path segment, no `/`. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

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
