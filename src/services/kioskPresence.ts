/**
 * When each lobby kiosk set to a gathering was last heard from, and what it is
 * called — the one fact about the kiosks a counselor's register may know.
 *
 * The device rows are core-only by design, so `onKioskDeviceWritten` copies
 * this much, one way, into `kioskPresence/{chain}`, which anybody on the chain
 * may read (docs/kiosk-offline-recovery.md §7). No counts: the owner chose the
 * smaller option for counselors. Disposable: if the copy lags or fails, or the
 * read is refused, the register simply draws no line.
 */
import { doc, onSnapshot, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { kioskName } from '@/lib/kioskDevice';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';

export interface KioskPresence {
  deviceId: string;
  name: string | null;
  lastSeenAt: Date | null;
}

/** The kiosks a presence document names, read defensively and in a stable order. */
export function toPresence(data: DocumentData | undefined): KioskPresence[] {
  const devices = data?.devices;
  if (typeof devices !== 'object' || devices === null || Array.isArray(devices)) return [];
  return Object.entries(devices as Record<string, unknown>)
    .map(([deviceId, entry]) => {
      const e = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
      return { deviceId, name: kioskName(e.name), lastSeenAt: toDateOrNull(e.lastSeenAt) };
    })
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/**
 * The kiosks set to a chain, live. A refusal — somebody not on the gathering —
 * or a failure reads as no kiosks at all, which draws nothing: this is a line
 * of help, never a reason to show an error on the register.
 */
export function subscribeKioskPresence(
  chainKey: string,
  onRows: (rows: KioskPresence[]) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, paths.kioskPresence(chainKey)),
    (snapshot) => onRows(toPresence(snapshot.data())),
    () => onRows([]),
  );
}
