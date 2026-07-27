/**
 * What the check-in screen shows when the clock does not point at anything.
 *
 * Not an error: most of the week there is genuinely nothing to check into. The
 * screen is a calendar read from where the reader is standing — today at the
 * top, the week ahead under it, and everything already held below that, going
 * back as far as somebody keeps scrolling.
 *
 * The three sections answer three different questions, which is why they are
 * shaped differently rather than being one list with headings.
 *
 *  - **Today** is the hero. If a gathering is on tonight, it is almost
 *    certainly why the app is open, and the screen should look like it knows
 *    that: the icon and the description are here and nowhere else, because this
 *    is the one place there is room for them and the one moment they are the
 *    answer rather than decoration.
 *  - **This week** is a glance. Rows, one line of detail each.
 *  - **Past gatherings** is a search. It pages into the ministry's whole
 *    history and carries a head count per row — see `PastGatherings`.
 *
 * Everything above the history comes from the projected calendar, so "nothing
 * on" is a statement about the recurrence rules rather than about what somebody
 * remembered to write down. The history below it is read separately and
 * directly: the projection only ever offers gatherings that have not finished,
 * and the live window the rest of the app holds open stops long before a
 * ministry's history does.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, EmptyState } from '@/components/ui';
import { EventIcon } from '@/components/ui/EventIcon';
import { useAuth } from '@/context/authContext';
import { PastGatherings } from '@/features/checkin/PastGatherings';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { formatClock, formatEventDay, formatEventWindow, isCheckInOpen, startOfDay } from '@/lib/time';
import type { TallyEvent } from '@/types';

/** How far "this week" reaches. Seven days is the horizon a Friday plans to. */
const WEEK_DAYS = 7;

export interface NoActiveEventProps {
  /** `selectableEvents` from `useActiveEvent`: last month plus everything ahead. */
  events: readonly TallyEvent[];
  now: Date;
}

/* -------------------------------------------------------------------------- */
/* Today                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where a gathering is in its own evening, as one line.
 *
 * A card that says only "7:00 PM – 9:00 PM" leaves the reader to do the
 * arithmetic against a clock they would have to leave the app to see, and the
 * answer decides whether they should be tapping names yet.
 */
function todayStatus(event: TallyEvent, now: Date, present: number | undefined): string {
  if (event.status === 'cancelled') return 'Cancelled';
  if (isCheckInOpen(event, now)) return 'Check-in is open';
  if (event.checkInOpensAt > now) return `Check-in opens at ${formatClock(event.checkInOpensAt)}`;
  if (present === undefined) return 'Check-in has closed';
  return present > 0
    ? `Finished · ${present} checked in`
    : 'Finished · nobody was checked in';
}

