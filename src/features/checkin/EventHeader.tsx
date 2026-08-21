/**
 * Which event am I checking students into, and how many are here?
 *
 * The date badge is the most important thing on this bar. Checking forty
 * students into last Friday is the worst failure this app has, and the event is
 * now chosen by hand rather than by the clock — so the screen has to keep
 * saying which night it is filing against, loudly, for as long as somebody is
 * tapping. "Today" is reassurance; anything else is a warning.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, EventIcon } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { AccessSheet } from '@/features/events/AccessSheet';
import { chainKey } from '@/lib/materialize';
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
  const { access } = useData();
  const [accessOpen, setAccessOpen] = useState(false);
  const open = isCheckInOpen(event, now);

  const list = access.get(chainKey(event));
  const restricted = list?.restricted === true;
  const onGathering = list?.members.size ?? 0;
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

        **One row, always.** The select is the widest control here and the one
        most likely to be reached for on the wrong night, so it is the one that
        flexes: everything beside it holds its size and the select takes what is
        left, truncating rather than wrapping. Letting it wrap put the whole
        control on a line of its own and pushed the roster down a step on every
        phone — and a second line of chips reads as a second group of things,
        which these are not.
      */}
      <div className="mt-2 flex items-center gap-2">
        {/*
          Only when it is a warning.

          The line directly above already says which day this is —
          `formatEventDay` renders "Today" in exactly the spot a reader looks
          first — so a neutral "Today" capsule beside it was the same word
          twice, spending the row's scarcest resource to say nothing new. What
          is *not* redundant is the warn-toned version: "Fri 7" up there is a
          date, and checking forty students into last Friday is the worst
          failure this app has, so that one keeps its capsule and its colour.
        */}
        {!isToday ? (
          <Badge tone="warn" title="This gathering is not today's">
            {event.startAt < now ? 'Past gathering' : 'Not today'}
          </Badge>
        ) : null}

        {/*
          The only route a counselor has to who is on this gathering.

          They never reach the Events tab — it is core-team only — so without
          this chip the volunteer standing next to them at the door could not be
          added by the one person who is allowed to add them. It reads as a
          count rather than a verb because most of the time it is information;
          the sheet behind it is where the verbs are.

          Short, because it shares a row with the select. The full sentence
          lives in the label, where a screen reader gets it and the layout does
          not pay for it.
        */}
        <button
          type="button"
          onClick={() => setAccessOpen(true)}
          aria-label={
            restricted
              ? `Who's on this gathering — ${onGathering} ${onGathering === 1 ? 'person' : 'people'}`
              : "Who's on this gathering — everyone on the team"
          }
          className="flex min-h-11 shrink-0 items-center rounded-full bg-ink-900 px-3 text-xs font-semibold text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800 active:bg-ink-800 pointer-fine:min-h-9"
        >
          {restricted ? `🔒 ${onGathering}` : 'Everyone'}
        </button>

        {/* The way back to the chooser. It is a link rather than a "back to
            now" jump because there is no longer a "now" the app has picked —
            somebody who is on the wrong night wants the question again, not a
            second guess at the answer. */}
        <Link
          to="/"
          className="flex min-h-11 shrink-0 items-center rounded-full bg-ink-900 px-3 text-xs font-semibold text-brand-300 ring-1 ring-ink-700 hover:bg-ink-800 active:bg-ink-800 pointer-fine:min-h-9"
        >
          Change
        </Link>

        <select
          aria-label="Switch event"
          value={event.id}
          onChange={(changed) => navigate(`/event/${changed.target.value}`)}
          /* It flexes because on a phone it is the widest control here and the
             one most likely to be reached for on the wrong night. On a laptop
             band the same rule made it a 900px pill: past the width of the
             longest option there is nothing left to reveal, so it stops. */
          className="min-h-11 min-w-0 flex-1 truncate rounded-full bg-ink-900 px-3 text-xs text-ink-200 ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-400 pointer-fine:min-h-9 lg:max-w-sm"
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

      <AccessSheet
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        event={event}
        now={now}
      />
    </div>
  );
}
