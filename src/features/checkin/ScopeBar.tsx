/**
 * The filter row above the check-in roster.
 *
 * Everything here narrows one list rather than rearranging several. The order
 * is by reach: the two filters a counselor toggles mid-queue come first, then
 * the small-group scope for Journey 2 (Sunday School), then grades.
 *
 * It all lives on one horizontally scrolling row. Two stacked rows of controls
 * would push the first student below the fold on a phone, which defeats the
 * point of the screen — which is also why the seven grades collapsed into a
 * single dropdown chip.
 *
 * A small-group leader wants their nine students, not the whole ministry — and
 * the thing they actually came for is the *absence* list, so the counts line
 * under a scoped roster leads with who is still missing.
 */
import type { ReactNode } from 'react';
import { GradeFilter } from '@/features/checkin/GradeFilter';
import type { RosterFocus } from '@/features/roster/predictiveRoster';
import { cn } from '@/lib/utils';
import type { Grade, SmallGroup } from '@/types';

export interface ScopeBarProps {
  groups: readonly SmallGroup[];
  scopeGroupId: string | null;
  onScopeChange: (groupId: string | null) => void;
  grades: readonly Grade[];
  onGradesChange: (grades: readonly Grade[]) => void;
  /** The focus the roster actually applied, not the one that was asked for. */
  focus: RosterFocus;
  onFocusChange: (focus: RosterFocus) => void;
  /** False when the prediction has nothing to offer, or a search is running. */
  showRecent: boolean;
  /** How many students the prediction expects, for the Recent chip's count. */
  recentCount: number;
  /** The counselor's own group, so it can be marked as theirs. */
  assignedGroupId: string | null;
  present: number;
  eligible: number;
  absent: number;
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
        'flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold ring-1 transition-colors',
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

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-ink-800" />;
}

export function ScopeBar({
  groups,
  scopeGroupId,
  onScopeChange,
  grades,
  onGradesChange,
  focus,
  onFocusChange,
  showRecent,
  recentCount,
  assignedGroupId,
  present,
  eligible,
  absent,
}: ScopeBarProps) {
  const group = groups.find((candidate) => candidate.id === scopeGroupId) ?? null;

  // Pressing the chip that is already on means "stop filtering", the same way
  // the grade checklist clears back to All grades.
  const setFocus = (next: RosterFocus) => onFocusChange(focus === next ? 'all' : next);

  return (
    <div className="pb-2">
      {/* The grade chip sits *outside* the scroller on purpose. Its dropdown is
          absolutely positioned, and `overflow-x-auto` clips in both axes — the
          panel would open into a hidden strip. Pinning it also keeps it
          reachable without scrolling a row of small groups out of the way. */}
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

          {groups.length > 0 ? (
            <div
              role="group"
              aria-label="Small group"
              className="flex shrink-0 items-center gap-1.5"
            >
              <Divider />
              <Chip
                active={scopeGroupId === null}
                label="Show everyone"
                onPress={() => onScopeChange(null)}
              >
                Everyone
              </Chip>
              {groups.map((candidate) => (
                <Chip
                  key={candidate.id}
                  active={candidate.id === scopeGroupId}
                  onPress={() => onScopeChange(candidate.id)}
                >
                  {candidate.name}
                  {candidate.id === assignedGroupId ? (
                    <span aria-hidden="true" className="text-brand-300">
                      ★
                    </span>
                  ) : null}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>

        {/* Grade narrowing only makes sense across the whole roster; inside a
            nine-person small group it would filter a list that already fits. */}
        {group ? null : <GradeFilter grades={grades} onChange={onGradesChange} />}
      </div>

      {group ? (
        <p className="px-3 pt-2 text-xs text-ink-400">
          Showing <span className="font-semibold text-ink-100">{group.name}</span>
          {group.id === assignedGroupId ? <span className="text-ink-500"> (your group)</span> : null}
          {' · '}
          <span className="tabular-nums">
            {present} of {eligible} present
          </span>
          {absent > 0 ? (
            <>
              {' — '}
              <span className="font-semibold tabular-nums text-warn-400">
                {absent} not here yet
              </span>
            </>
          ) : eligible > 0 ? (
            <span className="font-semibold text-present-400"> — everyone is here</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
