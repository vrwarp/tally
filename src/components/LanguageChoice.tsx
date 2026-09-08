/**
 * The reader's language, on the two screens where changing it is the point.
 *
 * The account menu, because that is where the things about *you* rather than
 * about the ministry live — and the sign-in screen, because a counselor who
 * cannot read the sign-in screen cannot get past it to the account menu. That
 * second one is the whole reason this is not a settings row: Settings is
 * core-team only and behind a sign-in.
 *
 * The languages wear their own names (`LOCALE_LABELS`), never translated, for
 * the reason the kiosk's picker does: the person who needs this control is by
 * definition not reading the words around it. A globe would be worse — it names
 * the topic, not the choice.
 *
 * Where the choice is *kept* is the provider's, not this component's:
 * `TallyIntlProvider` writes it against the reader (`tally:locale`) and
 * `KioskIntlProvider` writes it against the tablet. That split is why the kiosk
 * has a picker of its own rather than importing this one — its controls also
 * commit on the lift rather than on the click, because a lobby tablet gets
 * leaned on. See `src/kiosk/components/LanguagePicker.tsx`.
 */
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/locales';
import { useLocaleControl } from '@/i18n/localeContext';
import { cn } from '@/lib/utils';
import { useTranslations } from 'use-intl';

export function LanguageChoice({ className }: { className?: string }) {
  const t = useTranslations('Common');
  const { locale, setLocale } = useLocaleControl();

  return (
    <div
      role="group"
      // The one handle on this control that does not change with the language
      // it is used to change. Reaching for it by its accessible name works
      // exactly once — see `e2e/i18n.spec.ts`.
      data-testid="language-picker"
      aria-label={t('language')}
      className={cn('flex items-center gap-1', className)}
    >
      {LOCALES.map((candidate: Locale) => {
        const current = candidate === locale;
        return (
          <button
            key={candidate}
            type="button"
            aria-pressed={current}
            onClick={() => setLocale(candidate)}
            className={cn(
              'min-h-11 flex-1 rounded-lg px-2 text-xs font-medium pointer-fine:min-h-8',
              current
                ? 'bg-ink-800 text-ink-100'
                : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-200',
            )}
          >
            {LOCALE_LABELS[candidate]}
          </button>
        );
      })}
    </div>
  );
}
