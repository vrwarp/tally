/**
 * The check-in window — the one field on the event form that is almost always
 * already right.
 *
 * Split out of `EventEditorModal` so the disclosure has somewhere to be tested
 * without dragging the whole editor (and Firebase with it) into jsdom.
 */
import { useId, useState } from 'react';
import { TextField } from '@/components/ui';
import { formatClock, formatShortDate, fromDateTimeLocalValue } from '@/lib/time';
import { cn } from '@/lib/utils';

function parseLocal(value: string): Date | null {
  try {
    return fromDateTimeLocalValue(value);
  } catch {
    return null;
  }
}

/** "11:00 PM", or "Jul 25, 11:00 PM" once it leaves the day of the event. */
function describeBound(value: string, sameDayAs: string): string {
  const at = parseLocal(value);
  if (!at) return '—';
  // Both are `datetime-local` strings, so the date halves compare directly.
  const sameDay = value.slice(0, 10) === sameDayAs.slice(0, 10);
  return sameDay ? formatClock(at) : `${formatShortDate(at)}, ${formatClock(at)}`;
}

/**
 * The check-in window, folded away.
 *
 * This is the most expensive block on the form and the least often touched: it
 * defaults to an hour either side and follows the event's times unless somebody
 * has deliberately pinned it, so on the overwhelming majority of events the
 * right answer is already in it. Two datetime pickers plus a paragraph
 * explaining what they do is a large thing to make every leader scroll past to
 * reach Location.
 *
 * Collapsed, it still *states* the answer — the summary is the two times, not a
 * label — so nothing is hidden, only the controls for changing it. It opens
 * itself when a validation error lands inside, because an error behind a
 * disclosure is an error nobody can fix.
 */
export function CheckInWindowField({
  opens,
  closes,
  start,
  pinned,
  errors,
  onOpensChange,
  onClosesChange,
}: {
  opens: string;
  closes: string;
  start: string;
  pinned: boolean;
  errors: { checkInOpens?: string; checkInCloses?: string };
  onOpensChange: (value: string) => void;
  onClosesChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const invalid = Boolean(errors.checkInOpens || errors.checkInCloses);
  const open = expanded || invalid;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl bg-ink-950/40 ring-1 ring-ink-800',
        invalid && 'ring-danger-500',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-ink-900/40 pointer-fine:py-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold uppercase tracking-wider text-ink-400">
            Check-in window
            {pinned ? <span className="ml-2 font-medium normal-case text-ink-500">custom</span> : null}
          </span>
          <span className="mt-0.5 block truncate text-sm text-ink-200">
            Opens {describeBound(opens, start)}, closes {describeBound(closes, start)}
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs font-semibold text-brand-300">
          {open ? 'Hide' : 'Adjust'}
        </span>
      </button>

      {open ? (
        <div id={panelId} className="@container flex flex-col gap-3 border-t border-ink-800 px-3 py-3">
          <p className="text-xs leading-snug text-ink-500">
            Tally opens this event automatically while the window is open. It defaults to an hour
            either side and follows the event’s times until you change it here.
          </p>
          <div className="grid gap-3 @min-[30rem]:grid-cols-2">
            <TextField
              label="Opens"
              type="datetime-local"
              value={opens}
              onChange={(changed) => onOpensChange(changed.target.value)}
              error={errors.checkInOpens ?? null}
            />
            <TextField
              label="Closes"
              type="datetime-local"
              value={closes}
              onChange={(changed) => onClosesChange(changed.target.value)}
              error={errors.checkInCloses ?? null}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
