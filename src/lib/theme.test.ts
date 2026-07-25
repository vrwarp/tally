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

/** Stands in for `window.matchMedia`, which jsdom does not implement. */
function stubMatchMedia(prefersLight: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: prefersLight,
    addEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (event: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );

  return {
    /** Fires a device-preference change at every listener. */
    flip(toLight: boolean) {
      for (const cb of listeners) cb({ matches: toLight } as MediaQueryListEvent);
    },
    get listenerCount() {
      return listeners.size;
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
      '#f1f5f9',
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
});
