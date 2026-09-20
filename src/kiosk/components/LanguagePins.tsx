/**
 * Which languages this lobby offers, as a control.
 *
 * The fact it edits is `KIOSK_KEYS.pins` — up to three languages beside
 * English, in the order they will stand on the idle screen's switch. It is a
 * property of the room rather than of whoever is holding the tablet, which is
 * why staff set it and a family never does: the switch a family presses
 * chooses *their* language out of this list and cannot change the list.
 *
 * Two placements, one control, and the second is why this is a component
 * rather than markup inside a screen. It was built on the pairing screen,
 * where a tablet is mounted; it is now also behind the staff gate, for the
 * Sunday the room turns out to read something else. The two differ only in how
 * far away the reader is — `size` is that, and nothing else.
 *
 * A language's own name is never translated (`LOCALE_LABELS`), so the chips'
 * words come from `src/lib/locales.ts` and not from the catalogue. English is
 * not among them: it is the resting language and the switch's first cell
 * whatever the disk says, so a chip for it would be a control that does
 * nothing.
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
}: {
  /** The lobby's languages beside English, in the order they will stand. */
  pins: readonly Locale[];
  onPins: (pins: Locale[]) => void;
  size?: LanguagePinsSize;
}) {
  const t = useTranslations('Pairing');
  const tap = useTap();
  /*
   * At the cap, and what that has to look like.
   *
   * `MAX_PINS` used to be enforced by an early `return` inside the press: the
   * chip flashed its `active:` fill and then nothing happened — no haptic, no
   * state, no sentence. That is the frozen-tablet reading `StaffScreen`'s own
   * header comment removed from the disabled reprint row, and it barely
   * mattered while this control only ever appeared at pairing, where nobody
   * starts at three. Behind the staff gate the three-pinned swap is the
   * *typical* errand, so the fourth press is the one a volunteer makes first.
   *
   * Dimming is the right signal here and only here: these chips really are
   * unavailable, and the note below says why in a sentence. Absent would be
   * wrong — a language that vanished from the row would read as one this
   * build cannot speak.
   */
  const full = pins.length >= MAX_PINS;

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
          const spare = pinned || !full;
          return (
            <button
              key={candidate}
              type="button"
              tabIndex={-1}
              lang={candidate}
              aria-pressed={pinned}
              aria-disabled={!spare || undefined}
              {...(spare
                ? tap(() => {
                    haptic();
                    onPins(
                      pinned ? pins.filter((pin) => pin !== candidate) : [...pins, candidate],
                    );
                  })
                : {})}
              className={`flex items-center justify-center rounded-xl font-semibold whitespace-nowrap ${CHIP[size]} ${
                pinned
                  ? 'bg-ink-700 text-ink-50 ring-2 ring-ink-400'
                  : spare
                    ? 'bg-ink-800/70 text-ink-400 ring-1 ring-ink-700 active:bg-ink-700 active:text-ink-100'
                    : /* Inert, and drawn inert. No `active:` fill, because a
                         chip that lights under a thumb and then does nothing
                         is the press a volunteer repeats. */
                      'bg-ink-900 text-ink-600 ring-1 ring-ink-800'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              {LOCALE_LABELS[candidate]}
            </button>
          );
        })}
      </div>

      {/* One slot, two sentences: how to choose, or — once three are chosen —
          why the fourth chip is dim and what to press instead. */}
      <div className={`max-w-md leading-relaxed text-ink-400 ${NOTE[size]}`}>
        {full ? t('pinFull') : t('pinHint')}
      </div>

      {/*
        * A miniature of the switch as it will stand, once anything is chosen.
        *
        * Whoever is setting this is deciding what a family will see, and the
        * honest way to show a layout is the layout — the cap on pins exists
        * because a fourth name takes the switch to two rows and drops the
        * instruction under it, which is a thing to be seen rather than read
        * about. It is also the confirmation: nothing here has a Save button.
        */}
      {pins.length > 0 && (
        <div className="flex w-full flex-col items-center gap-2 pt-2">
          <div className={`text-ink-500 ${NOTE[size]}`}>{t('pinPreview')}</div>
          <LanguageSwitch names={[DEFAULT_LOCALE, ...pins]} preview />
        </div>
      )}
    </>
  );
}
