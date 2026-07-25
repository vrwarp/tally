/**
 * Roster scoping for Journey 2 (Sunday School).
 *
 * A small-group leader wants their nine students, not the whole ministry — and
 * the thing they actually came for is the *absence* list, so the counts line
 * leads with who is still missing rather than who is present.
 *
 * Groups and grades share one horizontally scrolling row. Two stacked rows of
 * chips would push the first student below the fold on a phone, which defeats
 * the point of the screen.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { GRADES, type Grade, type SmallGroup } from '@/types';

export interface ScopeBarProps {
  groups: readonly SmallGroup[];
  scopeGroupId: string | null;
  onScopeChange: (groupId: string | null) => void;
  grade: Grade | null;
  onGradeChange: (grade: Grade | null) => void;
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
        'min-h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold ring-1 transition-colors',
        active
          ? 'bg-brand-500/20 text-brand-200 ring-brand-500/40'
          : 'bg-ink-900 text-ink-400 ring-ink-800 active:bg-ink-800',
      )}
    >
      {children}
    </button>
  );
}

export function ScopeBar({
  groups,
  scopeGroupId,
  onScopeChange,
  grade,
  onGradeChange,
  assignedGroupId,
  present,
  eligible,
  absent,
}: ScopeBarProps) {
  const group = groups.find((candidate) => candidate.id === scopeGroupId) ?? null;

  return (
    <div className="pb-2">
      <div className="scroll-touch flex items-center gap-1.5 overflow-x-auto px-3">
        {groups.length > 0 ? (
          <div role="group" aria-label="Small group" className="flex shrink-0 items-center gap-1.5">
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
                  <span aria-hidden="true" className="ml-1 text-brand-300">
                    ★
                  </span>
                ) : null}
              </Chip>
            ))}
            <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-ink-800" />
          </div>
        ) : null}

        {/* Grade narrowing only makes sense across the whole roster; inside a
            nine-person small group it would filter a list that already fits. */}
        {group ? null : (
          <div role="group" aria-label="Grade" className="flex shrink-0 items-center gap-1.5">
            <Chip active={grade === null} label="All grades" onPress={() => onGradeChange(null)}>
              All grades
            </Chip>
            {GRADES.map((value) => (
              <Chip
                key={value}
                active={grade === value}
                label={`Grade ${value}`}
                onPress={() => onGradeChange(grade === value ? null : value)}
              >
                {value}
              </Chip>
            ))}
          </div>
        )}
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