function TodayCard({
  event,
  now,
  present,
}: {
  event: TallyEvent;
  now: Date;
  present: number | undefined;
}) {
  const open = isCheckInOpen(event, now) && event.status !== 'cancelled';

  return (
    <li className="overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-ink-800">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <EventIcon name={event.icon} size="lg" tone="brand" />

          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight text-ink-50">{event.title}</h3>
            <p className="mt-0.5 text-sm text-ink-400">
              {formatEventWindow(event)}
              {event.location ? ` · ${event.location}` : ''}
            </p>
          </div>
        </div>

        {/* The description sits under the whole header rather than beside the
            icon: two or three lines of prose in a column narrowed by a 56px
            tile is four words wide on a phone. */}
        {event.description ? (
          <p className="text-sm leading-relaxed text-ink-300">{event.description}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {event.status === 'cancelled' ? (
            <Badge tone="danger">Cancelled</Badge>
          ) : open ? (
            <Badge tone="success">Check-in open</Badge>
          ) : null}
          <span className="text-xs text-ink-500">{todayStatus(event, now, present)}</span>
        </div>

        <Link
          to={`/event/${event.id}`}
          className={
            open
              ? 'inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-brand-500 px-5 text-base font-semibold text-white active:bg-brand-600'
              : 'inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-ink-800 px-5 text-base font-semibold text-ink-100 ring-1 ring-ink-700 active:bg-ink-700'
          }
        >
          {open ? 'Start check-in' : 'Take attendance'}
        </Link>
      </div>
    </li>
  );
}

function Today({ events, now }: { events: readonly TallyEvent[]; now: Date }) {
  /*
   * Head counts, but only for the gatherings that have finished.
   *
   * Attendance history is a one-shot read (`useEventSnapshots`), so a number
   * for an evening still in progress would be however many had been tapped in
   * when the screen opened, frozen, beside a card inviting the reader to go and
   * add more. Better to say nothing than to say a stale number.
   */
  const finished = useMemo(
    () => events.filter((event) => event.checkInClosesAt < now),
    [events, now],
  );
  const { snapshots } = useEventSnapshots(finished);
  const present = useMemo(
    () => new Map(snapshots.map((snapshot) => [snapshot.event.id, snapshot.presentStudentIds.size])),
    [snapshots],
  );

  if (events.length === 0) return null;

  return (
    <section aria-labelledby="today-heading">
      <h2
        id="today-heading"
        className="px-1 pb-2 text-xs font-bold uppercase tracking-wider text-ink-400"
      >
        Today
      </h2>
      <ul className="flex flex-col gap-3">
        {events.map((event) => (
          <TodayCard key={event.id} event={event} now={now} present={present.get(event.id)} />
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* This week                                                                   */
/* -------------------------------------------------------------------------- */

function UpcomingRow({ event, now }: { event: TallyEvent; now: Date }) {
  return (
    <li>
      <Link
        to={`/event/${event.id}`}
        className="flex min-h-16 min-w-0 items-center gap-3 rounded-xl bg-ink-900 px-3 py-2.5 ring-1 ring-ink-800 active:bg-ink-800"
      >
        <EventIcon name={event.icon} size="md" />

        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink-100">{event.title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-500">
            {formatEventDay(event.startAt, now)} · {formatEventWindow(event)}
          </span>
        </span>

        <span aria-hidden="true" className="shrink-0 text-lg text-ink-600">
          ›
        </span>
      </Link>
    </li>
  );
}

function ThisWeek({ events, now }: { events: readonly TallyEvent[]; now: Date }) {
  if (events.length === 0) return null;

  return (
    <section aria-labelledby="week-heading">
      <h2
        id="week-heading"
        className="px-1 pb-2 text-xs font-bold uppercase tracking-wider text-ink-400"
      >
        Next seven days
      </h2>
      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <UpcomingRow key={event.id} event={event} now={now} />
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function NoActiveEvent({ events, now }: NoActiveEventProps) {
  const { can } = useAuth();

  const { dayStart, today, thisWeek } = useMemo(() => {
    /*
     * The day boundary, not the current instant.
     *
     * A gathering that finished at four this afternoon is still today's, and a
     * counselor taking the register for it at six should find it at the top of
     * the screen rather than three sections down among the history. The history
     * list starts at the same boundary, so nothing appears twice.
     */
    const dayStart = startOfDay(now);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const weekEnd = new Date(dayStart.getTime() + WEEK_DAYS * 86_400_000);

    const byStart = (a: TallyEvent, b: TallyEvent) => a.startAt.getTime() - b.startAt.getTime();

    return {
      dayStart,
      today: events.filter((event) => event.startAt >= dayStart && event.startAt < dayEnd).sort(byStart),
      thisWeek: events
        .filter((event) => event.startAt >= dayEnd && event.startAt < weekEnd)
        .sort(byStart),
    };
  }, [events, now]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-4 pb-8">
      {today.length > 0 ? (
        <Today events={today} now={now} />
      ) : (
        <EmptyState
          className="py-8"
          icon="🗓"
          title="Nothing on today"
          description={
            thisWeek.length > 0
              ? 'Tally opens the right gathering on its own once check-in starts. Nothing is scheduled for today — the week ahead is below.'
              : events.length > 0
                ? 'Tally opens the right gathering on its own once check-in starts. Nothing is scheduled for today or the next few days.'
                : 'No gatherings are scheduled yet.'
          }
        />
      )}

      <ThisWeek events={thisWeek} now={now} />

      {/* Above the history rather than at the foot of the page: the list below
          pages until the ministry runs out of Fridays, so a link after it is a
          link nobody reaches. */}
      {can('core') ? (
        <p className="text-center text-sm">
          <Link to="/events" className="font-semibold text-brand-300 underline underline-offset-4">
            Manage events
          </Link>
        </p>
      ) : (
        <p className="text-center text-xs text-ink-500">
          Ask the core team if a gathering is missing.
        </p>
      )}

      <PastGatherings before={dayStart} />
    </div>
  );
}
