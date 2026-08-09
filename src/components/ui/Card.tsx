import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl bg-ink-900 ring-1 ring-ink-800', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  count,
  description,
  descriptionClassName,
  action,
  columns,
  columnLabel,
}: {
  title: string;
  count?: number;
  description?: string;
  /** Overrides the description's own classes, for a card that ranks it differently. */
  descriptionClassName?: string;
  action?: ReactNode;
  /**
   * The grid template of the rows below, when this card's list is a table.
   *
   * A table wants its columns labelled, and the alternative — a label row
   * between the header and the first row — puts a second stripe under the
   * title for one word. Sharing the rows' template lets the band that already
   * exists carry the label, on the column's own edge. Container-query classes,
   * so the card decides by its own width; see `TeamPage`.
   */
  columns?: string;
  /** The label for the second column. Only rendered when `columns` is given. */
  columnLabel?: string;
}) {
  /*
   * The action leaves the title's line below `sm`, and that is not cosmetic.
   *
   * A card header used to be a title beside at most one button, and the row
   * held. Give it two and, at 390px, the buttons claim two thirds of the width
   * before the heading gets any: "Missing in action" came apart into a
   * three-line ragged stack with its count badge orphaned mid-heading, the
   * description broke into seven fragments of three words, and the header grew
   * to 231px — enough to push every call row on the screen below the fold, on
   * the one screen whose whole job is the call rows.
   *
   * So the title is served first and the actions take their own line under it
   * when there is no room. Above `sm` nothing changes: there is width for both
   * and the header stays the calm object it was.
   */
  return (
    <header
      className={cn(
        'flex border-b border-ink-800 px-4 py-3',
        // A table header keeps its row. `columns` cards label a grid and carry
        // no action — see `TeamPage` — so there is nothing there to stack, and
        // stacking would fight the template.
        columns
          ? `items-start justify-between gap-3 @2xl:grid @2xl:items-end @2xl:gap-4 ${columns}`
          : 'flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3',
      )}
    >
      {/* A minimum of one target's height, so a card whose header carries a
          second line and one whose header does not still agree on their band. */}
      <div className="flex min-h-11 min-w-0 flex-col justify-center">
        <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink-100">
          {title}
          {count !== undefined ? (
            <span className="rounded-full bg-ink-800 px-2 py-0.5 text-xs font-semibold text-ink-300">
              {count}
            </span>
          ) : null}
        </h2>
        {description ? (
          <p className={cn('mt-0.5 text-sm text-ink-500', descriptionClassName)}>{description}</p>
        ) : null}
      </div>
      {columns && columnLabel ? (
        <p className="hidden text-xs text-ink-500 @2xl:block">{columnLabel}</p>
      ) : null}
      {/* Its own line below `sm`, so a wrapping action never squeezes the
          heading; `shrink-0` keeps it whole beside the title above `sm`. */}
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

/**
 * One number in the row of four at the top of Insights.
 *
 * `tone` colours the *numeral*, not the tile. It used to wash the whole field,
 * and three of the four tiles carry a tone — so three quarters of the row was
 * accented and the accent had stopped being a signal: the good news (two new
 * faces, green) shouted exactly as loudly as the thing that put the leader on
 * this screen (ten missing, red), and the eye landed by default on the one
 * neutral tile, which is the one fact that requires no action.
 *
 * `emphasis` is the tinted field, and exactly one tile in the row should carry
 * it: the one that is a call to action. Nothing is lost by moving the rest onto
 * the numeral — green still means new, amber still means unreachable.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  emphasis = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'warn' | 'danger' | 'success';
  /** Wash the whole tile in `tone`. At most one tile in a row. */
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl px-4 py-3 ring-1',
        (!emphasis || tone === 'neutral') && 'bg-ink-900 ring-ink-800',
        emphasis && tone === 'success' && 'bg-present-500/10 ring-present-500/25',
        emphasis && tone === 'warn' && 'bg-warn-500/10 ring-warn-500/25',
        emphasis && tone === 'danger' && 'bg-danger-500/10 ring-danger-500/25',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'neutral' && 'text-ink-50',
          tone === 'success' && 'text-present-400',
          tone === 'warn' && 'text-warn-400',
          tone === 'danger' && 'text-danger-400',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
