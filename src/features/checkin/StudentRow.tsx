/**
 * One tappable student on the check-in roster.
 *
 * The first tap is still the whole row and still costs nothing to think about:
 * a student who is not here becomes a student who is. What changed is what a
 * *second* tap does. Undo used to be it, which meant the row had exactly one
 * verb and everything else about a student — their profile, a mis-identified
 * check-in — was somewhere else entirely, on a screen counselors do not have.
 *
 * So a checked-in row now splits in two. The check mark on the right is undo,
 * unconditionally and with no dialog, because that is the correction people
 * make most and it must stay a single tap. The rest of the row opens a small
 * strip of the rarer things underneath it: undo again (for a thumb that went
 * to the row rather than the mark), the student's profile, and "Wrong person",
 * which hands the check-in to somebody else without losing the minute it
 * happened.
 *
 * Nothing inside the row competes for the *first* tap: until a student is
 * checked in there is one button and one outcome.
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { WarningBadge } from '@/components/ui';
import { formatClock } from '@/lib/time';
import { cn, gradeLabel, gradeSentence, initials, NO_GRADE, sameItems } from '@/lib/utils';
import { studentFullName, type RosterEntry } from '@/types';

/**
 * What the row is being used for.
 *
 * `swap` is the check-in screen turned into a person picker — see
 * `CheckInPage`. The list, the search box and the filters are all the ones a
 * counselor already knows; only the meaning of a tap changes, so the rows say
 * so rather than looking identical and doing something else.
 */
export type StudentRowMode = 'checkin' | 'swap';

export interface StudentRowProps {
  entry: RosterEntry;
  /**
   * The row itself. Checks the student in, opens the action strip, or takes the
   * check-in being moved — whichever the row currently means.
   */
  onPress: (entry: RosterEntry) => void;
  /** The check mark, and the `Undo` action under it. */
  onUndo?: (entry: RosterEntry) => void;
  /** `Wrong person` — starts the swap. */
  onSwap?: (entry: RosterEntry) => void;
  /**
   * Records a pickup, and puts one back. Only passed on a gathering that tracks
   * check-out, which is what turns the trailing button from undo into `Out`.
   */
  onCheckOut?: (entry: RosterEntry) => void;
  onUndoCheckOut?: (entry: RosterEntry) => void;
  /** Whether this gathering tracks check-out at all. */
  tracksCheckOut?: boolean;
  mode?: StudentRowMode;
  /** In `swap` mode: this row is the check-in being moved. */
  isSwapSource?: boolean;
  /** Whether the action strip is open. Only one row's is, screen-wide. */
  expanded?: boolean;
  /** Drives the optimistic green flash; set the instant the row is tapped. */
  flashing?: boolean;
  /** True while this row's own write is in flight, so a double-tap cannot fire twice. */
  busy?: boolean;
  /**
   * Allow the "3 of 3" prediction hint. It still only renders on the rows the
   * prediction actually picked out, which is what makes a regular legible in
   * the unfiltered list now that they no longer sit in a block of their own.
   */
  showRecentHint?: boolean;
  /**
   * Whether to offer `Profile` at all. The student pages are core-team only —
   * see `RequireRole` — and a button that lands a counselor on "Core team only"
   * is worse than no button.
   */
  canOpenProfile?: boolean;
  /**
   * What the allergy is, when Planning Center has been asked and answered.
   *
   * Absent — no answer yet, no note on file, or a read that failed — leaves the
   * badge saying `Allergy` on its own, which is what it always said. See
   * `useAllergyNotes`.
   */
  allergyNote?: string;
}

/**
 * Whether two roster entries would paint the same row.
 *
 * `buildRoster` mints fresh entry objects on every rebuild, so identity alone
 * would let one check-in re-render every row on the screen — two hundred rows
 * repainted so that one could turn green. The fields compared are exactly the
 * ones the row renders; `rsvp` is on the entry but never drawn here.
 */
function sameEntry(a: RosterEntry, b: RosterEntry): boolean {
  return (
    a.student === b.student &&
    (a.attendance?.checkedInAt.getTime() ?? null) ===
      (b.attendance?.checkedInAt.getTime() ?? null) &&
    // A field this comparator does not read is a row that never repaints, and
    // a pickup that never appears on screen.
    (a.attendance?.checkedOutAt?.getTime() ?? null) ===
      (b.attendance?.checkedOutAt?.getTime() ?? null) &&
    a.isRecent === b.isRecent &&
    a.recentHits === b.recentHits &&
    a.recentWindow === b.recentWindow &&
    sameItems(a.warnings, b.warnings)
  );
}

