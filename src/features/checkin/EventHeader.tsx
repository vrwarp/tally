/**
 * Which event am I checking students into, and how many are here?
 *
 * The "Auto-selected" / "Viewing past event" distinction is the most important
 * thing on this bar. Tally picks the event by the clock, so the only way a
 * counselor ends up somewhere unexpected is by overriding it — and silently
 * checking forty students into last Friday is the worst failure this app has.
 */
import { useNavigate } from 'react-router-dom';
import { Badge, EventIcon } from '@/components/ui';
import { formatEventDay, formatEventWindow, formatShortDate, isCheckInOpen } from '@/lib/time';
import type { TallyEvent } from '@/types';

export interface EventHeaderProps {
  event: TallyEvent;
  /** What temporal awareness would have chosen, for the "back to now" escape. */
  autoEvent: TallyEvent | null;
  isOverridden: boolean;
  selectableEvents: readonly TallyEvent[];
  now: Date;
  present: number;
  eligible: number;
}

export function EventHeader({
  event,
  autoEvent,
  isOverridden,
  selectableEvents,
  now,
  present,
  eligible,
}: EventHeaderProps) {
  const navigate = useNavigate();
  const open = isCheckInOpen(event, now);

  // The picker only offers the last month plus everything upcoming, so an event
  // reached by a deep link may not be in the list — its own option must exist or
  // the select would render someone else's event as selected.
  const options = selectableEvents.some((candidate) => candidate.id === event.id)
    ? selectableEvents
    : [event, ...selectableEvents];

  return (
    <div className="pt-2">
      <div className="flex items-start gap-3 px-3">
        {/* Small, and only here: the header scrolls away, so the icon's job is
            to make "am I in the right gathering?" answerable at a glance rather
            than to decorate a screen a counselor is about to work down. */}
        <EventIcon name={event.icon} size="sm" className="mt-0.5" />

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight text-ink-50">{event.title}</h1>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {formatEventDay(event.startAt, now)} · {formatEventWindow(event)}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>

        <p className="shrink-0 text-right leading-none">
          <span aria-hidden="true" className="text-2xl font-bold tabular-nums text-present-400">
            {present}
            <span className="text-base text-ink-500">/{eligible}</span>
          </span>
          <span className="sr-only">
            {present} of {eligible} students checked in
          </span>
          <span className="mt-1 block text-[11px] uppercase tracking-wide text-ink-500">
            present
          </span>
        </p>
      </div>

      <div className="mt-2 flex items-center gap-2 px-3">
        {isOverridden ? (
          <Badge tone="warn" title="You picked this event manually">
            {event.startAt < now ? 'Viewing past event' : 'Viewing another event'}
          </Badge>
        ) : (
          <Badge tone="neutral" title="Chosen automatically from the current time">
            Auto-selected
          </Badge>
        )}

        {isOverridden && autoEvent ? (
          <button
            type="button"
            onClick={() => navigate(`/event/${autoEvent.id}`)}
            className="min-h-11 shrink-0 rounded-full px-2 text-xs font-semibold text-brand-300 active:bg-ink-800"
          >
            Back to now
          </button>
        ) : null}

        <select
          aria-label="Switch event"
          value={event.id}
          onChange={(changed) => navigate(`/event/${changed.target.value}`)}
          className="ml-auto min-h-11 max-w-[55%] shrink truncate rounded-full bg-ink-900 px-3 text-ink-200 ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          {options.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {formatShortDate(candidate.startAt)} · {candidate.title}
            </option>
          ))}
        </select>
      </div>

      {!open ? (
        <p className="mt-2 px-3 text-[11px] text-warn-400">
          Check-in window is closed — you can still record attendance.
        </p>
      ) : null}
    </div>
  );
}
