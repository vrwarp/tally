/**
 * The filter row above the check-in roster.
 *
 * Everything here narrows one list rather than rearranging several. The order
 * is by reach: the two filters a counselor toggles mid-queue come first, then
 * grades.
 *
 * It all lives on one horizontally scrolling row. Two stacked rows of controls
 * would push the first student below the fold on a phone, which defeats the
 * point of the screen — which is also why the seven grades collapsed into a
 * single dropdown chip.
 */
import type { ReactNode } from 'react';
import { GradeFilter } from '@/features/checkin/GradeFilter';
import type { RosterFocus } from '@/features/roster/predictiveRoster';
import { cn } from '@/lib/utils';
import type { Grade } from '@/types';

export interface FilterBarProps {
  grades: readonly Grade[];
  onGradesChange: (grades: readonly Grade[]) => void;
  /** The focus the roster actually applied, not the one that was asked for. */
  focus: RosterFocus;
  onFocusChange: (focus: RosterFocus) => void;
  /** False when the prediction has nothing to offer, or a search is running. */
  showRecent: boolean;
  /** How many students the prediction expects, for the Recent chip's count. */
  recentCount: number;
  present: number;
}

function Chip({
  active,
  label,
  onPress,
  children,
}: {
  active: boolean;
  label?: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold ring-1 transition-colors pointer-fine:min-h-9',
        active
          ? 'bg-brand-500/20 text-brand-200 ring-brand-500/40'
          : 'bg-ink-900 text-ink-400 ring-ink-800 active:bg-ink-800',
      )}
    >
      {children}
    </button>
  );
}

/** The count that makes a filter chip worth reading before it is pressed. */
function Tally({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        active ? 'bg-brand-500/25 text-brand-100' : 'bg-ink-800 text-ink-400',
      )}
    >
      {children}
    </span>
  );
}

export function FilterBar({
  grades,
  onGradesChange,
  focus,
  onFocusChange,
  showRecent,
  recentCount,
  present,
}: FilterBarProps) {
  // Pressing the chip that is already on means "stop filtering", the same way
  // the grade checklist clears back to All grades.
  const setFocus = (next: RosterFocus) => onFocusChange(focus === next ? 'all' : next);

  return (
    <div className="pb-2">
      {/* The grade chip sits *outside* the scroller on purpose. Its dropdown is
          absolutely positioned, and `overflow-x-auto` clips in both axes — the
          panel would open into a hidden strip. */}
      <div className="flex items-center gap-1.5 px-3">
        <div className="scroll-touch flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          <div role="group" aria-label="Show" className="flex shrink-0 items-center gap-1.5">
            {showRecent ? (
              <Chip
                active={focus === 'recent'}
                label="Show likely regulars only"
                onPress={() => setFocus('recent')}
              >
                Recent
                <Tally active={focus === 'recent'}>{recentCount}</Tally>
              </Chip>
            ) : null}
            <Chip
              active={focus === 'checkedIn'}
              label="Show checked-in students only"
              onPress={() => setFocus('checkedIn')}
            >
              Checked in
              <Tally active={focus === 'checkedIn'}>{present}</Tally>
            </Chip>
          </div>
        </div>

        <GradeFilter grades={grades} onChange={onGradesChange} />
      </div>
    </div>
  );
}
