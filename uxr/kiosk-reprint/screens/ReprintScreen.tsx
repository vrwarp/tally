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
import { useEffect } from 'react';
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

/*
 * The inactivity return is not here.
 *
 * It was, and it was also on the confirm screen and on neither of the other
 * two, which is the whole argument for taking it off the screens: a clock per
 * screen is a clock the fifth screen does not get. It is on the gate now —
 * `StaffSession` — armed by the hold on Clear that opens this flow and
 * disarmed when the flow closes, restarted by any pointer event rather than
 * only by the keystrokes this screen can see.
 */

function gradeLabel(grade: number | null): string {
  return grade === null ? '' : gradeDescription(grade);
}

export function ReprintScreen({
  buffer,
  outcome,
  presentIds,
  sentId,
  printerNeedsAttention,
  onKey,
  onPick,
  onDone,
}: {
  buffer: string;
  outcome: ReprintOutcome;
  /** Checked in tonight — context, never a gate: staff may reprint anybody. */
  presentIds: ReadonlySet<string>;
  /**
   * The child whose name tag just went to the printer, for the line that says
   * so — by id, never by rendered name. This list exists because a church has
   * two Alvarezes in it; matching the receipt on "Ramona Alvarez" puts *Name
   * tag sent* on both of any two children who share a display name, which is
   * exactly the row a volunteer is about to press again.
   */
  sentId: string | null;
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
  const { regionRef, contentRef, overflowing, fadeVars } = useOverflowFade();

  useEffect(() => {
    if (regionRef.current) regionRef.current.scrollTop = 0;
  }, [buffer, regionRef]);

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
        *
        * Two stacked centred lines on a phone, one line on the landscape kiosk.
        *
        * 1280×800 is the shape with the least vertical track in the set and the
        * most horizontal: the mark and the standing promise are 250px and 340px
        * of a 1280px band, and stacking them spends thirty-six pixels of the
        * only track the results list can grow into. It is the same thirty-six
        * pixels that decides whether three rows and a caption fit under a row
        * box stepped for arm's length — so the header gives it back where the
        * width is free, and nowhere else.
        */}
      <div className="px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
        <div className="flex flex-col items-center lg:flex-row lg:justify-center lg:gap-5">
          <StaffMark />
          <div className="pt-2 text-base text-ink-500 kiosk:text-lg lg:pt-0">
            Nobody is checked in or out from this screen.
          </div>
        </div>
        {/*
          * The condition, at a weight under the names.
          *
          * Bold amber over two lines made the transient property the loudest
          * object on a screen whose job is to find a child, above a list of
          * children in plain ink — and it cost a row of that list to do it. The
          * consequence clause went with the weight: `ReprintConfirmScreen`
          * restates it attached to the button that spends the label, which is
          * where a volunteer can act on it, and this line only has to say that
          * the printer is not right.
          */}
        {printerNeedsAttention && (
          <div className="pt-1 text-base text-warn-400 kiosk:text-lg">
            Printer needs attention.
          </div>
        )}
      </div>

      {/*
        * The scroller and the sentence about the result set are two things.
        *
        * They were one, and the circle that made was the whole of the capped
        * state's trouble: the caption sat inside the measured content, so the
        * caption is what pushed the box into overflow, the overflow is what
        * fired the ramp, and the ramp is what erased the caption — in the one
        * state whose entire job is to say there are more names. It is a sibling
        * under the scroller now: always drawn, never measured, and it cannot
        * dim anything.
        */}
      <div className="mb-4 flex min-h-0 flex-col">
        <div
          ref={regionRef}
          className={`flex min-h-0 flex-col overflow-y-auto overscroll-contain scroll-touch px-6 ${
            overflowing ? 'kiosk-list-fade' : ''
          }`}
          style={{ touchAction: 'pan-y', ...fadeVars }}
        >
          {/* The rows, measured as one thing — see useOverflowFade. The ramp's
              clearance is the spacer below, and it is the depth of the ramp
              rather than a row: reserving eighty-eight pixels against a nine
              pixel overrun is the clearance becoming the overflow. */}
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
                const justSent = sentId === student.id;
                return (
                  <button
                    key={student.id}
                    type="button"
                    tabIndex={-1}
                    {...rowTap(student)}
                    /*
                     * The box steps where the type does.
                     *
                     * The height was `tall:` and the type is `kiosk:`, so on the
                     * landscape kiosk — which is not tall — a 24px name over an
                     * 18px subline sat in the phone's 64px box: six pixels of ink
                     * to the top edge against twenty to the side, on the largest
                     * and furthest glass in the building.
                     *
                     * `kiosk:h-18` rather than the portrait kiosk's `h-20`
                     * because 1280×800 leaves this region under three hundred
                     * pixels and it has to hold three rows *and* the caption
                     * under them. Eighty would not fit either, and a row that
                     * does not fit is answered by a ramp, which is the failure
                     * this height was raised to avoid.
                     */
                    className="flex h-16 w-full shrink-0 flex-col justify-center rounded-xl bg-ink-800 px-5 text-left active:bg-ink-600 kiosk:h-18 tall:h-20 lg:not-first:mt-2 lg:w-full lg:break-inside-avoid"
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
          </div>

          {overflowing && (
            <div aria-hidden className="shrink-0" style={{ height: 'var(--kiosk-fade)' }} />
          )}
        </div>

        {/* What is true of the result set, not of the box — which is why it is
            out here. "More names than fit" is also read against a list with two
            rows of empty track under it on the portrait kiosk: the cap is six
            because the *landscape* kiosk's region holds three rows a column,
            and a sentence about fitting is a sentence a volunteer can see is
            false. */}
        {truncated && (
          <div className="mx-auto w-full max-w-2xl shrink-0 px-6 pt-2 text-center text-base text-ink-400 kiosk:text-lg lg:max-w-5xl">
            More names match — keep typing.
          </div>
        )}
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
        {/* `lg:h-14`: a 36px glyph in a 64px band is eight pixels of air the
            landscape kiosk's results list has a better use for. The portrait
            kiosk keeps its 80. */}
        <div className="relative mx-auto flex h-16 max-w-2xl items-center justify-center text-center tall:h-20 lg:h-14 lg:max-w-5xl">
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
