/**
 * The screen a parent actually uses.
 *
 * Fixed geometry, top to bottom: event header, the typed buffer, a
 * fixed-height results area, the keyboard. A keystroke changes text and row
 * contents and never the geometry of the frame — nothing reflows, and the
 * keyboard subtree never re-renders (see components/Keyboard.tsx).
 *
 * The results area is the one part that scrolls. A search can return up to
 * MAX_RESULTS rows and a phone in a lobby has room for about four of them, so
 * the region clipped the rest mid-row: it looked scrollable, and wasn't, and a
 * family whose name sorted fifth simply could not be reached. Only that region
 * scrolls — the header, the buffer and the keyboard stay pinned, because a
 * keyboard that scrolls off the bottom is worse than a list that ends early.
 *
 * The top-left corner hides the staff gate: a three-second hold returns to
 * the event chooser. Invisible on purpose — parents have no business there,
 * and staff are told where it is.
 */
import { useEffect, useMemo, useRef } from 'react';
import { gradeDescription } from '@/lib/utils';
import { HoldButton } from '../components/HoldButton';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import { useTapGuard } from '../components/tapGuard';
import { windowHasClosed, type KioskBinding } from '../binding';
import {
  searchStudents,
  MAX_RESULTS,
  type KioskStudent,
} from '../search';

function gradeLabel(grade: number | null): string {
  return grade === null ? '' : gradeDescription(grade);
}

export function SearchScreen({
  binding,
  buffer,
  onKey,
  students,
  last4Index,
  presentIds,
  checkedOutIds,
  tracksCheckOut,
  printerNeedsAttention,
  onPick,
  onUnbind,
}: {
  binding: KioskBinding;
  buffer: string;
  onKey: (key: KioskKey) => void;
  students: readonly KioskStudent[];
  last4Index: Readonly<Record<string, string[]>>;
  presentIds: ReadonlySet<string>;
  checkedOutIds: ReadonlySet<string>;
  tracksCheckOut: boolean;
  printerNeedsAttention: boolean;
  onPick: (student: KioskStudent) => void;
  onUnbind: () => void;
}) {
  const outcome = useMemo(
    () => searchStudents(buffer, students as KioskStudent[], last4Index),
    [buffer, students, last4Index],
  );
  const closed = windowHasClosed(binding, Date.now());

  /*
   * A row commits on lift, not on contact, because this list scrolls — see
   * components/tapGuard.ts for why that has to be, and what counts as a tap.
   */
  const rowTap = useTapGuard(onPick);

  /*
   * Every keystroke starts the list again from the top. Without this, a parent
   * who scrolled down a broad match and then typed one more letter would be
   * looking at the bottom of a list short enough to have no bottom — an empty
   * box, under a buffer that says their name is being searched for.
   */
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [buffer]);

  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr_auto]">
      {/* Header — with the invisible staff gate over its left corner. */}
      <div className="relative px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
        <HoldButton
          onHeld={onUnbind}
          className="absolute top-0 left-0 h-16 w-16 opacity-0"
          aria-label="Change event (staff)"
        >
          {''}
        </HoldButton>
        {/*
          * The printer, when it has stopped working.
          *
          * A dot, absolutely positioned, and only ever in the corner: a parent
          * cannot fix a printer and telling them about it beside a green tick
          * reads as "your check-in failed". Absolute because this file promises
          * that a keystroke changes text and never geometry, and a warning that
          * appears mid-evening must not push the results down by a line.
          *
          * What a volunteer does about it is hold the opposite corner and look
          * at the printer screen, which says what is actually wrong.
          */}
        {printerNeedsAttention && (
          <span
            aria-label="The label printer needs attention"
            className="absolute top-[max(1rem,var(--spacing-safe-top))] right-4 h-3 w-3 rounded-full bg-warn-500"
          />
        )}
        <div className="text-lg font-semibold text-ink-200">{binding.title}</div>
        <div className="text-sm text-ink-500">
          {tracksCheckOut
            ? 'Welcome! Check in below, or tap a name to collect.'
            : closed
              ? 'Check-in window has closed — you can still check in.'
              : 'Welcome! Check in below.'}
        </div>
      </div>

      {/* The buffer. A div, never an input — the native keyboard must not rise. */}
      <div className="px-6 pb-2">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-center rounded-xl bg-ink-900 px-4">
          {buffer ? (
            <span className="truncate text-3xl font-semibold tracking-wide text-ink-50">{buffer}</span>
          ) : (
            <span className="text-xl text-ink-500">Type a name, or the last 4 digits of your phone</span>
          )}
        </div>
      </div>

      {/* Results — fixed-height rows in a fixed region that scrolls past them. */}
      <div
        ref={resultsRef}
        className="min-h-0 overflow-y-auto overscroll-contain scroll-touch px-6"
        style={{ touchAction: 'pan-y' }}
      >
        {/* The bottom padding rides on the column, not the scroller: end
            padding on a scroll container is not reliably scrollable to. */}
        <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-2">
          {outcome.mode === 'phone-partial' && (
            <div className="pt-6 text-center text-lg text-ink-400">
              Enter all 4 digits of a phone number in your family.
            </div>
          )}
          {(outcome.mode === 'phone' || outcome.mode === 'name') && outcome.results.length === 0 && (
            <div className="pt-6 text-center text-lg text-ink-400">
              No match — please see a leader.
            </div>
          )}
          {outcome.results.slice(0, MAX_RESULTS).map((student) => {
            const present = presentIds.has(student.id);
            /*
             * Three states where check-out is tracked, two everywhere else.
             *
             * A present child stops being an inert "already done" row and
             * becomes the collect target — which is the whole pickup flow.
             * A collected one goes inert again, dimmed, so a parent cannot
             * hand the same child back twice.
             */
            const collected = tracksCheckOut && checkedOutIds.has(student.id);
            const inert = present && !tracksCheckOut;
            return (
              <button
                key={student.id}
                type="button"
                tabIndex={-1}
                {...rowTap(student)}
                className={`flex h-16 shrink-0 items-center justify-between rounded-xl px-5 text-left ${
                  collected
                    ? 'bg-ink-900/60 opacity-60'
                    : present
                      ? 'bg-present-600/20'
                      : 'bg-ink-900 active:bg-ink-700'
                } ${inert || collected ? '' : 'active:bg-ink-700'}`}
              >
                <span className="truncate text-xl font-semibold text-ink-100">
                  {student.firstName} {student.lastName}
                </span>
                <span className="pl-3 text-base whitespace-nowrap text-ink-400">
                  {collected ? (
                    <span className="font-semibold text-ink-400">Collected</span>
                  ) : present && tracksCheckOut ? (
                    <span className="font-semibold text-brand-300">Tap to collect</span>
                  ) : present ? (
                    <span className="font-semibold text-present-400">✓ Checked in</span>
                  ) : (
                    gradeLabel(student.grade)
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Keyboard onKey={onKey} />
    </div>
  );
}
