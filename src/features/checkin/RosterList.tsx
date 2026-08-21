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
 *
 * One column on a phone, two on a laptop. A 704px line holding one name, with
 * ~450px of empty row between the name and the check mark, put 8 or 9 students
 * on a 1440×900 screen out of a roster of 49 — a leader back-filling a register
 * scrolled for every one of them. The second column is worth 16 to 18 names
 * above the fold and costs nothing that matters: a check-in still only
 * recolours the cell it is standing in.
 */
import { memo, useCallback, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
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
  /**
   * A handle on the `<ul>`, so the search box can hand the keyboard over to the
   * first row. See `CheckInPage`.
   */
  listRef?: RefObject<HTMLUListElement | null>;
  /**
   * Escape, pressed on a row. The screen puts the caret back in the search box
   * — the only place a keyboard has anything else to do.
   */
  onLeave?: () => void;
}

const NO_NOTES: ReadonlyMap<string, string> = new Map();

/** The rows a keyboard can actually reach, in the order the list prints them. */
function focusableRows(list: HTMLUListElement): HTMLButtonElement[] {
  return Array.from(list.querySelectorAll<HTMLButtonElement>('[data-roster-row]:not(:disabled)'));
}

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
  listRef,
  onLeave,
}: RosterListProps) {
  /*
   * The list walk.
   *
   * Nothing here is reachable without a keyboard, which is why it is not gated
   * on a breakpoint: a thumb has no arrow keys, and a laptop had no route from
   * a typed name to a check-in that did not go through the mouse and back. Up
   * and down step through the list in the order it is printed — which, in the
   * two-column layout, is A–Z down the first column and then A–Z down the
   * second, the same order the eye reads. Enter is the browser's, because a row
   * is a real button. Escape hands the keyboard back to the search box.
   *
   * Rows the screen has disabled — the check-in being moved, somebody already
   * here while the picker is open — are skipped rather than focused and
   * refused.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      const { key } = event;
      if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End' && key !== 'Escape') {
        return;
      }

      const rows = focusableRows(event.currentTarget);
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      // Focus is on the check mark, or inside an open actions strip. Those are
      // Tab's business, and stealing their arrow keys would be a surprise.
      if (at === -1) return;

      if (key === 'Escape') {
        if (!onLeave) return;
        event.preventDefault();
        // The screen's own Escape handler leaves the picker. From inside the
        // list, Escape means "back to the box" — leaving is the next press.
        event.stopPropagation();
        onLeave();
        return;
      }

      const next =
        key === 'ArrowDown'
          ? Math.min(at + 1, rows.length - 1)
          : key === 'ArrowUp'
            ? Math.max(at - 1, 0)
            : key === 'Home'
              ? 0
              : rows.length - 1;

      if (next === at) return;
      event.preventDefault();
      rows[next]?.focus();
    },
    [onLeave],
  );

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
        /* The hairline is for the first row's ring, which is painted outside its
           card and therefore in the last pixel of the heading above it — and the
           heading is a near-opaque sticky band, so it covered it. Every row but
           the first drew a whole outline and the one at the top of the list drew
           three sides of one. */
        /*
          Two columns at `lg`, filled downwards.

          `grid-auto-flow: column` against an explicit row count, rather than
          CSS multi-column: A–Z has to read top-to-bottom within a column, and a
          quick-added visitor arriving mid-list has to reflow predictably rather
          than re-balancing two boxes of text. The row count is the only part a
          stylesheet cannot know, so it comes in as a custom property.

          `lg:items-start` keeps a row that opens its actions strip from
          stretching the card beside it — the taller track is the whole cost of
          the second column, and it should be paid by one cell, not two.
        */
        <ul
          ref={listRef}
          onKeyDown={onKeyDown}
          style={{ '--roster-rows': String(Math.ceil(entries.length / 2)) } as CSSProperties}
          className={
            'flex flex-col gap-2 pt-px lg:grid lg:grid-flow-col lg:grid-cols-2 lg:items-start ' +
            'lg:[grid-template-rows:repeat(var(--roster-rows),auto)]'
          }
        >
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
