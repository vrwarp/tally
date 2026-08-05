/**
 * The kiosk's service worker.
 *
 * Hand-written, and deliberately not the one `vite-plugin-pwa` generates for the
 * main app. Two reasons, in order of importance:
 *
 * 1. **Scope.** The main app's worker owns `/` and precaches the whole build.
 *    The kiosk is a second application on the same origin whose entire point is
 *    that it does not carry the main app's weight, and a worker that precached
 *    the main app's chunks on its behalf would undo that in the one place it is
 *    hardest to notice — the network tab of a device on a shelf nobody looks at.
 *    This one registers at scope `/kiosk` (see kiosk.html), which is longer than
 *    `/` and so wins for kiosk pages, and it precaches nothing at all: it learns
 *    what the kiosk uses by watching it be used.
 * 2. **Size.** Workbox is ~15 kB of routing machinery to express what is written
 *    below in two handlers. `scripts/check-kiosk-budget.mjs` holds this file to a
 *    byte budget so that stays true.
 *
 * It exists because installing the kiosk to a home screen requires it — Chrome
 * will not offer to install a page with no `fetch` handler — but what it does
 * while it is there is chosen for the shelf: a kiosk whose lobby wifi has
 * dropped still boots, still shows the roster it cached in localStorage, and
 * still queues check-ins for when the network returns. Before this, the same
 * outage was a blank page.
 *
 * Not on the very first load, though, and the difference is worth knowing when
 * setting one up: registration happens at `load`, by which point the page and
 * its chunks have already been fetched past this worker. It is the *next* boot
 * that fills these caches — which on a shelf device is the ~4am reload, hours
 * before anyone needs it. A kiosk installed and immediately unplugged from the
 * network is still a blank page, and that is the one case not worth the
 * complexity of precaching a build this file cannot name.
 *
 * ## What it must not break
 *
 * The kiosk's update channel is `kiosk.html` being `no-cache` while the hashed
 * assets it names are `immutable` (see firebase.json), plus the ~4am reload in
 * KioskApp. A cache-first shell would quietly replace that with "whatever this
 * device downloaded the day it was set up", which on an unattended screen is
 * indistinguishable from a deploy that never happened. So the navigation is
 * network-first, and the cache only answers when the network has had its
 * chance and failed.
 *
 * Firestore, Auth and Functions traffic is not touched: it never reaches a
 * handler here, because it is not same-origin. The kiosk's own offline story is
 * the pending-write queue in src/kiosk/services.ts, not a cached POST.
 *
 * This file itself is served `no-cache` (firebase.json), alongside the main
 * app's worker. The spec already bypasses the HTTP cache when checking a worker
 * for updates, so that header is belt and braces — but this is the one file that
 * can strand a device if it goes stale, and it is not content-hashed.
 */

/**
 * Bump to invalidate everything this worker holds. `activate` deletes any
 * `tally-kiosk-` cache that is not one of the two below, so an old version's
 * storage goes with it.
 */
const VERSION = 'v1';
const SHELL_CACHE = `tally-kiosk-shell-${VERSION}`;
const ASSET_CACHE = `tally-kiosk-assets-${VERSION}`;

/**
 * How long the network gets to answer a navigation before the cached copy is
 * shown instead.
 *
 * The fetch is not cancelled when it expires — it keeps running and still
 * refreshes the cache, so a slow morning costs the kiosk one boot of staleness
 * rather than a missed deploy. Long enough that a merely sluggish connection
 * still serves fresh; short enough that a parent at the shelf does not watch a
 * white screen while the wifi decides.
 */
const NAVIGATION_TIMEOUT_MS = 2500;

/**
 * A cap on the asset cache, in entries.
 *
 * Asset URLs are content-hashed, so every deploy writes new ones and orphans the
 * old — left alone this would grow without limit on a device that is never
 * cleared. The Cache API keeps insertion order, so the oldest entries are the
 * front of `keys()`. Roughly a dozen chunks make up the kiosk including the
 * printing path, so this holds several deploys' worth: enough that yesterday's
 * build still boots offline, bounded enough that a year of them cannot fill a
 * cheap tablet. Evicting one still in use costs a network fetch, nothing more.
 */
const MAX_ASSET_ENTRIES = 60;

self.addEventListener('install', () => {
  // Nothing to precache, so there is nothing to wait for. Taking over
  // immediately is safe here in a way it is not for the main app: the kiosk is
  // one page with no router and no open editing state to lose.
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith('tally-kiosk-') && name !== SHELL_CACHE && name !== ASSET_CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Firestore, Auth, Functions, the printer — none of it is ours to answer.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Content-hashed and served `immutable`, which is exactly what makes
  // cache-first correct: a given URL's bytes can never change.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAsset(request));
  }
});

/**
 * Network first, with the cached page winning a race the network has had
 * `NAVIGATION_TIMEOUT_MS` to lose.
 */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  const fresh = fetch(request).then((response) => {
    // Kept regardless of who won the race below: a copy that lands late is
    // still the copy this device should boot from next time.
    if (response.ok) void cache.put(request, response.clone());
    return response;
  });

  const cached = await cache.match(request);
  // First run, or a page this kiosk has never opened. Nothing to fall back to,
  // so wait however long it takes — a network error page is the honest answer.
  if (!cached) return fresh;

  return Promise.race([
    fresh.catch(() => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT_MS)),
  ]);
}

/** Cache first. A miss is fetched, kept, and counted against the cap. */
async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    void trim(cache);
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ASSET_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}
