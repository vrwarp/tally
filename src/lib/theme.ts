/**
 * Which theme Tally is wearing, and who decided.
 *
 * Three preferences, two themes. `system` is not a third look — it is the
 * absence of a decision, and it has to keep tracking the device afterwards: a
 * phone that flips to dark at sunset should take Tally with it, without anybody
 * reopening the app.
 *
 * Everything here is pure and DOM-level so it can run twice: once from the
 * inline script in index.html before first paint, and once from React. Getting
 * the same answer both times is what stops the screen flashing black on a
 * light-theme device.
 */

/** What a person chose. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What is actually on screen. */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tally:theme';

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  'system',
  'light',
  'dark',
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * The stored preference, or `system` when there is none.
 *
 * Never throws: Safari in private mode throws on `localStorage`, and a theme is
 * not worth failing a page load over.
 */
export function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* The choice will not survive a reload. Everything else still works. */
  }
}

/**
 * What the device is asking for.
 *
 * Defaults to dark when the browser will not say. Tally's home is a dim room on
 * a Friday night, and a white screen there is the more hostile mistake.
 */
export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === 'system' ? systemTheme() : preference;
}

/**
 * Puts the theme on the document.
 *
 * `data-theme` is what the CSS in index.css keys off. The `theme-color` meta is
 * separate and easy to forget: it is the colour iOS and Android paint the
 * status bar and address bar, so leaving it dark makes a light-theme install
 * look like it has a black bar wedged above it.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'light' ? '#f1f5f9' : '#0f172a');
}

/**
 * Calls `onChange` whenever the device preference moves. Returns an unsubscribe.
 *
 * Uses `addEventListener` where available and falls back to the deprecated
 * `addListener`, which is all Safari below 14 has — the same browsers this app
 * already bends over backwards for elsewhere.
 */
export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  let query: MediaQueryList;
  try {
    query = window.matchMedia('(prefers-color-scheme: light)');
  } catch {
    return () => {};
  }

  const handler = (event: MediaQueryListEvent) =>
    onChange(event.matches ? 'light' : 'dark');

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }

  const legacy = query as MediaQueryList & {
    addListener?: (cb: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (cb: (event: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener?.(handler);
  return () => legacy.removeListener?.(handler);
}
