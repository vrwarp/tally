/**
 * The backdrop's pixels, kept on this device.
 *
 * A backdrop is fetched at most once per photograph per kiosk: the id is
 * content-addressed (see `lib/kioskBackdrop.ts`), so the copy under
 * `tally-kiosk-backdrops` in the Cache API is the truth about that id forever,
 * and the ~4am reload, a reboot, and the offline Sunday all repaint it without
 * a byte of network. The Cache API rather than localStorage, deliberately:
 * localStorage is the synchronous store the warm boot reads its roster out of,
 * and a third of a megabyte of base64 in there would be parsed on the one path
 * this repo defends hardest (docs/kiosk-performance.md). Here the bytes stay
 * binary, the reads are async, and nothing about a photograph can ride a boot
 * or a keystroke.
 *
 * Everything fails open to null, which the caller reads as "no photograph" —
 * the kiosk that shipped. A device without `caches` (an http LAN address, a
 * test renderer) skips persistence and simply refetches per boot; a corrupt
 * entry reads as a miss. Decoration is never worth an error a parent can see.
 */
import { KIOSK_BACKDROP_MAX_BYTES, sanitizeKioskBackdropId } from '@/lib/kioskBackdrop';

/**
 * Deliberately *outside* the service worker's `tally-kiosk-` prefix: its
 * `activate` deletes every cache under that prefix that is not its own two
 * (public/kiosk-sw.js), so a backdrop store filed there would be emptied on
 * every worker update — silently, and rediscovered as a refetch per deploy.
 */
const CACHE_NAME = 'tally-backdrops-v1';

/**
 * The synthetic same-origin path a backdrop is filed under. Never fetched —
 * `cache.put` accepts any same-origin key, and nothing routes here — so the
 * service worker's handlers never see these entries at all.
 */
const keyFor = (id: string): string => `/kiosk-backdrop/${id}`;

/**
 * How many photographs this device keeps: the bound gathering's, and a couple
 * more so two rooms sharing one shelf on different nights both stay warm. The
 * Cache API keeps insertion order, so the front of `keys()` is the oldest —
 * the same trim the service worker's asset cache runs. Past that, old images
 * are the first thing this feature evicts, silently: on a donated tablet the
 * storage that matters is the roster's and the pending-write queue's, and a
 * photograph must never be why the browser squeezes those.
 */
const MAX_ENTRIES = 3;

function cacheApi(): CacheStorage | null {
  // Secure contexts only — which a real kiosk always is (WebUSB and the
  // service worker already demand one). Guarded rather than assumed for the
  // bench setups and test renderers that are not.
  return typeof caches === 'undefined' ? null : caches;
}

export async function readCachedBackdrop(id: string): Promise<Blob | null> {
  const storage = cacheApi();
  if (!storage || !sanitizeKioskBackdropId(id)) return null;
  try {
    const cache = await storage.open(CACHE_NAME);
    const hit = await cache.match(keyFor(id));
    if (!hit) return null;
    const blob = await hit.blob();
    // The ceiling holds on the way out as well as the way in: a cache entry is
    // still bytes something else on this origin could have written.
    if (blob.size === 0 || blob.size > KIOSK_BACKDROP_MAX_BYTES) return null;
    return blob;
  } catch {
    return null;
  }
}

export async function writeCachedBackdrop(id: string, blob: Blob): Promise<void> {
  const storage = cacheApi();
  if (!storage || !sanitizeKioskBackdropId(id)) return;
  try {
    const cache = await storage.open(CACHE_NAME);
    await cache.put(keyFor(id), new Response(blob, { headers: { 'Content-Type': blob.type } }));
    const keys = await cache.keys();
    const excess = keys.length - MAX_ENTRIES;
    for (const key of keys.slice(0, Math.max(0, excess))) await cache.delete(key);
  } catch {
    // Storage full or blocked. The photograph still shows this evening from
    // memory; the next boot refetches. Same posture as writeJson.
  }
}

/**
 * The backdrop for one id: this device's copy, or the network's once the
 * caller says the network may be spent.
 *
 * `fetcher` is null while the services chunk has not landed or the kiosk has
 * not finished the reads that make it searchable — the one rule of this
 * module's network use is that a photograph never contends with the roster
 * for lobby wifi (docs/kiosk-performance.md prices what that costs). A null
 * answer here is not sticky: the caller re-asks when the fetcher becomes
 * real, and the cache half needs no network at all.
 */
export async function loadBackdrop(
  id: string,
  fetcher: (() => Promise<Blob | null>) | null,
): Promise<Blob | null> {
  const cached = await readCachedBackdrop(id);
  if (cached) return cached;
  if (!fetcher) return null;
  try {
    const fetched = await fetcher();
    if (!fetched) return null;
    void writeCachedBackdrop(id, fetched);
    return fetched;
  } catch {
    return null;
  }
}
