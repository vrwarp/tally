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
 * So the delete is not a door on the menu any more. It is the quiet control at
 * the bottom of the screen that can also undo it, in the words a volunteer was
 * trained to look for: *hold Clear, press Languages, press English only* still
 * terminates.
 *
 * ## Written on every tap
 *
 * No Save button and no confirm on unpinning, for a reason that is measured
 * rather than tasteful: `STAFF_RETURN_MS` hands the kiosk back to the lobby
 * after forty-five seconds without a pointer event, and standing here deciding
 * whether the third language is worth it is exactly that. A screen that
 * collected an edit and waited for a press would lose the edit to the clock.
 * The preview under the chips is the confirmation instead, and nothing here
 * costs anything to redo.
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
  /** The lobby's languages beside English, in the order they stand. */
  pins: readonly Locale[];
  onPins: (pins: Locale[]) => void;
  /**
   * Every language off at once and back to the door — the words the phone
   * script ends on, and the one press that used to be a row on the gate.
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
       wrapper. Four chips and a two-row preview fit every glass this runs on,
       but a translation is free to be longer than the English. */
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
            */}
          <p className="mx-auto max-w-xl text-lg text-ink-400 kiosk:text-2xl">
            {t('languagesAbout')}
          </p>
        </div>

        <div className="flex w-full max-w-md flex-col items-center gap-3 kiosk:max-w-xl">
          <LanguagePins pins={pins} onPins={onPins} size="kiosk" />
        </div>

        <div className="flex w-full max-w-md flex-col kiosk:max-w-xl">
          {/* The loud one is the way back, as on every screen behind this
              gate: the chips above have already done what the volunteer came
              for, so the only thing left for a button to do is open the door. */}
          <button
            type="button"
            tabIndex={-1}
            {...tap(() => {
              haptic();
              onDone();
            })}
            className="flex h-16 w-full items-center justify-center rounded-xl bg-brand-600 text-xl font-semibold text-white active:bg-brand-500 kiosk:h-24 kiosk:text-3xl"
          >
            {t('doneBackToCheckIn')}
          </button>

          {/*
            * The delete, kept quiet and kept here.
            *
            * Drawn only while there is something to take off: a control that
            * takes nothing off answers a press with nothing, which is the
            * frozen-tablet reading this codebase removes wherever it finds it.
            * `mt-3` above the group's own nothing — these two are not peers,
            * and air is the answer rather than another hold, exactly as on
            * `ChangeEventScreen`.
            */}
          {pins.length > 0 && (
            <button
              type="button"
              tabIndex={-1}
              {...tap(() => {
                haptic();
                onEnglishOnly();
              })}
              className="mt-3 flex h-14 w-full items-center justify-center rounded-xl bg-ink-800 px-5 text-lg font-semibold text-ink-200 active:bg-ink-700 kiosk:h-20 kiosk:text-2xl"
            >
              {t('englishOnly')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
