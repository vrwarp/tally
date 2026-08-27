/**
 * The backdrop store: cache first, network once, everything failing open.
 *
 * jsdom has no Cache API, which makes the fallback path the default one here —
 * exactly the posture a bench setup on an http LAN address gets — and a small
 * stub stands in for the real thing where the caching behaviour itself is the
 * claim under test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBackdrop, readCachedBackdrop, writeCachedBackdrop } from './backdrop';

const ID = 'b0123456789abcdef';

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'image/webp' });
}

/**
 * jsdom ships no `Response`, so the store gets the smallest one that can hold
 * a blob — which is also all `cache.put` is ever handed. The init is kept so a
 * test can check what the entry was filed with.
 */
class FakeResponse {
  constructor(
    private readonly body: Blob,
    readonly init?: { headers?: Record<string, string> },
  ) {}
  async blob(): Promise<Blob> {
    return this.body;
  }
}

/** A Cache API double: one bucket, insertion-ordered, string keys. */
function stubCaches(): { store: Map<string, FakeResponse>; open: ReturnType<typeof vi.fn> } {
  const store = new Map<string, FakeResponse>();
  const cache = {
    match: async (key: string) => store.get(key) ?? undefined,
    put: async (key: string, response: FakeResponse) => {
      store.set(key, response);
    },
    keys: async () => [...store.keys()].map((key) => ({ url: key }) as Request),
    delete: async (key: Request | string) => {
      return store.delete(typeof key === 'string' ? key : key.url);
    },
  };
  const open = vi.fn(async () => cache);
  vi.stubGlobal('caches', { open });
  vi.stubGlobal('Response', FakeResponse);
  return { store, open };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('without a Cache API', () => {
  it('reads answer null and writes are a no-op — the http bench posture', async () => {
    expect(await readCachedBackdrop(ID)).toBeNull();
    await writeCachedBackdrop(ID, blobOf('pixels'));
    expect(await readCachedBackdrop(ID)).toBeNull();
  });

  it('loadBackdrop still answers from the fetcher', async () => {
    const fetcher = vi.fn(async () => blobOf('pixels'));
    const blob = await loadBackdrop(ID, fetcher);
    expect(await blob?.text()).toBe('pixels');
  });
});

describe('with a Cache API', () => {
  it('round-trips a photograph', async () => {
    stubCaches();
    await writeCachedBackdrop(ID, blobOf('pixels'));
    const back = await readCachedBackdrop(ID);
    expect(await back?.text()).toBe('pixels');
  });

  it('answers from cache without spending the fetcher', async () => {
    stubCaches();
    await writeCachedBackdrop(ID, blobOf('pixels'));
    const fetcher = vi.fn(async () => blobOf('fresh'));
    const blob = await loadBackdrop(ID, fetcher);
    expect(await blob?.text()).toBe('pixels');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches a miss once and keeps the answer for the next boot', async () => {
    stubCaches();
    const fetcher = vi.fn(async () => blobOf('fresh'));
    await loadBackdrop(ID, fetcher);
    // The write is fire-and-forget; give it a tick.
    await Promise.resolve();
    await Promise.resolve();
    expect(await (await readCachedBackdrop(ID))?.text()).toBe('fresh');
  });

  it('keeps only the newest few photographs — old gatherings are evicted first', async () => {
    const { store } = stubCaches();
    for (const suffix of ['aa', 'bb', 'cc', 'dd']) {
      await writeCachedBackdrop(`b0123456789abcde${suffix}`, blobOf(suffix));
    }
    expect(store.size).toBe(3);
    expect(await readCachedBackdrop('b0123456789abcdeaa')).toBeNull();
    expect(await (await readCachedBackdrop('b0123456789abcdedd'))?.text()).toBe('dd');
  });

  it('refuses an entry past the ceiling, whoever wrote it', async () => {
    stubCaches();
    await writeCachedBackdrop(ID, new Blob([new Uint8Array(700_000)], { type: 'image/webp' }));
    expect(await readCachedBackdrop(ID)).toBeNull();
  });

  it('keeps an entry exactly at the ceiling — the bound is inclusive', async () => {
    stubCaches();
    await writeCachedBackdrop(ID, new Blob([new Uint8Array(600_000)], { type: 'image/webp' }));
    expect((await readCachedBackdrop(ID))?.size).toBe(600_000);
  });

  it('refuses an empty entry, whoever wrote it', async () => {
    const { store } = stubCaches();
    store.set(`/kiosk-backdrop/${ID}`, new FakeResponse(new Blob([], { type: 'image/webp' })));
    expect(await readCachedBackdrop(ID)).toBeNull();
  });

  it('refuses a nonsense id without even opening the store', async () => {
    const { store, open } = stubCaches();
    expect(await readCachedBackdrop('nope')).toBeNull();
    await writeCachedBackdrop('nope', blobOf('pixels'));
    expect(open).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('files the entry under the content type it will be read back as', async () => {
    const { store } = stubCaches();
    await writeCachedBackdrop(ID, blobOf('pixels'));
    expect(store.get(`/kiosk-backdrop/${ID}`)?.init).toEqual({
      headers: { 'Content-Type': 'image/webp' },
    });
  });

  it('a storage that refuses to open reads as null, not as an error', async () => {
    vi.stubGlobal('caches', {
      open: async () => {
        throw new Error('quota');
      },
    });
    vi.stubGlobal('Response', FakeResponse);
    expect(await readCachedBackdrop(ID)).toBeNull();
    await expect(writeCachedBackdrop(ID, blobOf('pixels'))).resolves.toBeUndefined();
  });

  it('a fetcher that answers null writes nothing to the store', async () => {
    const { store, open } = stubCaches();
    expect(await loadBackdrop(ID, async () => null)).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.size).toBe(0);
    // One open for the cache read, none for a write that must not happen.
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a fetcher that has not been granted yet is a cache-only read, not a failure', async () => {
    stubCaches();
    expect(await loadBackdrop(ID, null)).toBeNull();
  });

  it('a fetcher that throws reads as no photograph', async () => {
    stubCaches();
    expect(
      await loadBackdrop(ID, async () => {
        throw new Error('network');
      }),
    ).toBeNull();
  });
});
