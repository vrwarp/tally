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
  /**
   * False when nobody has been here before, when everybody has, and — because
   * only two chips fit on a phone — whenever Recent is holding the slot and the
   * roster is not currently focused here. See `CheckInPage`.
   */
  showParticipated: boolean;
  /** How many students have been to this gathering before. */
  participatedCount: number;
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
          // Hover, because these are the same chips the Students toolbar draws
          // and a pointer gets a response there.
          : 'bg-ink-900 text-ink-400 ring-ink-800 hover:bg-ink-800 active:bg-ink-800',
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
  showParticipated,
  participatedCount,
  present,
}: FilterBarProps) {
  // Pressing the chip that is already on means "stop filtering", the same way
  // the grade checklist clears back to All grades. Deliberately all the way to
  // the whole roster rather than one rung down the Recent → Participated → all
  // ladder: a chip that is on says what it is hiding, and turning it off should
  // show that, not something else it was also hiding.
  const setFocus = (next: RosterFocus) => onFocusChange(focus === next ? 'all' : next);

  return (
    <div className="pb-2">
      {/* The grade chip sits *outside* the scroller on purpose. Its dropdown is
          absolutely positioned, and `overflow-x-auto` clips in both axes — the
          panel would open into a hidden strip. */}
      <div className="flex items-center gap-1.5">
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
            {/* One rung wider than Recent: everyone this gathering has seen,
                rather than only the ones tonight is expecting. It is what the
                roster falls back to when the prediction stands down, so the
                chip has to be here to be turned off again. */}
            {showParticipated ? (
              <Chip
                active={focus === 'participated'}
                label="Show only students who have been here before"
                onPress={() => setFocus('participated')}
              >
                Participated
                <Tally active={focus === 'participated'}>{participatedCount}</Tally>
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
