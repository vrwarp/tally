/**
 * Which event am I checking students into, and how many are here?
 *
 * The date badge is the most important thing on this bar. Checking forty
 * students into last Friday is the worst failure this app has, and the event is
 * now chosen by hand rather than by the clock — so the screen has to keep
 * saying which night it is filing against, loudly, for as long as somebody is
 * tapping. "Today" is reassurance; anything else is a warning.
 */
import { Link, useNavigate } from 'react-router-dom';
import { Badge, EventIcon } from '@/components/ui';
import { formatEventDay, formatEventWindow, formatShortDate, isCheckInOpen } from '@/lib/time';
import { startOfDay } from '@/lib/time';
import type { TallyEvent } from '@/types';

export interface EventHeaderProps {
  event: TallyEvent;
  selectableEvents: readonly TallyEvent[];
  now: Date;
  present: number;
  eligible: number;
  /**
   * Checked in and not yet collected, on a gathering that tracks check-out.
   *
   * When it does, this is the number the header leads with: it is the entire
   * reason the feature exists, and the attendance total moves beside it rather
   * than away.
   */
  inRoom?: number;
  tracksCheckOut?: boolean;
}

export function EventHeader({
  event,
  selectableEvents,
  now,
  present,
  eligible,
  inRoom = 0,
  tracksCheckOut = false,
}: EventHeaderProps) {
  const navigate = useNavigate();
  const open = isCheckInOpen(event, now);
  const isToday = startOfDay(event.startAt).getTime() === startOfDay(now).getTime();

  // The picker only offers the last month plus everything upcoming, so an event
  // reached by a deep link may not be in the list — its own option must exist or
  // the select would render someone else's event as selected.
  const options = selectableEvents.some((candidate) => candidate.id === event.id)
    ? selectableEvents
    : [event, ...selectableEvents];

  return (
    <div>
      {/* The gutter is the page's, not this component's — see `BAND` in
          `CheckInPage`. Every band on the screen shares one left edge, and it
          is the same edge Insights, Events and Students start at. */}
      <div className="flex items-start gap-3">
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
            {tracksCheckOut ? inRoom : present}
            <span className="text-base text-ink-500">
              /{tracksCheckOut ? present : eligible}
            </span>
          </span>
          {/* Both numbers, always: the room count is what the volunteer is
              working from, and the head count is what the evening will be
              remembered as. A screen reader user needs the same pair. */}
          <span className="sr-only">
            {tracksCheckOut
              ? `${inRoom} of ${present} checked-in students still in the room, out of ${eligible} eligible`
              : `${present} of ${eligible} students checked in`}
          </span>
          <span className="mt-1 block text-[11px] uppercase tracking-wide text-ink-500">
            {tracksCheckOut ? 'in room' : 'present'}
          </span>
        </p>
      </div>

      {/*
        A status, then the two ways to a different gathering, grouped as such.

        The row used to run three vocabularies — a small grey capsule, a bare
        blue word with no boundary, and a large ringed select — with the two
        controls that do the same job looking least alike, and the one with no
        visible boundary being the one that navigates. The status now sits apart
        at the leading edge and the pair sits together, so proximity says what
        the styling says.
      */}
      <div className="mt-2 flex items-center gap-2">
        {isToday ? (
          <Badge tone="neutral" title="This gathering is on today">
            Today
          </Badge>
        ) : (
          <Badge tone="warn" title="This gathering is not today's">
            {event.startAt < now ? 'Past gathering' : 'Not today'}
          </Badge>
        )}

        {/* The way back to the chooser. It is a link rather than a "back to
            now" jump because there is no longer a "now" the app has picked —
            somebody who is on the wrong night wants the question again, not a
            second guess at the answer. */}
        <Link
          to="/"
          className="ml-auto flex min-h-11 shrink-0 items-center rounded-full bg-ink-900 px-3 text-xs font-semibold text-brand-300 ring-1 ring-ink-700 hover:bg-ink-800 active:bg-ink-800 pointer-fine:min-h-9"
        >
          Change
        </Link>

        <select
          aria-label="Switch event"
          value={event.id}
          onChange={(changed) => navigate(`/event/${changed.target.value}`)}
          className="min-h-11 max-w-[55%] shrink truncate rounded-full bg-ink-900 px-3 text-xs text-ink-200 ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-400 pointer-fine:min-h-9"
        >
          {options.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {formatShortDate(candidate.startAt)} · {candidate.title}
            </option>
          ))}
        </select>
      </div>

      {!open ? (
        <p className="mt-2 text-[11px] text-warn-400">
          Check-in window is closed — you can still record attendance.
        </p>
      ) : null}
    </div>
  );
}
