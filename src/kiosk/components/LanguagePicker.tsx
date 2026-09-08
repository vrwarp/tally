/**
 * The lobby's language, on the glass.
 *
 * Two placements, one control. Staff set what this lobby speaks while they are
 * pairing the device — a kiosk is bolted to a wall and configured once, so the
 * language belongs with the rest of the setup. The same picker then stands,
 * quietly, on the search screen, for the family whose language is not the one
 * the room was set to.
 *
 * Deliberately not a modal and deliberately not a menu. A parent may be
 * mid-search when they realise they cannot read the screen, and anything that
 * covers the glass to ask a question takes their place away from them; three
 * chips that change the words underneath cost nothing to press and nothing to
 * dismiss. It is also why the labels are the languages' own names rather than a
 * globe: the reader who needs this control is by definition not reading the
 * words around it.
 *
 * A language's own name is never translated — see `LOCALE_LABELS` — so the
 * visible glyph and the accessible name come from `src/lib/locales.ts` rather
 * than from the catalogue. Everything else here does not.
 */
import { haptic } from '@/lib/utils';
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  type Locale,
} from '@/lib/locales';
import { useLocaleControl } from '@/i18n/localeContext';
import { useTranslations } from 'use-intl';
import { useTap } from './tapGuard';

/**
 * `quiet` is the search screen's; the default is the pairing screen's.
 *
 * The setup screen has room and an audience who came to make a decision. The
 * search screen has a keyboard somebody is aiming at, and this control must not
 * compete with the names beside it — same shape, one step down in weight, the
 * way **Search everyone** already carries two sizes of itself.
 */
export function LanguagePicker({ quiet }: { quiet?: boolean }) {
  const t = useTranslations('Common');
  const { locale, setLocale } = useLocaleControl();
  const tap = useTap();

  return (
    <div
      role="group"
      // See `LanguageChoice`: the accessible name is itself translated, so it
      // is not a handle a test can hold across a switch.
      data-testid="language-picker"
      aria-label={t('language')}
      className={quiet ? 'flex items-center gap-1' : 'flex items-center gap-2'}
    >
      {LOCALES.map((candidate: Locale) => {
        const current = candidate === locale;
        return (
          <button
            key={candidate}
            type="button"
            // Nothing on this kiosk is focusable: the whole reason the keyboard
            // is drawn rather than native is that no element ever takes focus.
            tabIndex={-1}
            aria-label={LOCALE_LABELS[candidate]}
            aria-pressed={current}
            {...tap(() => {
              if (current) return;
              haptic(quiet ? 8 : undefined);
              setLocale(candidate);
            })}
            className={
              quiet
                ? `flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-semibold ${
                    current
                      ? 'bg-ink-800 text-ink-100'
                      : 'text-ink-500 active:bg-ink-800 active:text-ink-200'
                  }`
                : `flex h-14 min-w-24 items-center justify-center rounded-xl px-5 text-lg font-semibold ${
                    current
                      ? 'bg-ink-700 text-ink-50'
                      : 'bg-ink-800/70 text-ink-400 active:bg-ink-700 active:text-ink-100'
                  }`
            }
            style={{ touchAction: 'manipulation' }}
          >
            {quiet ? LOCALE_SHORT_LABELS[candidate] : LOCALE_LABELS[candidate]}
          </button>
        );
      })}
    </div>
  );
}
