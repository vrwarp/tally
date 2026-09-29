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
import { kioskName } from '@/lib/kioskDevice';
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
 * The kiosk writes `lastSeenAt` on every register poll, which is every five
 * minutes while it is bound (`PRESENT_REFRESH_MS` in `KioskApp`) — so twelve
 * minutes is two missed reports and some slack. It was three, on a comment
 * that said the poll ran every thirty seconds: a healthy kiosk read *not
 * recording* two minutes in every five, and was retired on one unconfirmed
 * tap while it did (docs/kiosk-offline-recovery.md). Widened rather than
 * reported more often, because a report is a write per kiosk per poll and the
 * window only has to be true.
 */
export const KIOSK_LIVE_WITHIN_MS = 12 * 60_000;

function toKioskDevice(snapshot: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): KioskDevice {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    name: kioskName(data.name),
    approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : '',
    approvedByName: typeof data.approvedByName === 'string' ? data.approvedByName : null,
    pairedAt: toDateOrNull(data.pairedAt),
    lastSeenAt: toDateOrNull(data.lastSeenAt),
    boundTo: typeof data.boundTo === 'string' ? data.boundTo : null,
    boundChain: typeof data.boundChain === 'string' ? data.boundChain : null,
    // Left off the object entirely when the tablet does not report them, so
    // "does not say" and "flat" stay different things on the way to the screen.
    ...(typeof data.batteryLevel === 'number' ? { batteryLevel: data.batteryLevel } : {}),
    ...(typeof data.charging === 'boolean' ? { charging: data.charging } : {}),
    // What `landKioskRecords` last heard was still on the tablet — see
    // functions/src/kiosk/landing.ts. Absent on a kiosk that has never sent.
    ...(typeof data.waitingCount === 'number' ? { waitingCount: data.waitingCount } : {}),
    ...('waitingSinceAt' in data ? { waitingSinceAt: toDateOrNull(data.waitingSinceAt) } : {}),
    ...('allInAt' in data ? { allInAt: toDateOrNull(data.allInAt) } : {}),
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
 * When a kiosk that went quiet while set to a gathering was last heard from —
 * or null for one that is live, retired, or was last set to nothing.
 *
 * Tally cannot see the tablet, but it knows enough to say the true thing: a
 * kiosk records on its own storage whether or not it can reach Tally, and it
 * leaves its gathering on this row when it loses the internet, because the
 * report that would clear it never lands. So a bound row that stopped
 * reporting is, almost always, a kiosk still recording in a lobby whose
 * internet went — not one that stopped. See docs/kiosk-offline-recovery.md §7.
 */
export function kioskOutOfTouchSince(device: KioskDevice, nowMs: number): Date | null {
  if (device.retiredAt || !device.boundChain || !device.lastSeenAt) return null;
  return isKioskLive(device, nowMs) ? null : device.lastSeenAt;
}

/**
 * Whether retiring this kiosk could take something away: a kiosk recording
 * now; one last heard from while set to a gathering, which may be holding that
 * gathering's check-ins until it can reach Tally; or one that told Tally it
 * still holds some — `landKioskRecords` writes the count on every call, so a
 * tablet set to nothing with a pickup waiting a day for another device's
 * arrival says so. All three get asked first.
 */
export function kioskMayHoldRecords(device: KioskDevice, nowMs: number): boolean {
  return (
    isKioskLive(device, nowMs) ||
    kioskOutOfTouchSince(device, nowMs) !== null ||
    (!device.retiredAt && (device.waitingCount ?? 0) > 0)
  );
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
 * The kiosk finds out the next time it reaches Tally rather than being told:
 * its standing report is refused, or its upload is, and either refusal is the
 * one that cannot be about a student. It then shows a pairing code, and keeps
 * whatever records it holds until it is paired again. That is why nothing
 * here notifies anything.
 */
export async function retireKioskDevice(deviceId: string, byUid: string): Promise<void> {
  await updateDoc(doc(db, paths.kioskDevice(deviceId)), {
    retiredAt: serverTimestamp(),
    retiredBy: byUid,
  });
}

/**
 * Gives a kiosk a name, or takes its name away — the core team's, on the
 * Kiosk page. Whoever paired it may have named it already; this is the
 * rename.
 *
 * `updateDoc` on the one field, which is all the rules admit from core, tidied
 * by the same `kioskName` the pairing uses so a name means one thing. A name
 * that says nothing stores null, and every screen goes back to the id.
 */
export async function renameKioskDevice(deviceId: string, name: string): Promise<void> {
  await updateDoc(doc(db, paths.kioskDevice(deviceId)), { name: kioskName(name) });
}
