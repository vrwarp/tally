/**
 * The kiosk's language, kept separate from the app's on purpose.
 *
 * A counselor's language follows them to a new phone; a kiosk's language is a
 * property of the tablet in this lobby, so it is read from and written to
 * `KIOSK_LOCALE_STORAGE_KEY` and never touches `tally:locale`. See
 * `src/lib/locales.ts`.
 *
 * What it is handed is the kiosk's *slice* of the catalogue, and where that
 * comes from is `src/kiosk/messages.ts`: English compiled into the bundle,
 * Chinese behind an `import()` and kept in `localStorage` afterwards, so a
 * kiosk switched to Chinese paints Chinese on the first frame of every boot
 * after the first. The slice itself is cut by
 * `scripts/sync-kiosk-messages.mjs`, because the app's 85 kB of settings and
 * review-queue strings would otherwise land in a first paint that
 * `scripts/check-kiosk-budget.mjs` holds to 127 kB gzipped.
 *
 * Switching to a language whose chunk has not arrived keeps the current words
 * on screen rather than blanking to keys — the same choice `TallyIntlProvider`
 * makes, and the same one the roster cache makes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { KIOSK_LOCALE_STORAGE_KEY, type Locale } from '@/lib/locales';
import { LocaleContext, type LocaleControl } from '@/i18n/localeContext';
import { initialLocale, writeStoredLocale } from '@/i18n/localeStore';
import {
  EN_KIOSK_CATALOG,
  cachedCatalog,
  loadCatalog,
  type KioskCatalog,
} from './messages';

export function KioskIntlProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    initialLocale(KIOSK_LOCALE_STORAGE_KEY),
  );
  const [messages, setMessages] = useState<KioskCatalog>(
    () => cachedCatalog(locale) ?? EN_KIOSK_CATALOG,
  );

  useEffect(() => {
    const held = cachedCatalog(locale);
    if (held) {
      setMessages(held);
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
    writeStoredLocale(next, KIOSK_LOCALE_STORAGE_KEY);
    setLocaleState(next);
  }, []);

  const control = useMemo<LocaleControl>(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={control}>
      {/* Swallowed for the reason `TallyIntlProvider` swallows it: a missing
          message renders its key, and a lobby screen mid-queue is the worst
          place to spend a frame on a console write. */}
      <IntlProvider
        locale={locale}
        messages={messages}
        onError={import.meta.env.DEV ? undefined : () => {}}
      >
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
