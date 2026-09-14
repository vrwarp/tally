/**
 * The language switch at the top of the idle screen.
 *
 * For the family who cannot read the instruction under it. The chips beside
 * the keyboard are one glyph each at arm's length, and a reader who does not
 * know that 繁 stands for their language walks past them — the finding that
 * started this: parents from the Chinese congregation could not start. So the
 * languages this lobby offers stand here in their own names, at the size of
 * the instruction, as the first thing on the glass; pressing one changes every
 * word beneath it and nothing else.
 *
 * Which names is the lobby's own setting (`readPins` in storage.ts): English
 * and up to three more, in the order the volunteer who mounted the tablet put
 * them. One row of them until there are four, when it is two rows of two. A
 * name never wraps — a word snapped in half is what a broken machine looks
 * like — so the cell is sized for the longest name at this build's type size
 * and a longer one would show as a sideways overflow in the harness, not as a
 * hyphen.
 *
 * `preview` is the pairing screen's miniature of the same object: the volunteer
 * choosing the pins sees what the family will.
 */
import { haptic } from '@/lib/utils';
import { LOCALE_LABELS, type Locale } from '@/lib/locales';
import { useTranslations } from 'use-intl';
import { useTap } from './tapGuard';

const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2',
};

export function LanguageSwitch({
  names,
  current,
  onChoose,
  preview = false,
}: {
  /** English first, then the pins in their order. */
  names: readonly Locale[];
  current: Locale;
  onChoose?: (locale: Locale) => void;
  preview?: boolean;
}) {
  const t = useTranslations('Common');
  const tap = useTap();

  return (
    <div
      role="group"
      aria-label={t('language')}
      aria-hidden={preview || undefined}
      data-testid="language-switch"
      className={`grid w-full gap-3 ${COLUMNS[Math.min(names.length, 4)] ?? 'grid-cols-2'}`}
    >
      {names.map((candidate) => {
        const lit = candidate === current;
        return (
          <button
            key={candidate}
            type="button"
            // Nothing on this kiosk is focusable — see LanguagePicker.
            tabIndex={-1}
            lang={candidate}
            aria-label={LOCALE_LABELS[candidate]}
            aria-pressed={lit}
            disabled={preview}
            /* The lit cell presses too. A family who presses **English** on
               a kiosk resting in English has chosen as surely as one who
               presses 中文: the failure panel stops speaking every language
               at them, and the clock that gives the screen back is armed. */
            {...(preview
              ? {}
              : tap(() => {
                  haptic();
                  onChoose?.(candidate);
                }))}
            className={`flex items-center justify-center rounded-xl px-2 leading-none font-semibold whitespace-nowrap ${
              preview ? 'h-12 text-xl' : 'h-20 text-3xl tall:h-24 tall:text-4xl'
            } ${
              lit
                ? 'bg-ink-700 text-ink-50 ring-2 ring-ink-400'
                : 'bg-ink-800 text-ink-300 ring-1 ring-ink-600 active:bg-ink-600'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            {LOCALE_LABELS[candidate]}
          </button>
        );
      })}
    </div>
  );
}
