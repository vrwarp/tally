/**
 * The ledger: what has been released from this gathering, kept visible.
 *
 * Locked, not hidden — the same rule the chooser applies to a gathering you
 * are not on. A call list that is nine rows shorter with no explanation reads
 * as good news, and the person reading it in March may not be the person who
 * pressed the button in September; this strip is the successor's answer, and
 * the undo's home once the session that made the release is gone.
 *
 * It renders whenever there is anything to say, *including when the MIA list
 * above it is empty*: months on, the cohort fragments — somebody deactivates a
 * student from their page, the window retires the rest — and "the tab is
 * clean" must never be the only record.
 *
 * A release the student's own attendance has stood down is shown *as* stood
 * down rather than dropped: a strip that said "9 no longer expected" while one
 * of them has been attending since December would be lying to the reader the
 * ledger exists for.
 *
 * Systematically incomplete by nature (the drip caught late, rows aged out
 * before anyone acted) — which is why no report is ever built on it.
 */
import { useState } from 'react';
import { Button } from '@/components/ui';
import { formatShortDate } from '@/lib/time';
import { TRANSITION_REASON_LABEL, type Transition } from '@/types';

export interface LedgerRow {
  transition: Transition;
  /** Resolved by the caller — the record holds an id, the roster holds names. */
  studentName: string;
  /** Which gathering, for the merged view; null hides it. */
  gatheringTitle: string | null;
  /** Attendance at or after the release has stood it down. */
  inert: boolean;
}

export interface TransitionLedgerProps {
  /** Scope-filtered by the caller. Nothing renders when empty. */
  rows: readonly LedgerRow[];
  showGathering: boolean;
  onUndo: (transition: Transition) => void;
  /** The transition an undo is in flight for, if any. */
  undoBusyId: string | null;
}

export function TransitionLedger({ rows, showGathering, onUndo, undoBusyId }: TransitionLedgerProps) {
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  const sorted = [...rows].sort(
    (a, b) => b.transition.releasedAt.getTime() - a.transition.releasedAt.getTime(),
  );
  const latest = sorted[0]!.transition.releasedAt;

  return (
    <section className="rounded-2xl bg-ink-900/60 ring-1 ring-ink-800">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm text-ink-400 hover:text-ink-200"
      >
        <span aria-hidden="true" className="w-3 text-xs">
          {open ? '▾' : '▸'}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {rows.length} no longer expected{showGathering ? '' : ' here'} · latest{' '}
          {formatShortDate(latest)}
        </span>
      </button>

      {open ? (
        <ul className="divide-y divide-ink-800 border-t border-ink-800">
          {sorted.map(({ transition, studentName, gatheringTitle, inert }) => (
            <li
              key={transition.id}
              className={
                'flex items-center gap-3 px-3 py-2 ' + (inert ? 'opacity-60' : '')
              }
            >
              {/*
                One line where there is a pointer, two where there is a thumb.

                This was the phone's row at 1440 as well: a name, then a wrapped
                sentence, then 325px of nothing before Undo — 45% of the row,
                ten rows running, pushing the attendance trend off the fold on
                the very screen somebody opens the ledger to read. Folded up, the
                name takes a fixed column at `lg` so the dates line up under each
                other and the one release that is not part of the batch can be
                found by running down an edge rather than by reading ten
                sentences. 15rem, because the column has to hold the longest
                real pair — a name and the gathering beside it on the pooled
                tab — and at 13 it clipped "Malik Johnson · Sunday Ki…".
              */}
              <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
                <p className="truncate text-sm font-semibold text-ink-100 sm:shrink-0 lg:w-60">
                  {studentName}
                  {showGathering && gatheringTitle ? (
                    <span className="font-normal text-ink-400"> · {gatheringTitle}</span>
                  ) : null}
                </p>
                <p className="min-w-0 text-xs text-ink-500 sm:flex-1">
                  {/* What differs, first and in its own ink. Nine of these rows
                      are one batch — same reason, same person, same day — so
                      reason-first the line was texture rather than information,
                      and the row that mattered was buried at the tail of the
                      sentence every other row also had. */}
                  <span className="tabular-nums text-ink-400">
                    {formatShortDate(transition.releasedAt)}
                  </span>{' '}
                  · {TRANSITION_REASON_LABEL[transition.reason]}
                  {transition.note ? ` — “${transition.note}”` : ''}
                  {/* Bound to its separator: wrapping left the middot hanging
                      alone at the right margin on every row of the phone. */}
                  <span className="whitespace-nowrap"> · {transition.releasedByName}</span>
                  {inert ? (
                    // Their own attendance outranks the record, and the strip
                    // says so rather than quietly dropping the row.
                    <span className="whitespace-nowrap text-present-400">
                      {' '}
                      · back since — no longer in effect
                    </span>
                  ) : null}
                </p>
              </div>
              {/* The same material as "Resolve…" on the rows above and "Undo"
                  on a released row: one setting of "quiet but pressable" on a
                  screen that had four. An un-ringed ghost here read brighter
                  than the ringed act it reverses while being less
                  button-shaped than it. */}
              <Button
                variant="ghost"
                size="md"
                className="shrink-0 text-ink-400 ring-1 ring-ink-700 hover:text-ink-100"
                onClick={() => onUndo(transition)}
                loading={undoBusyId === transition.id}
              >
                Undo
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
