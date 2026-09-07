/**
 * The language switcher's handle on the provider above it.
 *
 * Split from `TallyIntlProvider` the way `context/authContext` is split from
 * `AuthProvider`: a file that exports both a component and a hook cannot be
 * hot-reloaded cleanly, and the repo already draws this line everywhere else.
 */
import { createContext, useContext } from 'react';
import type { Locale } from '@/lib/locales';

export interface LocaleControl {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

export const LocaleContext = createContext<LocaleControl | null>(null);

/**
 * Throws rather than defaulting: a switcher rendered outside the provider would
 * silently do nothing, which is the kind of bug that reaches a user.
 */
export function useLocaleControl(): LocaleControl {
  const control = useContext(LocaleContext);
  if (!control) throw new Error('useLocaleControl must be used inside TallyIntlProvider');
  return control;
}
