/**
 * Keeping the document's theme in step with the person and the device.
 *
 * The inline script in `index.html` has already painted a theme by the time
 * this mounts — that is what stops the flash — so what is asserted here is
 * everything that happens *after*: a choice being applied and remembered, and a
 * device that flips at sunset taking Tally with it only when nobody has
 * overruled it.
 *
 * The mount-time apply is not redundant with the inline script and is pinned
 * separately: it is what corrects the document when that script was blocked, or
 * when another tab changed the stored value while this one was closed.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/context/ThemeProvider';
import { useTheme, type ThemeContextValue } from '@/context/themeContext';
import { THEME_STORAGE_KEY } from '@/lib/theme';

/** The listeners `matchMedia` handed out, so a test can flip the device. */
let listeners: ((event: MediaQueryListEvent) => void)[] = [];
let removed = 0;
let deviceIsLight = false;
/** Older Safari has `addListener` and nothing else. */
let legacyOnly = false;

function forget(handler: (event: MediaQueryListEvent) => void) {
  const at = listeners.indexOf(handler);
  // Actually dropped, not merely counted: a stale handler that goes on firing
  // would hide the very unsubscribe these tests are here to check.
  if (at !== -1) listeners.splice(at, 1);
  removed += 1;
}

function fakeMatchMedia(query: string) {
  const media = {
    media: query,
    get matches() {
      return deviceIsLight;
    },
    onchange: null,
    dispatchEvent: () => true,
    addEventListener: (_type: string, handler: (event: MediaQueryListEvent) => void) => {
      listeners.push(handler);
    },
    removeEventListener: (_type: string, handler: (event: MediaQueryListEvent) => void) =>
      forget(handler),
    addListener: (handler: (event: MediaQueryListEvent) => void) => {
      listeners.push(handler);
    },
    removeListener: forget,
  };
  if (legacyOnly) {
    return { ...media, addEventListener: undefined, removeEventListener: undefined };
  }
  return media;
}

/** What the device would tell a listener right now. */
function deviceFlipsTo(theme: 'light' | 'dark') {
  deviceIsLight = theme === 'light';
  act(() => {
    for (const listener of listeners) {
      listener({ matches: deviceIsLight } as MediaQueryListEvent);
    }
  });
}

let latest: ThemeContextValue | null = null;

function Probe() {
  latest = useTheme();
  return null;
}

function mount() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

const themeColour = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

beforeEach(() => {
  listeners = [];
  removed = 0;
  deviceIsLight = false;
  legacyOnly = false;
  latest = null;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  vi.stubGlobal('matchMedia', fakeMatchMedia);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('what the provider opens with', () => {
  it('follows the device when nobody has chosen', () => {
    deviceIsLight = true;
    mount();

    expect(latest?.preference).toBe('system');
    expect(latest?.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reads a stored choice back', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    deviceIsLight = true;

    mount();

    // The device says light and the person said dark. The person wins.
    expect(latest?.preference).toBe('dark');
    expect(latest?.theme).toBe('dark');
  });

  it('applies the theme on mount, in case the inline script never ran', () => {
    document.documentElement.dataset.theme = 'light';
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    mount();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('paints the status bar to match', () => {
    // Easy to forget, and it is what stops a light-theme install looking like
    // it has a black bar wedged above it.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    mount();
    expect(themeColour()).toBe('#e4f1fe');
  });

  it('defaults to dark where the browser will not say', () => {
    // Tally's home is a dim room on a Friday night, and a white screen there is
    // the more hostile mistake.
    vi.stubGlobal('matchMedia', () => {
      throw new Error('no matchMedia');
    });

    mount();

    expect(latest?.theme).toBe('dark');
    expect(themeColour()).toBe('#0f172a');
  });
});

describe('choosing a theme', () => {
  it('applies it and remembers it', () => {
    mount();

    act(() => latest?.setPreference('light'));

    expect(latest?.preference).toBe('light');
    expect(latest?.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('remembers going back to the device', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    deviceIsLight = true;
    mount();

    act(() => latest?.setPreference('system'));

    expect(latest?.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});

describe('the device flipping underneath', () => {
  it('is followed while nobody has overruled it', () => {
    mount();
    expect(latest?.theme).toBe('dark');

    deviceFlipsTo('light');

    expect(latest?.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(themeColour()).toBe('#e4f1fe');
  });

  it('is ignored by somebody who picked a theme', () => {
    // A person who picked light means light, including at sunset.
    mount();
    act(() => latest?.setPreference('light'));

    deviceFlipsTo('dark');

    expect(latest?.theme).toBe('light');
  });

  it('stops being watched once a theme is picked', () => {
    mount();
    expect(removed).toBe(0);

    act(() => latest?.setPreference('dark'));

    expect(removed).toBe(1);
  });

  it('is watched again when the choice goes back to the device', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    mount();
    expect(listeners).toHaveLength(0);

    act(() => latest?.setPreference('system'));

    expect(listeners).toHaveLength(1);
  });

  it('is followed through the listener older Safari offers', () => {
    legacyOnly = true;
    mount();

    deviceFlipsTo('light');

    expect(latest?.theme).toBe('light');
  });

  it('stops watching on unmount', () => {
    const { unmount } = mount();
    unmount();
    expect(removed).toBe(1);
  });
});

describe('where localStorage throws', () => {
  // Safari in private mode. A theme is not worth failing a page load over.
  const boom = () => {
    throw new Error('QuotaExceededError');
  };

  it('opens on the device preference', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    deviceIsLight = true;

    mount();

    expect(latest?.preference).toBe('system');
    expect(latest?.theme).toBe('light');
  });

  it('still applies a choice that cannot be saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    mount();

    expect(() => act(() => latest?.setPreference('light'))).not.toThrow();

    expect(latest?.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('useTheme outside the provider', () => {
  it('says so rather than handing back nothing', () => {
    // A silent null here is a crash three components down, in whichever one
    // first reads `.theme`.
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useTheme must be used inside <ThemeProvider>.');
    noisy.mockRestore();
  });
});
