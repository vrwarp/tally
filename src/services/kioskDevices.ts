/**
 * The lobby screens, as rows the team can read.
 *
 * A kiosk is a room rather than a volunteer: it holds its own identity, and
 * `kioskDevices/{deviceId}` is its standing — the rules admit a kiosk session
 * while that row exists and nothing has retired it, and read nobody's profile.
 * So the row is also the only place the team can look to answer "which tablets
 * are ours, who put them there, and is that one in the nursery still working".
 *
 * Two things this service deliberately cannot do.
 *
 * **It never creates a row.** `claimKioskToken` writes one when a pairing is
 * approved, with the approver's name as of that moment, and the rules refuse a
 * create from any browser. A row written from here would be a device that was
 * never paired.
 *
 * **It never deletes one, and retiring only marks it.** The row is the
 * provenance of every morning that kiosk recorded — `checkedInBy` on those
 * registers is the kiosk's own uid, and this row is what turns that uid back
 * into "the tablet Miriam paired in the lobby on the 3rd". A device row costs
 * nothing to keep, so there is no sweep either. The rules enforce the same
 * shape: core and up may write `retiredAt` and `retiredBy`, in their own name,
 * and never back to null.
 */
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import type { KioskDevice } from '@/types';

/**
 * A device row, hydrated.
 *
 * `pairedAt` is nullable here where the stored shape has it required: a row
 * read back in the instant between `claimKioskToken` writing it and the server
 * resolving its `serverTimestamp()` has nothing in that field, and a screen
 * that trusted the type would print "Invalid Date" beside a kiosk somebody is
 * standing in front of.
 */
/**
 * How recently a bound kiosk must have reported to count as live.
 *
 * The kiosk writes `lastSeenAt` on every register poll — every thirty seconds
 * while it is bound and its window is open — so three minutes is six missed
 * reports. Short enough that a tablet somebody unplugged after the service
 * stops claiming to be working; long enough that a lobby wifi blip does not
 * make a screen with a parent in front of it read as dead.
 */
export const KIOSK_LIVE_WITHIN_MS = 3 * 60_000;

function toKioskDevice(snapshot: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): KioskDevice {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : '',
    approvedByName: typeof data.approvedByName === 'string' ? data.approvedByName : null,
    pairedAt: toDateOrNull(data.pairedAt),
    lastSeenAt: toDateOrNull(data.lastSeenAt),
    boundTo: typeof data.boundTo === 'string' ? data.boundTo : null,
    boundChain: typeof data.boundChain === 'string' ? data.boundChain : null,
    retiredAt: toDateOrNull(data.retiredAt),
    retiredBy: typeof data.retiredBy === 'string' ? data.retiredBy : null,
  };
}

/**
 * Is this kiosk standing in a room and recording right now?
 *
 * Both halves are needed and they fail differently. A retired row is a device
 * that is nobody, whatever it last said; a bound row that stopped reporting is
 * a tablet in a cupboard. Only a row that is live in both senses makes Retire
 * an act that takes something away, which is what arms the confirmation on the
 * person page.
 */
export function isKioskLive(device: KioskDevice, nowMs: number): boolean {
  if (device.retiredAt) return false;
  if (!device.boundChain) return false;
  const seen = device.lastSeenAt?.getTime();
  return seen !== undefined && nowMs - seen < KIOSK_LIVE_WITHIN_MS;
}

/**
 * Every device row, live. Core and up; a kiosk session may not read this.
 *
 * The whole collection rather than a query per person, for the reason
 * `subscribeEventAccess` reads the whole access collection: the readers want
 * different cuts of it — the kiosks one person paired, on their page; every
 * kiosk, on the pairing screen — and a ministry has a handful of tablets, not
 * a collection worth paging.
 *
 * Retired rows come through on purpose. They are the provenance of the
 * registers those devices recorded, and a screen that hid them would make a
 * retired kiosk indistinguishable from one that was never paired.
 */
export function subscribeKioskDevices(
  onChange: (devices: KioskDevice[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, paths.kioskDevicesCollection()),
    (snapshot) => onChange(snapshot.docs.map(toKioskDevice)),
    (error) => onError?.(error),
  );
}

/**
 * Puts a kiosk down, and says who did it.
 *
 * `updateDoc` on exactly the two fields, like `clearAccessRequest`: the rules
 * admit a change to `retiredAt` and `retiredBy` and nothing else, and a
 * whole-document write reads as touching every key — including `approvedBy`
 * and the name it was approved under, which are the custody record.
 *
 * The kiosk finds out on its next refused write rather than being told: it
 * re-reads the register, and a refusal there is the one refusal that cannot be
 * about a student. That is why nothing here notifies anything.
 */
export async function retireKioskDevice(deviceId: string, byUid: string): Promise<void> {
  await updateDoc(doc(db, paths.kioskDevice(deviceId)), {
    retiredAt: serverTimestamp(),
    retiredBy: byUid,
  });
}
