/**
 * Find a child, print their name tag again. The staff half of the search screen.
 *
 * It is the search screen because the search screen is the thing on this device
 * that already answers "which child" — same fixed geometry, same rows, same
 * keyboard, same promise that a keystroke changes text and never geometry. A
 * second way to find a name would be a second way to get it wrong.
 *
 * What is different is everything about who is standing there. A volunteer, not
 * a parent; one child they can already name, not a family they are checking in;
 * and a kiosk that is still bound, still holding its queue, and has to go back
 * to being a parent's screen the moment they walk away.
 *
 * So: the parent's doors are gone (nobody registers a child from here), the
 * surface says whose screen this is, and the way out is standing in the console
 * where the register offer used to be — the one row on this layout that is
 * always present and never moves.
 *
 * The rows carry no chip. A `Print` chip on the right of every row was a second
 * affordance stacked on the first — the row is already the target — and it was
 * bought with the only thing on the row that matters: the name is `min-w-0
 * truncate` and the cluster beside it is `shrink-0`, so on a phone a list whose
 * whole difficulty is that Alvarez, Alvarez-Bell and Alvarado are all in it read
 * "Ramona A…", "Priya Alv…", "Sam Alvar…". It also put five identical ringed
 * brand chips down the right edge of the landscape kiosk, which made the accent
 * land on the affordance rather than on the choice — the same reason the
 * shipping search screen dropped the ring from its quiet control.
 */
import { useEffect, useRef } from 'react';
import { gradeDescription, haptic } from '@/lib/utils';
import { Keyboard, type KioskKey } from '@/kiosk/components/Keyboard';
import { useTapGuard } from '@/kiosk/components/tapGuard';
import type { KioskStudent } from '@/kiosk/search';
import { StaffMark } from './StaffMark';
import { useOverflowFade } from './useOverflowFade';

export interface ReprintOutcome {
  results: readonly KioskStudent[];
  total: number;
}

/**
 * How long a reprint screen is left on the glass with nobody touching it.
 *
 * Nothing returned this surface to check-in on its own, and it was the only
 * screen in the kiosk with that hole in it: `SuccessScreen` has
 * `AUTO_RETURN_MS`, `RegistrationFlow` has `INACTIVITY_MS`. A volunteer called
 * away mid-reprint left a lobby tablet showing a keyboard, a list of children's
 * names and live Print controls — and the next parent up types a name, taps a
 * row, meets a screen with their child's name on it and a full-width blue
 * button, presses it, gets a sticker, and walks away believing they have
 * checked in. That is a family recorded absent.
 *
 * Shorter than the registration wizard's ninety seconds because there is
 * nothing half-typed here worth protecting: the volunteer is standing at the
 * kiosk while they use it, and everything this screen holds is one keystroke to
 * get back.
 */
const RETURN_MS = 45_000;

function gradeLabel(grade: number | null): string {
  return grade === null ? '' : gradeDescription(grade);
}

