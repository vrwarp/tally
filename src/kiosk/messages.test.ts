/**
 * The warm boot, in the one place it is about words.
 *
 * The module keeps state — an in-memory map, and a `localStorage` copy across
 * boots — so every test here re-imports it fresh. That is the point of most of
 * them: what a *second* boot does with what the first one stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KIOSK_KEYS } from './storage';

const HANS = { Search: { title: '搜索' } };

async function freshModule() {
  vi.resetModules();
  return import('./messages');
}

beforeEach(() => {
  localStorage.clear();
  vi.doUnmock('../../messages/kiosk/zh-Hans.json');
});

describe('cachedCatalog', () => {
  it('answers English without waiting for anything', async () => {
    const { cachedCatalog, EN_KIOSK_CATALOG } = await freshModule();
    expect(cachedCatalog('en')).toBe(EN_KIOSK_CATALOG);
  });

  it('has nothing for a language this kiosk has never been switched to', async () => {
    const { cachedCatalog } = await freshModule();
    expect(cachedCatalog('zh-Hans')).toBeNull();
  });

  it('answers the slice the last boot stored', async () => {
    const first = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));
    await first.loadCatalog('zh-Hans');

    // A new boot: the module is gone, localStorage is not.
    const next = await freshModule();
    expect(next.cachedCatalog('zh-Hans')).toEqual(HANS);
  });

  it('ignores a slice stored for a different language', async () => {
    const { cachedCatalog, EN_KIOSK_CATALOG } = await freshModule();
    const shape = JSON.parse(localStorage.getItem(KIOSK_KEYS.messages) ?? 'null');
    expect(shape).toBeNull();
    localStorage.setItem(
      KIOSK_KEYS.messages,
      JSON.stringify({ locale: 'zh-Hant', shape: 'whatever', messages: EN_KIOSK_CATALOG }),
    );
    expect(cachedCatalog('zh-Hans')).toBeNull();
  });

  /*
   * The failure this guards is a deploy, not a corruption: a release that adds
   * a key leaves last week's slice missing it, and a missing message renders
   * its own key at a parent standing in the lobby. One boot in the wrong
   * language is recoverable; `Register.labelFirstName` on the glass is not.
   */
  it('discards a slice cut from a different build', async () => {
    const first = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));
    await first.loadCatalog('zh-Hans');

    const stored = JSON.parse(localStorage.getItem(KIOSK_KEYS.messages)!);
    localStorage.setItem(
      KIOSK_KEYS.messages,
      JSON.stringify({ ...stored, shape: `${stored.shape} and one more key` }),
    );

    const next = await freshModule();
    expect(next.cachedCatalog('zh-Hans')).toBeNull();
  });

  it('survives a cache entry that is not what it should be', async () => {
    const { cachedCatalog } = await freshModule();
    localStorage.setItem(KIOSK_KEYS.messages, 'not json at all');
    expect(cachedCatalog('zh-Hans')).toBeNull();
  });
});

describe('loadCatalog', () => {
  it('keeps what it loaded, for the next boot', async () => {
    const { loadCatalog } = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));

    await expect(loadCatalog('zh-Hans')).resolves.toEqual(HANS);
    expect(JSON.parse(localStorage.getItem(KIOSK_KEYS.messages)!)).toMatchObject({
      locale: 'zh-Hans',
      messages: HANS,
    });
  });

  it('never stores English, which is already in the bundle', async () => {
    const { loadCatalog, EN_KIOSK_CATALOG } = await freshModule();
    await expect(loadCatalog('en')).resolves.toBe(EN_KIOSK_CATALOG);
    expect(localStorage.getItem(KIOSK_KEYS.messages)).toBeNull();
  });

  /*
   * The stale-service-worker failure the kiosk's own worker is written around:
   * a chunk the page asks for that the deploy no longer has. English in a lobby
   * that speaks Chinese is bad; a blank screen is worse.
   */
  it('falls back to English when the chunk will not load', async () => {
    const { loadCatalog, EN_KIOSK_CATALOG } = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    await expect(loadCatalog('zh-Hans')).resolves.toBe(EN_KIOSK_CATALOG);
    expect(localStorage.getItem(KIOSK_KEYS.messages)).toBeNull();
  });
});
