/**
 * Which languages this lobby offers, behind the staff gate.
 *
 * The control itself was built on the pairing screen, on the reasoning that a
 * kiosk is mounted once and its language belongs with the rest of the mount.
 * That reasoning had three holes in it, and this screen is the holes:
 *
 * - A tablet staged with a pairing link in its start URL — the zero-touch
 *   route in `docs/tablet-management.md` — is claimed by `KioskApp` at boot
 *   and goes straight to the chooser. It never draws the pairing screen, so on
 *   a managed fleet the picker was not rare, it was unreachable.
 * - A room's languages are not a fact about the day the tablet was mounted.
 *   Families arrive, a tablet is carried to the gym for a week, a congregation
 *   starts meeting in the next hall. The pins outlive the reason for them.
 * - And the only thing the gate offered was **English only**, which deleted
 *   them: one press, permanent, and undoable only by an administrator retiring
 *   the device and a second person re-pairing at the tablet. Its neighbour
 *   *Hide the photo* looks identical and heals itself at the next rebind, so a
 *   volunteer told about one reasonably assumed the other.
 *
 * So the delete is not a door on the menu any more. It is the quiet control
 * above the way out, in the words a volunteer was trained to look for: *hold
 * Clear, press Languages, press English only* still terminates.
 *
 * ## Written on every tap, and nothing moves under a thumb
 *
 * No Save button and no confirm on unpinning, for a reason that is measured
 * rather than tasteful: `STAFF_ASKING_MS` hands the kiosk back after ninety
 * seconds without a pointer event, and standing here deciding whether the
 * third language is worth it is most of that. A screen that collected an edit
 * and waited for a press would lose the edit to the clock.
 *
 * Which makes the height of the bottom group load-bearing. The first chip a
 * volunteer pressed used to insert the delete below it, and a centred column
 * lifts everything above an insertion by half its height — so the second tap
 * of the ordinary two-language errand landed where the chips had been and hit
 * inert prose: no haptic, no fill, nothing, against a clock with a queue
 * behind it. The delete holds its space whether or not it is drawn, so the
 * screen is the same height in every state and a chip stays where it was
 * pressed.
 *
 * ## The delete is above the exit
 *
 * `StaffScreen` states the rule for a pair like this in its own comment: the
 * answer that costs somebody else goes first, so a thumb travelling up from
 * the bottom of the glass meets the safe one before the costly one. This
 * screen had them the other way round, twelve pixels apart, in slabs of the
 * same width and radius — and both landed the volunteer in the same place,
 * because the delete used to close the overlay too. A tap twelve pixels low
 * produced exactly the confirmation **Done** would have, and the mistake was
 * invisible until the next family.
 *
 * So the delete stays on this screen now. Three chips go dark, the control
 * itself disappears because there is nothing left to delete, and putting them
 * back is one tap each — which is the first time the screen's claim that
 * nothing here costs anything to redo has been true of it.
 */
import { useTranslations } from 'use-intl';
import { haptic } from '@/lib/utils';
import type { Locale } from '@/lib/locales';
import { LanguagePins } from '../components/LanguagePins';
import { useTap } from '../components/tapGuard';

