/**
 * Which kiosks were paired, by whom, and whether they still stand.
 *
 * A kiosk is a room, not a volunteer. Its session used to be a custom token
 * minted for the *approver's* uid, so every rule it passed read the approver's
 * profile — and the day an admin suspended the volunteer who had paired the
 * lobby tablet in September, the tablet went on ticking children green with
 * every write refused, because nothing anywhere said a kiosk was signed in as
 * that person. Now the token is minted for `kiosk_<deviceId>`, and the row
 * written here at claim time is the kiosk's standing: `firestore.rules`'
 * `isLiveKiosk()` admits a kiosk session while its row exists and nobody has
 * retired it, and reads no profile at all.
 *
 * The device id is minted by the kiosk and kept in its own storage. Duplicates
 * are expected: an installed web app gets its own storage container, so a
 * kiosk paired in Safari and then installed comes up with a fresh id and a
 * second row (`src/kiosk/install.ts` documents the ordering that avoids it).
 * Rows are never deleted and never swept — a row is the provenance of every
 * morning that kiosk recorded, which is why retiring one is a mark.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { FirestoreLike } from '../firestore.js';
import { isDeviceId } from '../generated/kioskDevice.js';

export { DEVICE_ID_PATTERN, deviceIdOfUid, isDeviceId, kioskUid } from '../generated/kioskDevice.js';

export const DEVICES_COLLECTION = 'kioskDevices';

/**
 * A kiosk seen within a fortnight, or bound right now, is "the kiosk in the
 * lobby"; anything older is a tablet in a drawer. The person page draws the
 * difference so a Retire on a live device can arm first.
 */
export const LIVE_WITHIN_MS = 14 * 86_400_000;

export interface KioskDeviceRecord {
  approvedBy: string;
  /** Denormalised at claim time, as `transitions.releasedByName` is. */
  approvedByName: string | null;
  pairedAt: Timestamp;
  /** Updated by the kiosk; null until it first reports in. */
  lastSeenAt: Timestamp | null;
  /** The title of the gathering the kiosk is bound to, or null between gatherings. */
  boundTo: string | null;
  /** The chain it is bound to — the whole of its reach in the rules. */
  boundChain: string | null;
  retiredAt: Timestamp | null;
  retiredBy: string | null;
}

/**
 * Records that `deviceId` now holds a session, approved by `approver`.
 *
 * A re-claim by the same device replaces the previous row wholesale — the
 * session it described no longer exists — except that a retired row stays
 * retired: re-pairing is how a retired tablet comes back, and that is a
 * decision for the person approving the new code, so the retirement is
 * cleared here deliberately and visibly.
 */
export async function recordPairedDevice(
  db: FirestoreLike,
  deviceId: string,
  approver: { uid: string; name: string | null },
  now: Date,
): Promise<void> {
  if (!isDeviceId(deviceId)) return;
  const record: KioskDeviceRecord = {
    approvedBy: approver.uid,
    approvedByName: approver.name,
    pairedAt: Timestamp.fromDate(now),
    lastSeenAt: null,
    boundTo: null,
    boundChain: null,
    retiredAt: null,
    retiredBy: null,
  };
  await db.doc(`${DEVICES_COLLECTION}/${deviceId}`).set({ ...record });
}

/** The row for a device, or null when there is none or it has been retired. */
export async function readLiveDevice(
  db: FirestoreLike,
  deviceId: string,
): Promise<KioskDeviceRecord | null> {
  if (!isDeviceId(deviceId)) return null;
  const snapshot = await db.doc(`${DEVICES_COLLECTION}/${deviceId}`).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  if (data.retiredAt != null) return null;
  return {
    approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : '',
    approvedByName: typeof data.approvedByName === 'string' ? data.approvedByName : null,
    pairedAt: data.pairedAt instanceof Timestamp ? data.pairedAt : Timestamp.fromDate(new Date(0)),
    lastSeenAt: data.lastSeenAt instanceof Timestamp ? data.lastSeenAt : null,
    boundTo: typeof data.boundTo === 'string' ? data.boundTo : null,
    boundChain: typeof data.boundChain === 'string' ? data.boundChain : null,
    retiredAt: null,
    retiredBy: null,
  };
}
