/**
 * The app's language, as a provider and a hook.
 *
 * One piece of state — the chosen locale — with the catalogue for it swapped in
 * as it loads. Switching to a language whose chunk has not arrived keeps the
 * current messages on screen rather than blanking to keys: a reader who taps
 * 繁體中文 sees English for the frame or two the import takes, which is what
 * they were already reading.
 *
 * Deliberately *not* wired to the user document here. That write belongs to the
 * code that owns `users/{uid}` — see `reconcileLocale` — and this provider must
 * work identically on the sign-in screen, where there is no account at all.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import type { Locale } from '@/lib/locales';
import { EN_CATALOG, cachedCatalog, loadCatalog, type Catalog } from '@/i18n/catalogs';
import { LocaleContext, type LocaleControl } from '@/i18n/localeContext';
import { initialLocale, writeStoredLocale } from '@/i18n/localeStore';

export function TallyIntlProvider({
  children,
  initial,
  timeZone,
}: {
  children: ReactNode;
  /** Overridden by tests and by the kiosk, which resolve their own. */
  initial?: Locale;
  timeZone?: string;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? initialLocale());
  const [messages, setMessages] = useState<Catalog>(() => cachedCatalog(locale) ?? EN_CATALOG);

  useEffect(() => {
    const cached = cachedCatalog(locale);
    if (cached) {
      setMessages(cached);
      return;
    }
    let live = true;
    void loadCatalog(locale).then((loaded) => {
      if (live) setMessages(loaded);
    });
    return () => {
      live = false;
    };
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeStoredLocale(next);
    setLocaleState(next);
  }, []);

  const control = useMemo<LocaleControl>(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={control}>
      {/*
        `onError` is swallowed rather than logged in production for the same
        reason the breadcrumb ring swallows its own failures: a missing message
        renders its key, which is ugly and survivable, and a console full of
        them during a check-in queue helps nobody. The parity test is what
        catches a missing key, before it ships.
      */}
      <IntlProvider
        locale={locale}
        messages={messages}
        timeZone={timeZone}
        onError={import.meta.env.DEV ? undefined : () => {}}
      >
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
