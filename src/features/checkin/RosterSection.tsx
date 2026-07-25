/**
 * One titled block of the check-in roster (Recent / Roster / Checked in).
 *
 * The heading sticks to the top of the scroll container so a counselor halfway
 * down a 200-name list always knows which block they are in.
 */
import { StudentRow } from '@/features/checkin/StudentRow';
import { cn } from '@/lib/utils';
import type { RosterEntry } from '@/types';

export interface RosterSectionProps {
  title: string;
  entries: readonly RosterEntry[];
  /** Small right-aligned note, e.g. what the prediction was based on. */
  description?: string;
  /** Rendered instead of rows when `entries` is empty. Omit to hide the block. */
  emptyLabel?: string;
  tone?: 'default' | 'present';
  showRecentHint?: boolean;
  onPress: (entry: RosterEntry) => void;
  flashing: ReadonlySet<string>;
  busy: ReadonlySet<string>;
}

export function RosterSection({
  title,
  entries,
  description,
  emptyLabel,
  tone = 'default',
  showRecentHint = false,
  onPress,
  flashing,
  busy,
}: RosterSectionProps) {
  if (entries.length === 0 && !emptyLabel) return null;

  return (
    <section className="px-3 pb-3" aria-label={`${title}, ${entries.length}`}>
      <h2 className="sticky top-0 z-10 -mx-3 flex items-baseline gap-2 bg-ink-950/95 px-3 py-2 text-xs font-bold uppercase tracking-wider backdrop-blur">
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
