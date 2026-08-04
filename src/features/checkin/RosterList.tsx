/**
 * The check-in roster: one list, and only ever one.
 *
 * It used to be three blocks — Recent, Everyone else, Checked in — and a tap
 * moved a student from one to another. That reads well on a screenshot and
 * badly on a Friday: the row a counselor just pressed jumps to a different part
 * of the screen, and with two phones checking the same queue in, the list
 * reorders under a thumb that is already on its way down. Now the filters
 * change what the list holds and a tap changes only the colour of one row.
 *
 * The heading sticks below the search box — which is itself stuck below the app
 * bar — so a counselor halfway down a 200-name list still knows which filter
 * they are looking through. Both offsets are measured at runtime and published
 * as custom properties; see `useHeightVar`.
 */
import { memo } from 'react';
import { StudentRow, type StudentRowMode } from '@/features/checkin/StudentRow';
import { cn } from '@/lib/utils';
import type { RosterEntry } from '@/types';

export interface RosterListProps {
  title: string;
  entries: readonly RosterEntry[];
  /** Small right-aligned note, e.g. what the prediction was based on. */
  description?: string;
  /** Rendered instead of rows when `entries` is empty. */
  emptyLabel?: string;
  tone?: 'default' | 'present';
  /** Show the "2 of 3" prediction hint on the rows the prediction picked out. */
  showRecentHint?: boolean;
  onPress: (entry: RosterEntry) => void;
  /** The check mark on a checked-in row, and `Undo` in its action strip. */
  onUndo?: (entry: RosterEntry) => void;
  /** `Wrong person` — hands this check-in to the picker. */
  onSwap?: (entry: RosterEntry) => void;
  /** Records a pickup, and puts one back. See `StudentRow`. */
  onCheckOut?: (entry: RosterEntry) => void;
  onUndoCheckOut?: (entry: RosterEntry) => void;
  /** Whether this gathering tracks check-out at all. */
  tracksCheckOut?: boolean;
  /** What a tap means right now. See `StudentRowMode`. */
  mode?: StudentRowMode;
  /** In `swap` mode, the student whose check-in is being moved. */
  swapSourceId?: string | null;
  /**
   * The one row whose action strip is open, if any. One at a time screen-wide:
   * a column of open strips would push the queue off the bottom of the phone.
   */
  expandedId?: string | null;
  /** Whether rows may offer `Profile`. Core team only — see `StudentRow`. */
  canOpenProfile?: boolean;
  flashing: ReadonlySet<string>;
  busy: ReadonlySet<string>;
  /**
   * Student id -> what their allergy actually is, for the rows that have one.
   * Fills in a beat after the names do; see `useAllergyNotes`.
   */
  allergyNotes?: ReadonlyMap<string, string>;
}

const NO_NOTES: ReadonlyMap<string, string> = new Map();

/*
 * Memoised because the screen above it re-renders on a 30-second clock (the
 * event header's temporal awareness) and on every tap, while this — the several
 * hundred DOM nodes of the roster itself — usually has nothing new to say. Every
 * prop is identity-stable across those renders, so the shallow compare is
 * enough; when a tap changes the `flashing` or `busy` set, the list re-renders
 * and the per-row memo on `StudentRow` narrows the repaint to the row that
 * changed.
 */
export const RosterList = memo(function RosterList({
  title,
  entries,
  description,
  emptyLabel = 'Nobody matches these filters.',
  tone = 'default',
  showRecentHint = false,
  onPress,
  onUndo,
  onSwap,
  onCheckOut,
  onUndoCheckOut,
  tracksCheckOut = false,
  mode = 'checkin',
  swapSourceId = null,
  expandedId = null,
  canOpenProfile = false,
  flashing,
  busy,
  allergyNotes = NO_NOTES,
}: RosterListProps) {
  return (
    <section className="pb-3" aria-label={`${title}, ${entries.length}`}>
      {/* `px-3` matches a row's own inner padding, not the page's gutter — that
          is the page's job now — so the heading's words sit over the names
          below them rather than 12px to their left. */}
      <h2
        style={{ top: 'calc(var(--app-header-h, 0px) + var(--checkin-search-h, 0px))' }}
        className="sticky z-10 flex items-baseline gap-2 bg-ink-950/95 px-3 py-2 text-xs font-bold uppercase tracking-wider backdrop-blur"
      >
        <span className={tone === 'present' ? 'text-present-400' : 'text-ink-400'}>{title}</span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
            tone === 'present' ? 'bg-present-500/15 text-present-400' : 'bg-ink-800 text-ink-300',
          )}
        >
          {entries.length}
        </span>
        {description ? (
          <span className="ml-auto truncate text-[11px] font-medium normal-case tracking-normal text-ink-500">
            {description}
          </span>
        ) : null}
      </h2>

      {entries.length === 0 ? (
        <p className="px-3 py-3 text-sm text-ink-500">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <StudentRow
              key={entry.student.id}
              entry={entry}
              onPress={onPress}
              onUndo={onUndo}
              onSwap={onSwap}
              onCheckOut={onCheckOut}
              onUndoCheckOut={onUndoCheckOut}
              tracksCheckOut={tracksCheckOut}
              mode={mode}
              isSwapSource={entry.student.id === swapSourceId}
              expanded={entry.student.id === expandedId}
              canOpenProfile={canOpenProfile}
              flashing={flashing.has(entry.student.id)}
              busy={busy.has(entry.student.id)}
              showRecentHint={showRecentHint}
              allergyNote={allergyNotes.get(entry.student.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
});
