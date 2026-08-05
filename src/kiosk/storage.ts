/**
 * The kiosk's localStorage, in one place.
 *
 * Every key is namespaced `tally:kiosk:` — the kiosk shares an origin with the
 * main app, and must never collide with `tally:roster` or `tally:theme`.
 * Reads parse defensively and answer null for anything malformed: a kiosk that
 * throws on a corrupt cache entry is a kiosk somebody has to drive out and
 * reboot.
 */

export const KIOSK_KEYS = {
  binding: 'tally:kiosk:binding',
  roster: 'tally:kiosk:roster',
  phoneIndex: 'tally:kiosk:phoneIndex',
  pending: 'tally:kiosk:pending',
  pairing: 'tally:kiosk:pairing',
  /**
   * The label printer attached to *this* device: model and loaded media.
   *
   * Deliberately not on the event, and deliberately not in Firestore. Which
   * roll is loaded is a fact about the machine in this lobby — see
   * `lib/labelTemplate.ts` — and this key is also what tells the kiosk whether
   * to load the printing module at all, so a kiosk with no printer never parses
   * a byte of it.
   */
  printer: 'tally:kiosk:printer',
} as const;

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked. The kiosk keeps working from memory; the cache
    // is a warm-start convenience, never the source of truth.
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same posture as writeJson.
  }
}
