/**
 * "Which gathering are you at?" — the first screen of the check-in tab.
 *
 * Tally used to answer this itself, from the clock, and open straight into the
 * roster. That was one fewer tap and one more way to be wrong: on a night with
 * two things on, or a gathering running late, or a phone whose clock had
 * drifted, the app made a confident silent choice and a counselor could tap
 * forty students into it before noticing. Now it asks. The cards are large
 * because the answer is the whole job of the screen, and because the person
 * answering is holding the phone one-handed with a queue in front of them.
 *
 * Today only. The gathering somebody is standing at is on today by definition,
 * and a list that also offered next month would be a calendar — which is what
 * the Events tab is for.
 *
 * The one exception is the tail at the bottom. Taking the register for a
 * Friday somebody forgot is a real job, and the Events tab is core-team only,
 * so a counselor would otherwise have no route to it at all.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { EventHeroCard } from '@/features/events/EventHeroCard';
import { PastEventRow } from '@/features/events/PastGatherings';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { usePastEvents } from '@/hooks/usePastEvents';
import { isCheckInOpen, startOfDay } from '@/lib/time';
import type { TallyEvent } from '@/types';

/**
 * How many finished gatherings the catch-up tail offers.
 *
 * Deliberately short. This is an escape hatch, not the history — the full
 * paging list lives on the Events tab. Five reaches back over a fortnight of a
 * twice-weekly ministry, which covers "last Friday" and the one before it.
 */
const CATCH_UP = 5;

export interface ChooseEventProps {
  /** The projected calendar: last month plus everything ahead. */
  events: readonly TallyEvent[];
  now: Date;
}

/* -------------------------------------------------------------------------- */

function CatchUp({ before }: { before: Date }) {
  const { events, loading } = usePastEvents(before, CATCH_UP);
  const { snapshots } = useEventSnapshots(events);

  const counts = useMemo(
    () => new Map(snapshots.map((s) => [s.event.id, s.presentStudentIds.size])),
    [snapshots],
  );

  if (loading && events.length === 0) return null;
  if (events.length === 0) return null;

  return (
    <section aria-labelledby="catch-up">
      <h2
        id="catch-up"
        className="pb-1 text-xs font-bold uppercase tracking-wider text-ink-400"
      >
        Catch up
      </h2>
      <p className="pb-2 text-xs text-ink-500">
        Nobody took the register? Open one of these and add them now.
      </p>
      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <PastEventRow key={event.id} event={event} count={counts.get(event.id)} />
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function ChooseEvent({ events, now }: ChooseEventProps) {
  const { can } = useAuth();

  const { dayStart, today } = useMemo(() => {
    /*
     * The day boundary, not the current instant.
     *
     * A gathering that finished at four this afternoon is still today's, and a
     * counselor catching up at teatime should find it here rather than in the
     * tail below. The catch-up list reads back from the same boundary, so
     * nothing appears twice.
     */
    const dayStart = startOfDay(now);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    return {
      dayStart,
      today: events
        .filter((event) => event.startAt >= dayStart && event.startAt < dayEnd)
        // Whatever is open right now goes to the top: on a Sunday with a class
        // at half nine and a lunch at one, the one happening is the one being
        // reached for.
        .sort((a, b) => {
          const open = Number(isCheckInOpen(b, now)) - Number(isCheckInOpen(a, now));
          return open !== 0 ? open : a.startAt.getTime() - b.startAt.getTime();
        }),
    };
  }, [events, now]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-4 pb-8">
      {today.length > 0 ? (
        <section aria-labelledby="choose-heading">
          <h1 id="choose-heading" className="pb-1 text-xl font-bold text-ink-50">
            {today.length === 1 ? 'On today' : 'Which gathering?'}
          </h1>
          <p className="pb-3 text-sm text-ink-500">
            {today.length === 1
              ? 'Open it to start checking students in.'
              : 'Pick the one you are standing at — attendance is filed against it.'}
          </p>

          <div className="flex flex-col gap-3">
            {today.map((event) => (
              <EventHeroCard
                key={event.id}
                event={event}
                now={now}
                to={`/event/${event.id}`}
                cta={isCheckInOpen(event, now) ? 'Start check-in' : 'Take attendance'}
              />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          className="py-8"
          icon="🗓"
          title="Nothing on today"
          description={
            can('core')
              ? 'Nothing is scheduled for today. The calendar, and everything already held, is on the Events tab.'
              : 'Nothing is scheduled for today. Ask the core team if a gathering is missing.'
          }
          action={
            can('core') ? (
              <Link
                to="/events"
                className="inline-flex min-h-11 items-center rounded-xl bg-ink-800 px-4 text-sm font-semibold text-ink-100 ring-1 ring-ink-700"
              >
                Go to events
              </Link>
            ) : undefined
          }
        />
      )}

      <CatchUp before={dayStart} />
    </div>
  );
}
