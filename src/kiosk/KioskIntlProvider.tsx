/**
 * The kiosk's language, kept separate from the app's on purpose.
 *
 * A counselor's language follows them to a new phone; a kiosk's language is a
 * property of the tablet in this lobby, so it is read from and written to
 * `KIOSK_LOCALE_STORAGE_KEY` and never touches `tally:locale`. See
 * `src/lib/locales.ts`.
 *
 * What it is handed is the kiosk's *slice* of the catalogue — the namespaces a
 * lobby screen can reach, cut out by `scripts/sync-kiosk-messages.mjs`. The app's
 * 85 kB of settings and review-queue strings would otherwise land in the kiosk's
 * first paint, which is the budget `scripts/check-kiosk-budget.mjs` guards.
 *
 * English is bundled and nothing else is loaded yet. That is deliberate for now
 * rather than final: the kiosk boots warm out of `localStorage` so the lobby
 * screen is usable before the network answers, and a blocking catalogue fetch
 * would undo exactly that. docs/i18n.md §4.1 is where the other two locales
 * arrive — fetched lazily and cached under `tally:kiosk:messages` — and §4.2 is
 * where the ICU parser is swapped for precompiled messages. Until then a kiosk
 * that has been switched still renders English rather than a blank screen,
 * which is the same fallback `loadCatalog` makes in the main app.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import en from '../../messages/kiosk/en.json';
import { KIOSK_LOCALE_STORAGE_KEY, type Locale } from '@/lib/locales';
import { LocaleContext, type LocaleControl } from '@/i18n/localeContext';
import { initialLocale, writeStoredLocale } from '@/i18n/localeStore';

export function KioskIntlProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    initialLocale(KIOSK_LOCALE_STORAGE_KEY),
  );

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
        messages={en}
        onError={import.meta.env.DEV ? undefined : () => {}}
      >
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
