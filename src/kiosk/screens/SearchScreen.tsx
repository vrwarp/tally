/**
 * The screen a parent actually uses.
 *
 * Fixed geometry, top to bottom: event header, the typed buffer, a
 * fixed-height results area, the keyboard. A keystroke changes text and row
 * contents and never geometry — nothing reflows, nothing scrolls, and the
 * keyboard subtree never re-renders (see components/Keyboard.tsx).
 *
 * The top-left corner hides the staff gate: a three-second hold returns to
 * the event chooser. Invisible on purpose — parents have no business there,
 * and staff are told where it is.
 */
import { useMemo } from 'react';
import { HoldButton } from '../components/HoldButton';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import { windowHasClosed, type KioskBinding } from '../binding';
import {
  searchStudents,
  MAX_RESULTS,
  type KioskStudent,
} from '../search';

function gradeLabel(grade: number | null): string {
  // The ministry is 6th–12th; every one of those ordinals ends in "th".
  return grade === null ? '' : `${grade}th grade`;
}

export function SearchScreen({
  binding,
  buffer,
  onKey,
  students,
  last4Index,
  presentIds,
  onPick,
  onUnbind,
}: {
  binding: KioskBinding;
  buffer: string;
  onKey: (key: KioskKey) => void;
  students: readonly KioskStudent[];
  last4Index: Readonly<Record<string, string[]>>;
  presentIds: ReadonlySet<string>;
  onPick: (student: KioskStudent) => void;
  onUnbind: () => void;
}) {
  const outcome = useMemo(
    () => searchStudents(buffer, students as KioskStudent[], last4Index),
    [buffer, students, last4Index],
  );
  const closed = windowHasClosed(binding, Date.now());

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
        <div className="text-lg font-semibold text-ink-200">{binding.title}</div>
        <div className="text-sm text-ink-500">
          {closed ? 'Check-in window has closed — you can still check in.' : 'Welcome! Check in below.'}
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

      {/* Results — fixed-height rows inside a fixed region. */}
      <div className="min-h-0 overflow-hidden px-6">
        <div className="mx-auto flex h-full max-w-2xl flex-col gap-2">
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
            return (
              <button
                key={student.id}
                type="button"
                tabIndex={-1}
                onPointerDown={(event) => {
                  event.preventDefault();
                  onPick(student);
                }}
                className={`flex h-16 shrink-0 items-center justify-between rounded-xl px-5 text-left ${
                  present ? 'bg-present-600/20' : 'bg-ink-900 active:bg-ink-700'
                }`}
              >
                <span className="truncate text-xl font-semibold text-ink-100">
                  {student.firstName} {student.lastName}
                </span>
                <span className="pl-3 text-base whitespace-nowrap text-ink-400">
                  {present ? <span className="font-semibold text-present-400">✓ Checked in</span> : gradeLabel(student.grade)}
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
