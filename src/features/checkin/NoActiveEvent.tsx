/**
 * What the check-in screen shows when the clock does not point at anything.
 *
 * Not an error: most of the week there is genuinely nothing to check into. The
 * job here is to say so plainly and put the two useful escapes within one tap —
 * start an upcoming event early, or catch up on one that already happened.
 */
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { formatEventDay, formatEventWindow } from '@/lib/time';
import type { TallyEvent } from '@/types';

export interface NoActiveEventProps {
  /** `selectableEvents` from `useActiveEvent`: last month plus everything ahead. */
  events: readonly TallyEvent[];
  now: Date;
}

function EventList({
  title,
  events,
  now,
}: {
  title: string;
  events: readonly TallyEvent[];
  now: Date;
}) {
  if (events.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="px-1 pb-2 text-xs font-bold uppercase tracking-wider text-ink-400">{title}</h2>
      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <li key={event.id}>
            <Link
              to={`/event/${event.id}`}
              className="flex min-h-16 items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 ring-1 ring-ink-800 active:bg-ink-800"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink-100">{event.title}</span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  {formatEventDay(event.startAt, now)} · {formatEventWindow(event)}
                </span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-lg text-ink-600">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NoActiveEvent({ events, now }: NoActiveEventProps) {
  const { can } = useAuth();

  const upcoming = [...events]
    .filter((event) => event.startAt >= now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, 5);
  const recent = [...events]
    .filter((event) => event.startAt < now)
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
    .slice(0, 5);

  return (
    <div className="scroll-touch min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-4">
      <EmptyState
        icon="🗓"
        title="Nothing to check into right now"
        description={
          events.length > 0
            ? 'Tally opens the right event on its own once check-in starts. Until then, pick one below to get a head start or to catch up on a past gathering.'
            : 'No gatherings are scheduled yet.'
        }
      />

      <EventList title="Coming up" events={upcoming} now={now} />
      <EventList title="Recently" events={recent} now={now} />

      {can('core') ? (
        <p className="mt-8 text-center text-sm">
          <Link to="/events" className="font-semibold text-brand-300 underline underline-offset-4">
            Manage events
          </Link>
        </p>
      ) : (
        <p className="mt-8 text-center text-xs text-ink-500">
          Ask the core team if a gathering is missing.
        </p>
      )}
    </div>
  );
}