/**
 * Shared by the buttons in the action strip.
 *
 * `basis-0` with `flex-1` so two of them and three of them both fill the row —
 * a counselor without the student pages does not get "Profile" at all, and the
 * strip must not leave a hole where it would have been.
 */
const ACTION =
  'flex min-h-11 flex-1 basis-0 items-center justify-center rounded-lg px-2 text-[13px] ' +
  'font-semibold whitespace-nowrap ring-1 transition-colors disabled:opacity-60';

export const StudentRow = memo(function StudentRow({
  entry,
  onPress,
  onUndo,
  onSwap,
  mode = 'checkin',
  isSwapSource = false,
  expanded = false,
  flashing = false,
  busy = false,
  showRecentHint = false,
  canOpenProfile = false,
  allergyNote,
  onCheckOut,
  onUndoCheckOut,
  tracksCheckOut = false,
}: StudentRowProps) {
  const { student, attendance, warnings, isRecent, recentHits, recentWindow } = entry;
  const name = studentFullName(student);
  const grade = gradeLabel(student);
  const showHint = showRecentHint && isRecent && recentWindow > 0;

  const swapping = mode === 'swap';
  const here = attendance !== null;
  /*
   * Collected, on a gathering that tracks it.
   *
   * Gated on `tracksCheckOut` rather than on the field alone: turning the
   * toggle back off should put the roster back exactly as it was, not leave
   * dimmed rows behind carrying a state nothing on screen explains.
   */
  const gone = tracksCheckOut && attendance?.checkedOutAt != null;
  // The action strip belongs to a check-in. While the screen is picking a
  // person it would be a second, contradictory meaning for the same row.
  const open = expanded && here && !swapping;

  /*
   * A row that cannot take the check-in being moved.
   *
   * The source is inert because handing a check-in to the student it is already
   * on is not a correction, and anybody else who is already here would have
   * their own check-in silently overwritten — that is two students at the door
   * and one record, which is worse than the mistake being fixed.
   */
  const unavailable = swapping && (isSwapSource || here);

  // Null for somebody Planning Center holds no grade for — an adult on a
  // hand-picked roster. The clause goes rather than announcing a grade Tally
  // invented, which on this screen is read aloud beside a name.
  const spokenGrade = gradeSentence(student);
  const gradeClause = spokenGrade ? `, ${spokenGrade}` : '';
  const action = swapping
    ? isSwapSource
      ? `${name}${gradeClause} — the check-in being moved`
      : here
        ? `${name}${gradeClause} — already checked in`
        : `Move the check-in to ${name}${gradeClause}`
    : gone
      ? `More actions for ${name}${gradeClause}, collected at ${formatClock(attendance!.checkedOutAt!)}`
      : here
        ? `More actions for ${name}${gradeClause}, checked in at ${formatClock(attendance.checkedInAt)}`
        : `Check in ${name}${gradeClause}`;
  /*
   * Nothing inside the row is announced on its own, so the note has to be part
   * of a label or it is not read out at all — and this is the label it belongs
   * on: the row is the target that names the student, while the check mark
   * beside it is one verb about a check-in. Saying it on both would read the
   * allergy out twice per row.
   *
   * Last, after the action: the verb is what a screen reader user is scanning
   * for, and hearing "allergy" first on every flagged row would bury it.
   */
  const label = allergyNote ? `${action}. Allergy: ${allergyNote}` : action;

  const actionsId = `row-actions-${student.id}`;

  /*
   * Which corners of the card each button actually owns.
   *
   * The card draws the rounded shape and clips to it, so a square-cornered
   * button inside it looks right at rest and wrong the moment it is focused: a
   * focus ring is an outline, an outline traces the *button's* radius, and the
   * card's curve then cuts the corners off it. The ring ran straight, stopped
   * short at each curve and picked up again after it.
   *
   * It cannot be a flat `rounded-xl`, because the row changes shape under it. A
   * checked-in row hands its right-hand side to the undo button; an expanded
   * one hands its bottom edge to the actions strip. Rounding a corner another
   * control owns would put a curve in the middle of the card.
   */
  const undoBeside = here && !swapping;
  const rowCorners = cn(
    'rounded-tl-xl',
    !open && 'rounded-bl-xl',
    !undoBeside && 'rounded-tr-xl',
    !undoBeside && !open && 'rounded-br-xl',
  );

  return (
    <li>
      {/*
        The card is the container now, not the button.

        A checked-in row holds two independent targets — the row and the check
        mark — and a button cannot live inside a button. So the surface, the
        ring and the flash sit out here, and the buttons on top of it are
        transparent until they are hovered or pressed.
      */}
      <div
        className={cn(
          'overflow-hidden rounded-xl ring-1 transition-colors',
          gone
            ? 'bg-ink-900 ring-ink-800'
            : here
              ? 'bg-present-500/10 ring-present-500/30'
              : swapping
                ? 'bg-ink-900 ring-brand-500/30'
                : 'bg-ink-900 ring-ink-800',
          // Neutral and spent rather than an error colour. A collected child is
          // the happy ending, and a student with no pickup recorded has done
          // nothing wrong either — see the badge below.
          gone && 'opacity-60',
          unavailable && 'opacity-60',
          flashing && 'animate-flash',
        )}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => onPress(entry)}
            disabled={busy || unavailable}
            aria-busy={busy || undefined}
            aria-label={label}
            aria-expanded={here && !swapping ? open : undefined}
            aria-controls={open ? actionsId : undefined}
            className={cn(
              'flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left',
              rowCorners,
              'disabled:cursor-default',
              // Hover is the pointer's version of the press state. Without it the
              // roster was the one list in the app that gave a mouse nothing back —
              // the student directory, the MIA list and the calendar all respond —
              // on the screen where the tap has the largest consequence.
              !unavailable &&
                (here
                  ? 'hover:bg-present-500/10 active:bg-present-500/10'
                  : 'hover:bg-ink-800 active:bg-ink-800'),
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                here ? 'bg-present-500/20 text-present-400' : 'bg-ink-800 text-ink-300',
              )}
            >
              {initials(student.firstName, student.lastName)}
            </span>

            <span className="min-w-0 flex-1">
              {/*
                The given name leads and carries the weight, because it is the key
                the list is sorted on and therefore the word a thumb-scrolling eye
                is travelling down. Printed at one weight, "Maya Adebayo" gave the
                scan nothing to land on: the leading word ran Maya, Andre, Chloe,
                Ruby with no order in it, and a counselor either read all
                twenty-four rows or gave up and typed.
              */}
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-base text-ink-50">
                  <span className="font-semibold">{student.firstName}</span>{' '}
                  <span className="font-normal text-ink-300">{student.lastName}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-ink-500">
                  {grade ?? NO_GRADE}
                </span>
              </span>

              {warnings.length > 0 || showHint || unavailable || gone ? (
                // `items-start`, because the allergy badge is allowed to be
                // several lines tall when the note is long: everything beside it
                // should sit at its first line rather than halfway down it.
                <span className="mt-1 flex flex-wrap items-start gap-1">
                  {/*
                    The ratio leads, badges trail. It is set in tabular numerals —
                    somebody wanted it to line up — and a badge laid out ahead of it
                    moved its column 75px to the right on the four rows that carry
                    one, so the number a counselor compares down the list never
                    appeared twice in the same place.
                  */}
                  {unavailable ? (
                    <span className="text-[11px] font-medium text-ink-400">
                      {isSwapSource ? 'The check-in being moved' : 'Already checked in'}
                    </span>
                  ) : null}
                  {/*
                    Stated, not flagged. A student with no pickup recorded gets
                    no badge and no colour either — nothing here reads as an
                    error, because a missed check-out is not one.
                  */}
                  {gone ? (
                    <span className="text-[11px] font-medium tabular-nums text-ink-400">
                      Out {formatClock(attendance!.checkedOutAt!)}
                    </span>
                  ) : null}
                  {showHint && !unavailable ? (
                    <span
                      className="text-[11px] font-medium tabular-nums text-ink-500"
                      title={`Attended ${recentHits} of the last ${recentWindow}`}
                    >
                      {recentHits} of {recentWindow}
                    </span>
                  ) : null}
                  {warnings.map((warning) => (
                    <WarningBadge
                      key={warning}
                      warning={warning}
                      detail={warning === 'allergy' ? allergyNote : undefined}
                    />
                  ))}
                </span>
              ) : null}
            </span>

            {/* The trailing slot, for every row whose check mark is not its own
                button: an empty ring while they are absent, and in swap mode an
                arrow that says where a tap sends the check-in. */}
            {!here ? (
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full',
                  swapping
                    ? 'text-lg leading-none font-semibold text-brand-300'
                    : 'ring-2 ring-ink-700',
                )}
              >
                {swapping ? '→' : null}
              </span>
            ) : null}
            {here && swapping ? (
              <span aria-hidden="true" className="text-xl leading-none text-present-400">
                ✓
              </span>
            ) : null}
          </button>

          {/*
            The one-tap slot at the end of a checked-in row.

            Ordinarily undo: the check mark is the thing a counselor points at
            when they say "that one is wrong", so it undoes rather than opening
            a menu about undoing.

            On a gathering that tracks check-out the slot goes to `Out`
            instead, and undo moves into the action strip one tap deeper. That
            is the right way round for a nursery: collecting children is the
            gesture repeated forty times a morning while undo stays the rare
            correction. Nothing is lost — the strip carries it for both states.
          */}
          {here && !swapping ? (
            <button
              type="button"
              onClick={() =>
                gone ? onUndoCheckOut?.(entry) : tracksCheckOut ? onCheckOut?.(entry) : onUndo?.(entry)
              }
              disabled={busy}
              aria-busy={busy || undefined}
              aria-label={
                gone
                  ? `Put ${name}${gradeClause} back in the room — collected at ${formatClock(attendance.checkedOutAt!)}`
                  : tracksCheckOut
                    ? `Check out ${name}${gradeClause}, checked in at ${formatClock(attendance.checkedInAt)}`
                    : `Undo check-in for ${name}${gradeClause}, checked in at ${formatClock(attendance.checkedInAt)}`
              }
              className={cn(
                'flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 px-2',
                // The right-hand end of the card, minus its bottom corner
                // whenever the actions strip is open underneath. See `rowCorners`.
                'rounded-tr-xl',
                !open && 'rounded-br-xl',
                'border-l disabled:opacity-60',
                gone
                  ? 'border-ink-800 text-ink-400 hover:bg-ink-800/60 active:bg-ink-800/60'
                  : 'border-present-500/20 text-present-400 hover:bg-present-500/15 active:bg-present-500/15',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'leading-none',
                  gone || !tracksCheckOut ? 'text-xl' : 'text-[13px] font-semibold',
                )}
              >
                {gone ? '↺' : tracksCheckOut ? 'Out' : '✓'}
              </span>
              <span aria-hidden="true" className="text-[11px] tabular-nums text-ink-500">
                {formatClock(gone ? attendance.checkedOutAt! : attendance.checkedInAt)}
              </span>
            </button>
          ) : null}
        </div>

        {open ? (
          <div
            id={actionsId}
            className={cn(
              'flex gap-2 border-t px-3 py-2',
              gone ? 'border-ink-800' : 'border-present-500/20',
            )}
          >
            {/*
              Undo the *check-in*, in both states. On a collected row that
              deletes the record and takes the pickup with it, which is right:
              a pickup recorded against somebody who was never here is not
              worth keeping either.
            */}
            <button
              type="button"
              onClick={() => onUndo?.(entry)}
              disabled={busy}
              aria-label={`Undo the check-in for ${name}`}
              className={cn(ACTION, 'bg-ink-900 text-ink-100 ring-ink-700 hover:bg-ink-800')}
            >
              Undo
            </button>

            {canOpenProfile ? (
              <Link
                to={`/students/${student.id}`}
                aria-label={`Open the profile for ${name}`}
                className={cn(ACTION, 'bg-ink-900 text-ink-100 ring-ink-700 hover:bg-ink-800')}
              >
                Profile
              </Link>
            ) : null}

            <button
              type="button"
              onClick={() => onSwap?.(entry)}
              disabled={busy}
              aria-label={`Wrong person — move ${name}’s check-in to somebody else`}
              className={cn(
                ACTION,
                'bg-brand-500/10 text-brand-300 ring-brand-500/30 hover:bg-brand-500/20',
              )}
            >
              Wrong person
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
},
(prev, next) =>
  prev.onPress === next.onPress &&
  prev.onUndo === next.onUndo &&
  prev.onSwap === next.onSwap &&
  prev.mode === next.mode &&
  prev.isSwapSource === next.isSwapSource &&
  prev.expanded === next.expanded &&
  prev.flashing === next.flashing &&
  prev.busy === next.busy &&
  prev.showRecentHint === next.showRecentHint &&
  prev.canOpenProfile === next.canOpenProfile &&
  prev.allergyNote === next.allergyNote &&
  prev.onCheckOut === next.onCheckOut &&
  prev.onUndoCheckOut === next.onUndoCheckOut &&
  prev.tracksCheckOut === next.tracksCheckOut &&
  sameEntry(prev.entry, next.entry));
