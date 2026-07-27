/**
 * One tappable student on the check-in roster.
 *
 * The entire row is a single button because this is operated one-handed while
 * looking at a queue of students, not at the screen. Nothing inside it competes
 * for the tap — secondary actions belong on the student detail screen.
 */
import { WarningBadge } from '@/components/ui';
import { formatClock } from '@/lib/time';
import { cn, initials, ordinalGrade } from '@/lib/utils';
import { studentFullName, type RosterEntry } from '@/types';

export interface StudentRowProps {
  entry: RosterEntry;
  onPress: (entry: RosterEntry) => void;
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
}

export function StudentRow({
  entry,
  onPress,
  flashing = false,
  busy = false,
  showRecentHint = false,
}: StudentRowProps) {
  const { student, attendance, warnings, isRecent, recentHits, recentWindow } = entry;
  const name = studentFullName(student);
  const grade = ordinalGrade(student.grade);
  const showHint = showRecentHint && isRecent && recentWindow > 0;

  const label = attendance
    ? `Undo check-in for ${name}, ${grade} grade, checked in at ${formatClock(attendance.checkedInAt)}`
    : `Check in ${name}, ${grade} grade`;

  return (
    <li>
      <button
        type="button"
        onClick={() => onPress(entry)}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={label}
        className={cn(
          'flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 transition-colors',
          'disabled:opacity-60',
          attendance
            ? 'bg-present-500/10 ring-present-500/30 active:bg-present-500/20'
            : 'bg-ink-900 ring-ink-800 active:bg-ink-800',
          flashing && 'animate-flash',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            attendance ? 'bg-present-500/20 text-present-400' : 'bg-ink-800 text-ink-300',
          )}
        >
          {initials(student.firstName, student.lastName)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-base font-semibold text-ink-50">{name}</span>
            <span className="shrink-0 text-xs font-medium text-ink-500">{grade}</span>
          </span>

          {warnings.length > 0 || showHint ? (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {warnings.map((warning) => (
                <WarningBadge key={warning} warning={warning} />
              ))}
              {showHint ? (
                <span
                  className="text-[11px] font-medium tabular-nums text-ink-500"
                  title={`Attended ${recentHits} of the last ${recentWindow}`}
                >
                  {recentHits} of {recentWindow}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>

        {attendance ? (
          <span className="flex shrink-0 flex-col items-end gap-0.5" aria-hidden="true">
            <span className="text-xl leading-none text-present-400">✓</span>
            <span className="text-[11px] tabular-nums text-ink-500">
              {formatClock(attendance.checkedInAt)}
            </span>
          </span>
        ) : (
          <span aria-hidden="true" className="size-6 shrink-0 rounded-full ring-2 ring-ink-700" />
        )}
      </button>
    </li>
  );
}
