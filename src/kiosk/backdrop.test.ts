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
 * a blob — which is also all `cache.put` is ever handed.
 */
class FakeResponse {
  constructor(private readonly body: Blob) {}
  async blob(): Promise<Blob> {
    return this.body;
  }
}

/** A Cache API double: one bucket, insertion-ordered, string keys. */
function stubCaches(): { store: Map<string, FakeResponse> } {
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
  vi.stubGlobal('caches', { open: async () => cache });
  vi.stubGlobal('Response', FakeResponse);
  return { store };
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