export function ReprintScreen({
  buffer,
  outcome,
  presentIds,
  sent,
  printerNeedsAttention,
  onKey,
  onPick,
  onDone,
}: {
  buffer: string;
  outcome: ReprintOutcome;
  /** Checked in tonight — context, never a gate: staff may reprint anybody. */
  presentIds: ReadonlySet<string>;
  /** The last name tag sent to the printer, for the line that says so. */
  sent: string | null;
  /**
   * The printer, when it has stopped working.
   *
   * This screen used to take no printer state at all, which meant the one
   * screen that exists to print carried less printer awareness than the
   * parent-facing screen that does not — a volunteer catching up on five
   * children the printer missed at check-in got five reassurances and five
   * nothings. This is a staff surface, so it says so in words rather than in
   * the corner dot a parent gets.
   */
  printerNeedsAttention: boolean;
  onKey: (key: KioskKey) => void;
  onPick: (student: KioskStudent) => void;
  onDone: () => void;
}) {
  const rowTap = useTapGuard(onPick);
  const { regionRef, contentRef, overflowing } = useOverflowFade();

  useEffect(() => {
    if (regionRef.current) regionRef.current.scrollTop = 0;
  }, [buffer, regionRef]);

  /* Walked away. Any keystroke, any print, restarts the clock. */
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(), RETURN_MS);
    return () => clearTimeout(timer);
  }, [buffer, sent]);

  const rows = outcome.results.length > 0;
  const truncated = outcome.total > outcome.results.length;
  const wraps = outcome.results.length >= 4;

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto_auto_auto_auto]">
      {/*
        * Whose screen this is, said in the place the gathering's name usually
        * is, and under it the promise that survives everything this screen does.
        *
        * That promise used to be the slot the receipt was written into — "Name
        * tag sent for Ramona Alvarez.", in `present-400`, the token that means
        * *checked in* two lines below on Ramona's own row. So at the exact
        * moment the screen had acted, the one sentence saying it had not
        * touched the register vanished and was replaced by a green sentence
        * with a child's name in it. The receipt has gone to the row it belongs
        * to; this line is a standing property of the surface and does not move.
        */}
      <div className="px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
        <StaffMark />
        <div className="pt-2 text-base text-ink-500 kiosk:text-lg">
          Nobody is checked in or out from this screen.
        </div>
        {printerNeedsAttention && (
          <div className="mx-auto max-w-2xl pt-1 text-base font-semibold text-balance text-warn-400 kiosk:text-lg">
            Printer needs attention — a name tag may not come out.
          </div>
        )}
      </div>

      <div
        ref={regionRef}
        className={`mb-4 flex min-h-0 flex-col overflow-y-auto overscroll-contain scroll-touch px-6 ${
          overflowing ? 'kiosk-list-fade' : ''
        }`}
        style={{ touchAction: 'pan-y' }}
      >
        {/* Everything the region holds, measured as one thing — see
            useOverflowFade. The ramp's clearance is the spacer below, and it
            exists only when there is something to scroll. */}
        <div ref={contentRef} className="shrink-0">
          <div
            className={`mx-auto w-full max-w-2xl ${!rows ? 'pb-6' : ''} flex flex-col gap-2 ${
              wraps ? 'lg:block lg:columns-2 lg:gap-x-8 lg:max-w-5xl' : ''
            }`}
          >
            {!rows && (
              <div className="pt-6 text-center">
                <div className="text-2xl font-semibold text-ink-200 kiosk:text-3xl">
                  Type the child&apos;s name
                </div>
                {/*
                  * What actually happens, rather than what used to be promised.
                  *
                  * "Tap a name and a second copy of their name tag prints"
                  * described a one-tap print, and the flow opens a confirm — so
                  * it primed a volunteer to read all five rows carefully before
                  * touching one, which is exactly the hesitancy the confirm
                  * exists to remove. The register guarantee stays: it is the
                  * reason this screen is allowed to exist.
                  */}
                <p className="mx-auto max-w-md pt-3 text-lg text-ink-400 kiosk:text-xl">
                  Tap a name to see what will print, then confirm. Nothing about the register
                  changes.
                </p>
              </div>
            )}

            {outcome.results.map((student) => {
              const present = presentIds.has(student.id);
              /*
               * The receipt, on the row it belongs to.
               *
               * Not `present-400`: that token means checked in, and it was
               * being spent on a sentence whose whole job is to say that
               * nothing was checked in. Brand is the app's own accent and the
               * row is where the volunteer's eye already is, having just come
               * back from the confirm for this child.
               */
              const justSent = sent === `${student.firstName} ${student.lastName}`;
              return (
                <button
                  key={student.id}
                  type="button"
                  tabIndex={-1}
                  {...rowTap(student)}
                  className="flex h-16 w-full shrink-0 flex-col justify-center rounded-xl bg-ink-800 px-5 text-left active:bg-ink-600 tall:h-20 lg:not-first:mt-2 lg:w-full lg:break-inside-avoid"
                >
                  {/*
                   * The name gets the row's whole width, and everything else
                   * gets a line of its own under it.
                   *
                   * Side by side, the name was `min-w-0 truncate` against a
                   * `shrink-0` cluster, so the name is what lost — in a list
                   * whose entire difficulty is that Alvarez, Alvarez-Bell and
                   * Alvarado are all in it. Worst on the checked-in row, where
                   * "✓ Checked in" is longer than a grade: the row likeliest to
                   * be a reprint target showed no surname at all.
                   */}
                  <span className="truncate text-xl font-semibold text-ink-100 kiosk:text-2xl">
                    {student.firstName} {student.lastName}
                  </span>
                  {/* The receipt leads, and takes the checked-in clause's place
                      rather than queueing behind it: on a phone all three
                      clauses do not fit, and the one a volunteer is looking for
                      at that moment is the one that just happened. Presence is
                      context on this screen — never a gate — and it comes back
                      the moment the receipt clears. */}
                  <span className="truncate text-sm text-ink-400 kiosk:text-lg">
                    {justSent && (
                      <>
                        <span className="font-semibold text-brand-300">Name tag sent</span>
                        {' · '}
                      </>
                    )}
                    {gradeLabel(student.grade)}
                    {present && !justSent && (
                      <>
                        {' · '}
                        <span className="font-semibold text-present-400">✓ Checked in</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {truncated && (
            <div className="mx-auto w-full max-w-2xl pt-2 text-center text-base text-ink-400 kiosk:text-lg lg:max-w-5xl">
              More names than fit — keep typing.
            </div>
          )}
        </div>

        {overflowing && <div aria-hidden className="h-16 shrink-0 tall:h-20 lg:h-22" />}
      </div>

      <div className="border-t border-ink-800/70" />

      {/*
        * The console row the parent's screen fills with the register offer.
        * Here it is the way out — and it is the *only* thing that hands this
        * kiosk back to the parents by hand, so it is weighted like what it does
        * rather than like the quiet chip it replaced: 44px and 14px type was
        * smaller than every row above it and wore the rows' own fill.
        */}
      <div className="mx-auto flex h-16 w-full max-w-2xl items-center justify-center px-2 pt-2 tall:h-24 lg:max-w-5xl">
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={() => {
            haptic(8);
            onDone();
          }}
          className="flex h-14 min-w-0 shrink items-center justify-center truncate rounded-xl bg-ink-800 px-6 text-base font-semibold whitespace-nowrap text-ink-100 active:bg-ink-700 tall:h-16 tall:px-8 kiosk:text-lg"
        >
          Done — back to check-in
        </button>
      </div>

      <div className="px-6 pb-1">
        <div className="relative mx-auto flex h-16 max-w-2xl items-center justify-center text-center tall:h-20 lg:max-w-5xl">
          {buffer && (
            <span className="truncate text-3xl font-semibold tracking-wide text-ink-50 kiosk:text-4xl">
              {buffer}
            </span>
          )}
          {/*
            * How many of the matches are on the glass.
            *
            * "11 names" over a list of eight is a complete-looking answer to an
            * incomplete search, and the sentence that said otherwise was a
            * sibling below the rows — off the bottom of the landscape kiosk
            * entirely. A volunteer who cannot see their child concludes the
            * child is not in the system, or picks the nearest-looking name, and
            * there is no undo. The cap is a property of the result set, so it
            * is said where the eyes already are: beside the letters producing
            * it.
            */}
          {outcome.total > 0 && (
            <span className="absolute right-0 text-sm text-ink-400 kiosk:text-base">
              {truncated
                ? `${outcome.results.length} of ${outcome.total} names`
                : `${outcome.total} ${outcome.total === 1 ? 'name' : 'names'}`}
            </span>
          )}
        </div>
      </div>

      <Keyboard onKey={onKey} />
    </div>
  );
}
