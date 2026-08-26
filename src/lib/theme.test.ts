/**
 * The theme resolver.
 *
 * Small, but it runs twice on every cold start — once in the inline script in
 * index.html and once in React — and the two have to agree, or a light-theme
 * user gets a black flash. Every branch here is a way they could disagree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
  systemTheme,
  THEME_STORAGE_KEY,
  watchSystemTheme,
} from '@/lib/theme';

/** The media query this module is only ever allowed to ask. */
const LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * Stands in for `window.matchMedia`, which jsdom does not implement.
 *
 * Deliberately strict about both strings it is handed. A browser answers a
 * query it does not understand with a `MediaQueryList` that simply never
 * matches, and registers a listener for an event name nothing ever fires — so
 * both mistakes look exactly like "this device prefers dark and never changes
 * its mind", which is the one outcome a stub must not paper over.
 */
function stubMatchMedia(prefersLight: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: prefersLight,
    addEventListener: (type: string, cb: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.add(cb);
    },
    removeEventListener: (type: string, cb: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') listeners.delete(cb);
    },
  };

  const matchMedia = vi.fn((asked: string) =>
    asked === LIGHT_QUERY ? query : { ...query, matches: false },
  );
  vi.stubGlobal('matchMedia', matchMedia);

  return {
    matchMedia,
    /** Fires a device-preference change at every listener. */
    flip(toLight: boolean) {
      for (const cb of listeners) cb({ matches: toLight } as MediaQueryListEvent);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

/**
 * Safari below 14, which has `addListener` and nothing else. `handlers` is what
 * a test asserts against, since these take no event name.
 */
function stubLegacyMatchMedia(options: { removable?: boolean } = {}) {
  const handlers = new Set<(event: MediaQueryListEvent) => void>();
  const query: Record<string, unknown> = {
    matches: false,
    addListener: (cb: (event: MediaQueryListEvent) => void) => handlers.add(cb),
  };
  if (options.removable !== false) {
    query.removeListener = (cb: (event: MediaQueryListEvent) => void) => handlers.delete(cb);
  }

  vi.stubGlobal('matchMedia', () => query);
  return {
    flip(toLight: boolean) {
      for (const cb of handlers) cb({ matches: toLight } as MediaQueryListEvent);
    },
    get handlerCount() {
      return handlers.size;
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#0f172a" />';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isThemePreference', () => {
  it('accepts the three real answers', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
  });

  it('rejects anything else', () => {
    // Storage is shared with every other script on the origin and survives
    // upgrades; whatever is in there is not to be trusted.
    for (const value of [null, undefined, '', 'DARK', 'auto', 0, {}]) {
      expect(isThemePreference(value)).toBe(false);
    }
  });
});

describe('readStoredPreference', () => {
  it('defaults to following the device when nothing was chosen', () => {
    expect(readStoredPreference()).toBe('system');
  });

  it('returns what was stored', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(readStoredPreference()).toBe('light');
  });

  it('falls back rather than trusting a corrupt value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readStoredPreference()).toBe('system');
  });

  it('survives storage throwing entirely', () => {
    // Safari in private mode. A theme is not worth failing a page load over.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readStoredPreference()).toBe('system');
  });
});

describe('storePreference', () => {
  it('round-trips', () => {
    storePreference('dark');
    expect(readStoredPreference()).toBe('dark');
  });

  it('does not throw when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => storePreference('light')).not.toThrow();
  });
});

describe('systemTheme', () => {
  it('reads the device preference', () => {
    stubMatchMedia(true);
    expect(systemTheme()).toBe('light');

    stubMatchMedia(false);
    expect(systemTheme()).toBe('dark');
  });

  it('defaults to dark when the browser will not say', () => {
    // Tally's home is a dim room on a Friday night. A white screen there is the
    // more hostile mistake.
    vi.stubGlobal('matchMedia', () => {
      throw new Error('not implemented');
    });
    expect(systemTheme()).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('takes an explicit choice at its word', () => {
    stubMatchMedia(true);
    expect(resolveTheme('dark')).toBe('dark');

    stubMatchMedia(false);
    expect(resolveTheme('light')).toBe('light');
  });

  it('defers to the device only for `system`', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applyTheme', () => {
  it('stamps the attribute the CSS keys off', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('moves the status-bar colour with it', () => {
    // Easy to forget, and very visible: a light install with a dark
    // `theme-color` looks like it has a black bar wedged above it.
    applyTheme('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#e4f1fe',
    );

    applyTheme('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#0f172a',
    );
  });

  it('does not care whether the meta tag exists', () => {
    document.head.innerHTML = '';
    expect(() => applyTheme('dark')).not.toThrow();
  });
});

describe('watchSystemTheme', () => {
  it('reports a device flip', () => {
    const media = stubMatchMedia(false);
    const seen: string[] = [];

    watchSystemTheme((theme) => seen.push(theme));
    media.flip(true);
    media.flip(false);

    expect(seen).toEqual(['light', 'dark']);
  });

  it('stops listening once unsubscribed', () => {
    const media = stubMatchMedia(false);
    const stop = watchSystemTheme(() => {});

    expect(media.listenerCount).toBe(1);
    stop();
    expect(media.listenerCount).toBe(0);
  });

  it('returns a usable unsubscribe even when matchMedia throws', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('not implemented');
    });
    expect(() => watchSystemTheme(() => {})()).not.toThrow();
  });

  it('asks about light, which is the question every branch here is phrased on', () => {
    const media = stubMatchMedia(false);

    watchSystemTheme(() => {});

    expect(media.matchMedia).toHaveBeenCalledWith(LIGHT_QUERY);
  });

  it('follows the device through the listener older Safari offers', () => {
    const media = stubLegacyMatchMedia();
    const seen: string[] = [];

    watchSystemTheme((theme) => seen.push(theme));
    media.flip(true);

    expect(seen).toEqual(['light']);
  });

  it('unsubscribes through the older pair too', () => {
    const media = stubLegacyMatchMedia();

    const stop = watchSystemTheme(() => {});
    expect(media.handlerCount).toBe(1);

    stop();

    expect(media.handlerCount).toBe(0);
  });

  it('survives a MediaQueryList with neither pair of methods', () => {
    // Not hypothetical: this is what a stubbed `matchMedia` in somebody else's
    // test harness looks like, and an unguarded call would take the whole app
    // down at mount.
    vi.stubGlobal('matchMedia', () => ({ matches: false }));

    expect(() => watchSystemTheme(() => {})()).not.toThrow();
  });

  it('survives a MediaQueryList that can be listened to but not unlistened', () => {
    const media = stubLegacyMatchMedia({ removable: false });
    const stop = watchSystemTheme(() => {});

    expect(media.handlerCount).toBe(1);
    expect(() => stop()).not.toThrow();
  });
});
