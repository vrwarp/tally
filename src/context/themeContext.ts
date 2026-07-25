import { createContext, useContext } from 'react';
import type { Theme, ThemePreference } from '@/lib/theme';

export interface ThemeContextValue {
  /** What the person chose — including `system`, which is a real answer. */
  preference: ThemePreference;
  /** What is actually on screen right now. */
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return value;
}
