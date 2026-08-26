import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  readStoredPreference,
  resolveTheme,
  storePreference,
  watchSystemTheme,
  type Theme,
  type ThemePreference,
} from '@/lib/theme';
import { ThemeContext, type ThemeContextValue } from '@/context/themeContext';

/**
 * Keeps the document's theme in step with the person's choice and the device.
 *
 * The inline script in index.html has already applied a theme by the time this
 * mounts — that is what stops the flash — so the work here is to keep it right
 * afterwards: when somebody changes the setting, and when the device flips
 * underneath a `system` preference.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredPreference(),
  );
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme(readStoredPreference()),
  );

  // The chosen theme, applied. Runs on mount too, which corrects the document
  // if the inline script was blocked or the stored value changed in another tab.
  useEffect(() => {
    const resolved = resolveTheme(preference);
    setTheme(resolved);
    applyTheme(resolved);
  }, [preference]);

  // Only while following the device. A person who picked light means light,
  // including at sunset.
  useEffect(() => {
    if (preference !== 'system') return;

    return watchSystemTheme((next) => {
      setTheme(next);
      applyTheme(next);
    });
  }, [preference]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      storePreference(next);
    },
    // Stryker disable next-line ArrayDeclaration: any constant array is the same
    // array to `useCallback` — it compares element by element against the last
    // render's, and a literal that never changes never differs from itself. What
    // an empty one *says* is that the callback closes over nothing. (Spelt over
    // several lines so the directive sits on the array's own line, which is what
    // `next-line` matches — see docs/mutation-testing.md.)
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, theme, setPreference }),
    [preference, theme, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
