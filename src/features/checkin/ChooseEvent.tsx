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
 * Today, plus whatever is open. The gathering somebody is standing at is nearly
 * always on today, and a list that also offered next month would be a calendar —
 * which is what the Events tab is for. The exception is the night that runs past
 * midnight: a window still open outranks the calendar day it opened on.
 *
 * The one exception is the tail at the bottom. Taking the register for a
 * Friday somebody forgot is a real job, and the Events tab is core-team only,
 * so a counselor would otherwise have no route to it at all.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageFrame } from '@/components/PageFrame';
import { EmptyState } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { EventHeroCard } from '@/features/events/EventHeroCard';
import { PastEventRow } from '@/features/events/PastGatherings';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useData } from '@/context/dataContext';
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

function CatchUp({ before, now }: { before: Date; now: Date }) {
  const { events, loading } = usePastEvents(before, CATCH_UP);
  const { canWork } = useData();

  /*
   * "Before midnight" and "finished" are not the same thing.
   *
   * This list reads back from the start of today, so a gathering that began
   * last night and is still open for check-in comes back in it — and it is
   * already up top as the one happening now. Catching up is for gatherings
   * nobody can still be standing at.
   *
   * Narrowed before the head counts are read rather than after, so a gathering
   * that is not going to be shown is not paid for either.
   */
  const finished = useMemo(
    () => events.filter((event) => !isCheckInOpen(event, now)),
    [events, now],
  );

  /*
   * Narrowed to the gatherings this counselor may actually work, before the
   * read rather than after.
   *
   * Not an optimisation. `fetchAttendanceByEvent` tolerates a refusal per
   * event, but a refusal is still a round trip and still a console error on a
   * screen that has nothing to say about it — and asking at all for a register
   * the reader cannot have is asking a question whose answer would be
   * misleading if it arrived.
   */
  const workable = useMemo(() => finished.filter(canWork), [finished, canWork]);
  const { snapshots } = useEventSnapshots(workable);

  const counts = useMemo(
    () => new Map(snapshots.map((s) => [s.event.id, s.presentStudentIds.size])),
    [snapshots],
  );

  if (loading && finished.length === 0) return null;
  if (finished.length === 0) return null;

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
        {finished.map((event) => (
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
     *
     * Open beats the boundary, though. A lock-in that started at eleven and is
     * still going at half past midnight is on *yesterday* by the calendar, and
     * the counselor holding the door is checking people into it right now — so
     * a window that is open puts a gathering here whichever day it began on.
     * Without that, the one screen whose whole job is to open a gathering was
     * the one screen that could not see it.
     */
    const dayStart = startOfDay(now);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    return {
      dayStart,
      today: events
        .filter(
          (event) =>
            (event.startAt >= dayStart && event.startAt < dayEnd) || isCheckInOpen(event, now),
        )
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
    /* Same frame as every other screen, and the same `widen: false` as the
       roster it leads to — these two are one tab and must not move under a
       counselor who taps from one to the other. */
    <PageFrame widen={false} gap="lg" className="pb-8">
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
                className="inline-flex min-h-11 items-center rounded-xl bg-ink-800 px-4 text-sm font-semibold text-ink-100 ring-1 ring-ink-700 hover:bg-ink-700"
              >
                Go to events
              </Link>
            ) : undefined
          }
        />
      )}

      <CatchUp before={dayStart} now={now} />
    </PageFrame>
  );
}