export function LanguagesScreen({
  pins,
  onPins,
  onEnglishOnly,
  onDone,
}: {
  /** The lobby's languages beside English. A set; `sanitizePins` orders it. */
  pins: readonly Locale[];
  onPins: (pins: Locale[]) => void;
  /**
   * Every language off at once — the words the phone script ends on, and the
   * one press that used to be a row on the gate. It does not leave this
   * screen: see the note above on why the mistake has to be visible where it
   * is made.
   */
  onEnglishOnly: () => void;
  /**
   * Back to the lobby's own screen, not to the menu behind it.
   *
   * The printer door returns to the staff screen because a volunteer who
   * opened it was diagnosing and may not be finished. This errand is one
   * decision and the chips above have already recorded it, so a menu on the
   * way out is a dead stop with a queue waiting — the reprint screen's
   * **Done** makes the same call, in the same words.
   */
  onDone: () => void;
}) {
  const t = useTranslations('Staff');
  const tap = useTap();

  return (
    /* Scrolled only if it has to be — see the note on `StaffScreen`'s own
       wrapper. Everything here fits every glass this runs on, but a
       translation is free to be longer than the English. */
    <div className="h-full overflow-y-auto overscroll-contain scroll-touch">
      <div className="flex min-h-full flex-col items-center justify-center gap-6 p-8 text-center kiosk:gap-8">
        <div className="flex flex-col gap-2">
          <div className="text-4xl font-semibold text-ink-100">{t('languages')}</div>
          {/*
            * Whose fact this is, in one line, and not decoration. The pins
            * live with the hardware, so a tablet carried from the nursery to
            * the gym brings the old room's languages with it and says so
            * nowhere else — and a volunteer who cannot tell an intention from
            * an inheritance reaches for the destructive control.
            *
            * It opened with *The languages this kiosk offers*, which was the
            * third time that word arrived in the reader's first two hundred
            * milliseconds: the row they pressed, the title, then this. The
            * chips say it better than any of the three. `ink-500`, a step
            * under the hint that governs the control, because this is the
            * line you read once and that one is the instruction.
            */}
          <p className="mx-auto max-w-xl text-lg text-ink-500 kiosk:text-2xl">
            {t('languagesAbout')}
          </p>
        </div>

        <div className="flex w-full max-w-md flex-col items-center gap-3 kiosk:max-w-xl">
          <LanguagePins pins={pins} onPins={onPins} size="kiosk" />
        </div>

        <div className="flex w-full max-w-md flex-col kiosk:max-w-xl">
          {/*
            * The delete, quiet and first — see the note at the top of the
            * file. Absent while there is nothing to take off: a control that
            * takes nothing off answers a press with nothing, which is the
            * frozen-tablet reading this codebase removes wherever it finds
            * it.
            *
            * `invisible` rather than unrendered, which is the whole reason
            * the column can stay centred. Under `justify-center` a control
            * that comes and goes moves everything above it by half its
            * height, so the first chip of the ordinary two-language errand
            * lifted the chip row out from under the thumb about to press it
            * again. Holding its space keeps both states the same height:
            * `visibility: hidden` is not focusable, not hit-testable and not
            * in the accessibility tree, so what is reserved is the box and
            * nothing else.
            *
            * Narrower than the exit as well as quieter. Two full-width slabs
            * of the same radius one gap apart are one object — a primary and
            * its secondary, answering one question — and these two answer
            * nothing in common.
            */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden={pins.length === 0 || undefined}
            {...(pins.length > 0
              ? tap(() => {
                  haptic();
                  onEnglishOnly();
                })
              : {})}
            className={`mb-8 flex h-14 w-full max-w-xs items-center justify-center self-center rounded-xl bg-ink-800 px-5 text-lg font-semibold text-ink-200 active:bg-ink-700 kiosk:text-2xl tall:h-20 ${
              pins.length > 0 ? '' : 'invisible'
            }`}
          >
            {t('englishOnly')}
          </button>

          {/*
            * The way out. Brand fill, because that is what marks a terminal
            * action behind this gate — but at the doors' own label size
            * rather than above it. At `text-3xl` it was the largest type and
            * the only chroma on a screen whose work is the chips, so a squint
            * found the exit first and the control fourth.
            */}
          <button
            type="button"
            tabIndex={-1}
            {...tap(() => {
              haptic();
              onDone();
            })}
            className="flex h-16 w-full items-center justify-center rounded-xl bg-brand-600 text-xl font-semibold text-white active:bg-brand-500 kiosk:text-2xl tall:h-20"
          >
            {t('doneBackToCheckIn')}
          </button>
        </div>
      </div>
    </div>
  );
}
