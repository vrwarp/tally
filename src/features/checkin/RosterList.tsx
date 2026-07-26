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
import { StudentRow } from '@/features/checkin/StudentRow';
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
  flashing: ReadonlySet<string>;
  busy: ReadonlySet<string>;
}

export function RosterList({
  title,
  entries,
  description,
  emptyLabel = 'Nobody matches these filters.',
  tone = 'default',
  showRecentHint = false,
  onPress,
  flashing,
  busy,
}: RosterListProps) {
  return (
    <section className="px-3 pb-3" aria-label={`${title}, ${entries.length}`}>
      <h2
        style={{ top: 'calc(var(--app-header-h, 0px) + var(--checkin-search-h, 0px))' }}
        className="sticky z-10 -mx-3 flex items-baseline gap-2 bg-ink-950/95 px-3 py-2 text-xs font-bold uppercase tracking-wider backdrop-blur"
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
        <p className="px-1 py-3 text-sm text-ink-500">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <StudentRow
              key={entry.student.id}
              entry={entry}
              onPress={onPress}
              flashing={flashing.has(entry.student.id)}
              busy={busy.has(entry.student.id)}
              showRecentHint={showRecentHint}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
