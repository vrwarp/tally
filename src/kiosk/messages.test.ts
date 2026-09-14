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
const HANT = { Search: { title: '搜尋' } };
const ES = { Search: { title: 'Buscar' } };

async function freshModule() {
  vi.resetModules();
  return import('./messages');
}

beforeEach(() => {
  localStorage.clear();
  vi.doUnmock('../../messages/kiosk/zh-Hans.json');
  vi.doUnmock('../../messages/kiosk/zh-Hant.json');
  vi.doUnmock('../../messages/kiosk/es-MX.json');
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

  /*
   * The shape is the key tree, and these are the two halves of what that buys.
   *
   * It has to be a *tree*: a stored copy is rejected when a deploy has added or
   * dropped a key, and kept when one has only been reworded — which is the
   * whole trade this module makes (a boot in stale words is survivable, a
   * missing key on the glass in front of a parent is not). A shape that
   * collapsed to a constant would accept both and a shape that hashed the
   * messages would reject both, and neither would fail any other test here.
   */
  it('stores the key tree, not a digest of it', async () => {
    const { loadCatalog, EN_KIOSK_CATALOG } = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));
    await loadCatalog('zh-Hans');

    const { shape } = JSON.parse(localStorage.getItem(KIOSK_KEYS.messages)!) as { shape: string };
    expect(Object.keys(JSON.parse(shape))).toEqual(Object.keys(EN_KIOSK_CATALOG));
    // A leaf is a placeholder rather than the message, so rewording is free.
    expect(JSON.parse(shape).Search).not.toEqual(EN_KIOSK_CATALOG.Search);
  });

  it('refuses a slice whose shape has collapsed to a constant', async () => {
    const { cachedCatalog } = await freshModule();
    localStorage.setItem(
      KIOSK_KEYS.messages,
      JSON.stringify({ locale: 'zh-Hans', shape: '1', messages: HANS }),
    );
    expect(cachedCatalog('zh-Hans')).toBeNull();
  });

  /*
   * The locale check on its own, which the test above it cannot make: that one
   * stores a shape from another build, so the shape check alone would reject it
   * and nothing would notice if the locale stopped being compared. Here the
   * slice is cut from *this* build and only the language is wrong — a kiosk
   * switched from Traditional to Simplified must not be handed the slice the
   * previous language left behind.
   */
  it('refuses a slice from this build that was stored for another language', async () => {
    const first = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));
    await first.loadCatalog('zh-Hans');

    const stored = JSON.parse(localStorage.getItem(KIOSK_KEYS.messages)!) as {
      shape: string;
    };
    localStorage.setItem(KIOSK_KEYS.messages, JSON.stringify({ ...stored, locale: 'zh-Hant' }));

    const next = await freshModule();
    expect(next.cachedCatalog('zh-Hans')).toBeNull();
  });

  /*
   * Right language, right build, and messages that are not messages. Nothing
   * this app writes produces it; a half-finished `localStorage` write or a hand
   * that edited site data does, and the lobby screen must not render a string
   * as if it were a catalogue.
   */
  it('refuses a slice whose messages are not an object', async () => {
    const first = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));
    await first.loadCatalog('zh-Hans');

    const stored = JSON.parse(localStorage.getItem(KIOSK_KEYS.messages)!) as {
      shape: string;
    };
    localStorage.setItem(
      KIOSK_KEYS.messages,
      JSON.stringify({ ...stored, messages: 'not a catalogue' }),
    );

    const next = await freshModule();
    expect(next.cachedCatalog('zh-Hans')).toBeNull();
  });

  /*
   * Read once, then held. `localStorage` is the warm-start copy and the map is
   * the session's; a second question in the same session must not go back to
   * storage, because the search screen asks on every keystroke.
   */
  it('keeps what it read, so a second question never touches storage', async () => {
    const first = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));
    await first.loadCatalog('zh-Hans');

    const next = await freshModule();
    expect(next.cachedCatalog('zh-Hans')).toEqual(HANS);

    localStorage.clear();
    expect(next.cachedCatalog('zh-Hans')).toEqual(HANS);
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

  /*
   * One arm of the `switch` per language, because a locale is the one thing
   * here that decides which file is fetched — and nothing else in this suite
   * would notice a kiosk set to Spanish being handed the Traditional slice.
   * `es-MX` is a named arm and `zh-Hant` is the default one; both are asserted
   * so neither can be rewritten into the other.
   */
  it('fetches the Spanish slice for a lobby set to Spanish', async () => {
    const { loadCatalog } = await freshModule();
    vi.doMock('../../messages/kiosk/es-MX.json', () => ({ default: ES }));

    await expect(loadCatalog('es-MX')).resolves.toEqual(ES);
  });

  it('fetches the Traditional slice, which is the arm nothing names', async () => {
    const { loadCatalog } = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hant.json', () => ({ default: HANT }));

    await expect(loadCatalog('zh-Hant')).resolves.toEqual(HANT);
  });

  /*
   * The same holding, one layer up: what an import brought back is kept in the
   * session's map, not only written to storage. A kiosk whose site data is
   * cleared mid-shift keeps the words it already has.
   */
  it('holds what it imported, even if storage is emptied under it', async () => {
    const { loadCatalog, cachedCatalog } = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));
    await loadCatalog('zh-Hans');

    localStorage.clear();
    expect(cachedCatalog('zh-Hans')).toEqual(HANS);
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
  /*
   * The failure panel's voices are fetched at boot for every pinned language.
   * Three catalogues warming at once must not fight over the one slice kept
   * for the next boot, which is for the language the kiosk is actually in.
   */
  it('can fetch a language on the lobby’s behalf without touching the stored slice', async () => {
    const { loadCatalog } = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => ({ default: HANS }));
    await expect(loadCatalog('zh-Hans', { store: false })).resolves.toEqual(HANS);
    expect(localStorage.getItem(KIOSK_KEYS.messages)).toBeNull();
    // Held in memory all the same: the next ask is free.
    const { cachedCatalog } = await import('./messages');
    expect(cachedCatalog('zh-Hans')).toEqual(HANS);
  });

  it('falls back to English when the chunk will not load', async () => {
    const { loadCatalog, EN_KIOSK_CATALOG } = await freshModule();
    vi.doMock('../../messages/kiosk/zh-Hans.json', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    await expect(loadCatalog('zh-Hans')).resolves.toBe(EN_KIOSK_CATALOG);
    expect(localStorage.getItem(KIOSK_KEYS.messages)).toBeNull();
  });
});
