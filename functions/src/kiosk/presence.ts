/**
 * What a counselor's register may know about the lobby kiosks: when each kiosk
 * set to their gathering was last heard from, and what it is called.
 *
 * The device rows are core-only by design — they say who paired a tablet and
 * what it still holds — so this copies one fact, one way, into
 * `kioskPresence/{chain}`, which anybody on that chain may read
 * (docs/kiosk-offline-recovery.md §7). A kiosk leaves its gathering on its row
 * when it loses the internet, because the report that would clear it never
 * lands; so a row set to a chain and gone quiet is, almost always, a kiosk
 * still recording in a lobby whose internet went — and the register can say
 * that, with no counts: the owner chose the smaller option for counselors.
 *
 * Derived and disposable: if the copy lags or fails, counselors simply see no
 * line. In a transaction, because every kiosk set to one chain writes the same
 * document.
 */
import type { FirestoreLike } from '../firestore.js';
import { PATHS, toDateOrNull } from '../firestore.js';
import { kioskName } from '../generated/kioskName.js';

/** One kiosk, as a register sees it. */
export interface PresenceEntry {
  name: string | null;
  /** The device row's own `lastSeenAt`, passed through; null before its first report. */
  lastSeenAt: unknown;
}

type Row = Record<string, unknown> | undefined;

/** The chain a row places its kiosk on — or null: set to nothing, retired, or gone. */
export function presenceChain(row: Row): string | null {
  if (!row || row.retiredAt != null) return null;
  return typeof row.boundChain === 'string' && row.boundChain.length > 0 ? row.boundChain : null;
}

function entryOf(row: Record<string, unknown>): PresenceEntry {
  return { name: kioskName(row.name), lastSeenAt: row.lastSeenAt ?? null };
}

/** Whether a register would read the two rows the same way. */
function sameEntry(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return (
    kioskName(before.name) === kioskName(after.name) &&
    (toDateOrNull(before.lastSeenAt)?.getTime() ?? null) ===
      (toDateOrNull(after.lastSeenAt)?.getTime() ?? null)
  );
}

function devicesOf(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const devices = data?.devices;
  return typeof devices === 'object' && devices !== null && !Array.isArray(devices)
    ? { ...(devices as Record<string, unknown>) }
    : {};
}

/**
 * Brings the presence documents into step with one device row's change.
 *
 * Leaving a chain — set to another, set to nothing, retired, the row gone —
 * takes the kiosk off that chain's document; standing on one puts it there with
 * its name and when it was last heard from. Anything a register would not see —
 * a battery, a count from `landKioskRecords` — writes nothing, so the copy
 * costs a write per report and no more.
 */
export async function syncKioskPresence(
  db: FirestoreLike,
  deviceId: string,
  before: Row,
  after: Row,
): Promise<'unchanged' | 'written'> {
  const was = presenceChain(before);
  const is = presenceChain(after);
  if (was === is && (is === null || sameEntry(before!, after!))) return 'unchanged';

  await db.runTransaction(async (tx) => {
    const leftRef = was !== null && was !== is ? db.doc(`${PATHS.kioskPresence}/${was}`) : null;
    const onRef = is !== null ? db.doc(`${PATHS.kioskPresence}/${is}`) : null;
    const left = leftRef ? await tx.get(leftRef) : null;
    const on = onRef ? await tx.get(onRef) : null;

    if (leftRef && left?.exists) {
      const devices = devicesOf(left.data());
      delete devices[deviceId];
      tx.set(leftRef, { chainKey: was, devices });
    }
    if (onRef && after) {
      const devices = devicesOf(on?.exists ? on.data() : undefined);
      devices[deviceId] = entryOf(after);
      tx.set(onRef, { chainKey: is, devices });
    }
  });
  return 'written';
}
