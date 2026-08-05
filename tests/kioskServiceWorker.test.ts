/**
 * The kiosk's service worker, on the properties that would cost a drive to
 * church.
 *
 * `public/kiosk-sw.js` is a classic worker script: it cannot be imported,
 * because it does its work by registering listeners on `self` the moment it is
 * evaluated. So it is evaluated here, against a fake `self`, a fake Cache
 * Storage and a fetch under this suite's control — which is closer to how it
 * actually runs than a refactor into importable pieces would be, and leaves the
 * shipped file exactly as the browser sees it.
 *
 * What is pinned, and why each one is worth a test:
 *
 *   - **The network wins.** The kiosk's update channel is a no-cache page and a
 *     nightly reload. A worker that answered navigations from cache first would
 *     leave a shelf screen running whatever it downloaded the week it was set
 *     up, and there is nobody standing at it to notice.
 *   - **The cache answers when the network cannot.** The reason to have a worker
 *     at all, beyond installability: a dropped lobby wifi used to be a blank
 *     page.
 *   - **Firestore is never touched.** Check-ins are writes with an offline queue
 *     of their own. A worker that started answering them from a cache would be
 *     inventing attendance.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SOURCE = readFileSync(
  fileURLToPath(new NodeURL('../public/kiosk-sw.js', import.meta.url)),
  'utf8',
);

/**
 * Read back out of the worker rather than restated here.
 *
 * A classic script exports nothing, and a copy of these numbers in the test
 * would go stale the first time somebody tuned one — silently, because both
 * halves of an assertion would still agree with themselves.
 */
const constant = (name: string): number =>
  Number(new RegExp(`${name} = ([\\d_]+)`).exec(SOURCE)![1].replace(/_/g, ''));
const NAVIGATION_TIMEOUT_MS = constant('NAVIGATION_TIMEOUT_MS');
const MAX_ASSET_ENTRIES = constant('MAX_ASSET_ENTRIES');

const ORIGIN = 'https://tally.example';

type FakeResponse = { ok: boolean; body: string; clone: () => FakeResponse };
type FakeRequest = { url: string; method: string; mode: string };

function response(body: string, ok = true): FakeResponse {
  const value: FakeResponse = { ok, body, clone: () => value };
  return value;
}

/** Enough of the Cache API to run the worker: URL-keyed, insertion-ordered. */
class FakeCache {
  readonly entries = new Map<string, FakeResponse>();

  async match(request: FakeRequest) {
    return this.entries.get(request.url);
  }
  async put(request: FakeRequest, value: FakeResponse) {
    // A real Cache moves an overwritten entry to the back; the Map does too.
    this.entries.delete(request.url);
    this.entries.set(request.url, value);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }) as FakeRequest);
  }
  async delete(request: FakeRequest) {
    return this.entries.delete(request.url);
  }
}

function loadWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const caches = new Map<string, FakeCache>();
  const cacheStorage = {
    open: async (name: string) => {
      const existing = caches.get(name) ?? new FakeCache();
      caches.set(name, existing);
      return existing;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  };
  const fetchMock = vi.fn<(request: FakeRequest) => Promise<FakeResponse>>();
  const worker = {
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      listeners.set(type, handler),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    location: { origin: ORIGIN },
  };

  new Function('self', 'caches', 'fetch', SOURCE)(worker, cacheStorage, fetchMock);

  /** Dispatches a fetch event and hands back whatever the worker answered. */
  const request = (url: string, extra: Partial<FakeRequest> = {}) => {
    const value: FakeRequest = { url, method: 'GET', mode: 'no-cors', ...extra };
    let answered: Promise<FakeResponse> | undefined;
    listeners.get('fetch')!({
      request: value,
      respondWith: (promise: Promise<FakeResponse>) => {
        answered = promise;
      },
    });
    return answered;
  };

  return {
    worker,
    caches,
    fetch: fetchMock,
    request,
    navigate: (url = `${ORIGIN}/kiosk`) => request(url, { mode: 'navigate' }),
    activate: async () => {
      let work: Promise<unknown> | undefined;
      listeners.get('activate')!({ waitUntil: (promise: Promise<unknown>) => (work = promise) });
      await work;
    },
    /** The one shell cache the worker opens, once it has opened it. */
    shell: () => [...caches.entries()].find(([name]) => name.includes('shell'))?.[1],
    assets: () => [...caches.entries()].find(([name]) => name.includes('assets'))?.[1],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the kiosk service worker', () => {
  describe('navigations', () => {
    it('serves the network copy and keeps it for next time', async () => {
      const sw = loadWorker();
      sw.fetch.mockResolvedValue(response('fresh'));

      const answered = await sw.navigate();

      expect(answered?.body).toBe('fresh');
      expect(sw.shell()?.entries.get(`${ORIGIN}/kiosk`)?.body).toBe('fresh');
    });

    /* The update channel itself: a cached page must never outrank a live one. */
    it('prefers today’s page to the one it already has', async () => {
      const sw = loadWorker();
      sw.fetch.mockResolvedValueOnce(response('yesterday'));
      await sw.navigate();

      sw.fetch.mockResolvedValueOnce(response('today'));

      expect((await sw.navigate())?.body).toBe('today');
    });

    it('falls back to the cached page when the network is gone', async () => {
      const sw = loadWorker();
      sw.fetch.mockResolvedValueOnce(response('deployed'));
      await sw.navigate();

      sw.fetch.mockRejectedValue(new Error('offline'));
      const answered = await sw.navigate();

      expect(answered?.body).toBe('deployed');
    });

    /*
     * The slow case is the interesting one: the person at the shelf gets the
     * page they had, and the deploy they missed is still picked up, because the
     * request that lost the race is not cancelled. One stale boot, not a stuck
     * kiosk.
     */
    it('stops waiting on a slow network, and still takes the answer when it lands', async () => {
      const sw = loadWorker();
      sw.fetch.mockResolvedValueOnce(response('yesterday'));
      await sw.navigate();

      let land: (value: FakeResponse) => void = () => {};
      sw.fetch.mockReturnValueOnce(new Promise<FakeResponse>((resolve) => (land = resolve)));
      const pending = sw.navigate();

      await vi.advanceTimersByTimeAsync(NAVIGATION_TIMEOUT_MS);
      expect((await pending)?.body).toBe('yesterday');

      land(response('today'));
      await vi.advanceTimersByTimeAsync(0);
      expect(sw.shell()?.entries.get(`${ORIGIN}/kiosk`)?.body).toBe('today');
    });

    it('waits however long it must when nothing is cached yet', async () => {
      const sw = loadWorker();
      let land: (value: FakeResponse) => void = () => {};
      sw.fetch.mockReturnValueOnce(new Promise<FakeResponse>((resolve) => (land = resolve)));

      const pending = sw.navigate();
      await vi.advanceTimersByTimeAsync(NAVIGATION_TIMEOUT_MS * 4);
      land(response('first run'));

      expect((await pending)?.body).toBe('first run');
    });
  });

  describe('assets', () => {
    it('answers a hashed chunk from cache after the first fetch', async () => {
      const sw = loadWorker();
      sw.fetch.mockResolvedValue(response('chunk'));

      await sw.request(`${ORIGIN}/assets/kiosk-abc123.js`);
      const answered = await sw.request(`${ORIGIN}/assets/kiosk-abc123.js`);

      expect(answered?.body).toBe('chunk');
      expect(sw.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not keep a chunk the server refused', async () => {
      const sw = loadWorker();
      sw.fetch.mockResolvedValue(response('<!doctype html>', false));

      await sw.request(`${ORIGIN}/assets/gone-abc123.js`);

      expect(sw.assets()?.entries.size).toBe(0);
    });

    it('evicts the oldest once the cache is full, so deploys cannot pile up', async () => {
      const sw = loadWorker();
      sw.fetch.mockImplementation(async (request) => response(request.url));

      for (let index = 0; index <= MAX_ASSET_ENTRIES; index += 1) {
        await sw.request(`${ORIGIN}/assets/chunk-${index}.js`);
      }

      const cached = sw.assets()!;
      expect(cached.entries.size).toBe(MAX_ASSET_ENTRIES);
      expect(cached.entries.has(`${ORIGIN}/assets/chunk-0.js`)).toBe(false);
      expect(cached.entries.has(`${ORIGIN}/assets/chunk-${MAX_ASSET_ENTRIES}.js`)).toBe(true);
    });
  });

  describe('what it refuses to handle', () => {
    it('leaves Firestore and Functions alone', async () => {
      const sw = loadWorker();

      expect(sw.request('https://firestore.googleapis.com/v1/projects/tally/documents')).toBeUndefined();
      expect(sw.navigate('https://accounts.google.com/o/oauth2/auth')).toBeUndefined();
      expect(sw.fetch).not.toHaveBeenCalled();
    });

    it('leaves writes alone', async () => {
      const sw = loadWorker();

      expect(sw.request(`${ORIGIN}/assets/kiosk-abc123.js`, { method: 'POST' })).toBeUndefined();
    });

    it('leaves everything that is neither a page nor a chunk alone', async () => {
      const sw = loadWorker();

      expect(sw.request(`${ORIGIN}/icons/kiosk-icon-192.png`)).toBeUndefined();
    });
  });

  it('drops caches from an older version on activate', async () => {
    const sw = loadWorker();
    sw.caches.set('tally-kiosk-shell-v0', new FakeCache());
    sw.caches.set('workbox-precache-main-app', new FakeCache());

    await sw.activate();

    expect([...sw.caches.keys()]).not.toContain('tally-kiosk-shell-v0');
    // Not this worker's to delete: the main app is a separate application that
    // happens to share an origin.
    expect([...sw.caches.keys()]).toContain('workbox-precache-main-app');
    expect(sw.worker.clients.claim).toHaveBeenCalled();
  });
});
