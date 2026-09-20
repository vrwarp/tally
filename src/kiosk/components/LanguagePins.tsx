/**
 * Which languages this lobby offers, as a control.
 *
 * The fact it edits is `KIOSK_KEYS.pins` — the languages this room reads
 * beside English, at most three. It is a
 * property of the room rather than of whoever is holding the tablet, which is
 * why staff set it and a family never does: the switch a family presses
 * chooses *their* language out of this list and cannot change the list.
 *
 * Two placements, one control, and the second is why this is a component
 * rather than markup inside a screen. It was built on the pairing screen,
 * where a tablet is mounted; it is now also behind the staff gate, for the
 * Sunday the room turns out to read something else. They differ in how far
 * away the reader is (`size`) and in whether the switch's own miniature is
 * worth drawing (`preview`) — nothing else.
 *
 * A language's own name is never translated (`LOCALE_LABELS`), so the chips'
 * words come from `src/lib/locales.ts` and not from the catalogue. English is
 * not among them: it is the resting language and the switch's first cell
 * whatever the disk says, so a chip for it would be a control that does
 * nothing.
 *
 * ## Tapping is a set operation
 *
 * There is no first and no second. The pins used to keep the order they were
 * tapped in, which bought nothing and cost a question nobody should have to
 * answer at a kiosk with a queue — and the chips, drawn in catalogue order,
 * then disagreed with the switch they were setting. `sanitizePins` decides
 * the order now, once, from the catalogue. Pressing three chips in any
 * sequence gives the same lobby the same glass.
 */
import { haptic } from '@/lib/utils';
import { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, type Locale } from '@/lib/locales';
import { useTranslations } from 'use-intl';
import { LanguageSwitch } from './LanguageSwitch';
import { useTap } from './tapGuard';
import { MAX_PINS } from '../storage';

/**
 * How far away the reader is.
 *
 * `setup` is the pairing screen: a staff member holding the tablet, with the
 * whole screen to themselves. `kiosk` is the staff gate on a tablet on a
 * stand, read at the distance every other control behind that gate is set for
 * — see the note on type size at the top of `StaffScreen`.
 */
export type LanguagePinsSize = 'setup' | 'kiosk';

const CHIP: Record<LanguagePinsSize, string> = {
  setup: 'h-14 min-w-24 px-5 text-lg',
  kiosk: 'h-14 min-w-24 px-5 text-lg kiosk:h-20 kiosk:min-w-32 kiosk:px-6 kiosk:text-2xl',
};

const NOTE: Record<LanguagePinsSize, string> = {
  setup: 'text-sm',
  kiosk: 'text-sm kiosk:text-lg',
};

export function LanguagePins({
  pins,
  onPins,
  size = 'setup',
  preview = false,
}: {
  /** The lobby's languages beside English. A set; `sanitizePins` orders it. */
  pins: readonly Locale[];
  onPins: (pins: Locale[]) => void;
  size?: LanguagePinsSize;
  /**
   * Whether to draw the switch's own miniature under the chips.
   *
   * On the pairing screen, yes: the idle screen it previews is several
   * screens and an approval away, so the layout has to be shown rather than
   * imagined. Behind the staff gate, no — the real thing is one press of
   * **Done** away, and a second block of language-named plates 60px under the
   * first was three critics' worst finding on that screen. The two disagreed
   * about what a lit plate meant (pinned, above; the current language, below),
   * the dead one was drawn brighter than the live one, and its cells are
   * `disabled`, so the tap it invited returned nothing at all.
   */
  preview?: boolean;
}) {
  const t = useTranslations('Pairing');
  const tap = useTap();

  return (
    <>
      {/*
        * Every language the build speaks, pressed or not — never only the
        * chosen ones. A language somebody turned off has to be visible *as
        * off*, or the screen cannot answer the question a volunteer walked
        * over with, and an absence reads as a build that does not have it.
        */}
      <div
        role="group"
        aria-label={t('pinLanguages')}
        data-testid="language-pins"
        className="flex flex-wrap items-center justify-center gap-2 kiosk:gap-3"
      >
        {LOCALES.filter((candidate) => candidate !== DEFAULT_LOCALE).map((candidate) => {
          const pinned = pins.includes(candidate);
          return (
            <button
              key={candidate}
              type="button"
              tabIndex={-1}
              lang={candidate}
              aria-pressed={pinned}
              {...tap(() => {
                // Unreachable while the build speaks three languages besides
                // English and the cap is three — kept because the cap is a
                // number in `storage.ts` and the catalogue is a list, and
                // nothing makes them move together.
                if (!pinned && pins.length >= MAX_PINS) return;
                haptic();
                onPins(pinned ? pins.filter((pin) => pin !== candidate) : [...pins, candidate]);
              })}
              /*
               * Both states are objects on the glass. The unpinned plate was
               * `ink-800/70` with an `ink-400` label — nineteen levels off the
               * page and the same grey as the prose around it — so on the one
               * screen whose entire content is this control, the control was
               * the fourth thing the eye found. The difference between on and
               * off is carried by the ring and one step of label ink, with
               * both plates plainly above the background.
               */
              className={`flex items-center justify-center rounded-xl font-semibold whitespace-nowrap ${CHIP[size]} ${
                pinned
                  ? 'bg-ink-700 text-ink-50 ring-2 ring-ink-400'
                  : 'bg-ink-800 text-ink-300 ring-1 ring-ink-600 active:bg-ink-600 active:text-ink-100'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              {LOCALE_LABELS[candidate]}
            </button>
          );
        })}
      </div>

      <div className={`max-w-md leading-relaxed text-ink-400 ${NOTE[size]}`}>{t('pinHint')}</div>

      {/*
        * A miniature of the switch as it will stand, once anything is chosen.
        *
        * Whoever is setting this is deciding what a family will see, and the
        * honest way to show a layout is the layout — a third name takes the
        * switch to two rows and drops the instruction under it, which is a
        * thing to be seen rather than read about. See `preview` above for why
        * the staff gate does without it.
        */}
      {preview && pins.length > 0 && (
        <div className="flex w-full flex-col items-center gap-2 pt-2">
          <div className={`text-ink-500 ${NOTE[size]}`}>{t('pinPreview')}</div>
          <LanguageSwitch names={[DEFAULT_LOCALE, ...pins]} preview />
        </div>
      )}
    </>
  );
}
