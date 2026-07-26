/**
 * What the check-in screen shows when the clock does not point at anything.
 *
 * Not an error: most of the week there is genuinely nothing to check into. The
 * job here is to say so plainly and put the two useful escapes within one tap —
 * start an upcoming event early, or catch up on one that already happened.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, EmptyState } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { missingOccurrenceNow } from '@/lib/materialize';
import { formatEventDay, formatEventWindow } from '@/lib/time';
import { materializeOccurrences } from '@/services/events';
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

/**
 * The backstop: a gathering whose rule says it is happening right now, that
 * nobody ever wrote down.
 *
 * If the horizon is doing its job this never renders. It exists for the case it
 * cannot cover — the core team stayed out of Tally for two months and the
 * calendar ran dry — and it is an offer rather than a silent write, because
 * *looking* at the check-in screen must not create a gathering. A counselor who
 * opened the app on the wrong evening would otherwise put a Friday on the
 * calendar that never happened.
 */
function MissingOccurrence({ now }: { now: Date }) {
  const { events } = useData();
  const { user, can } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);

  const draft = missingOccurrenceNow(events, now);
  if (!draft) return null;

  // Only core may write events, so only core is offered the button. A counselor
  // is told what is missing and who can fix it, which beats an empty screen
  // that says nothing is on when something plainly is.
  const start = async () => {
    if (!user) return;
    setStarting(true);
    try {
      const created = await materializeOccurrences([draft], user.uid);
      if (created === 0) throw new Error('not created');
      show(`${draft.source.title} is on`, { tone: 'success' });
      navigate(`/event/${draft.id}`);
    } catch {
      show('Could not start this gathering. Try again.', { tone: 'error' });
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl bg-brand-500/10 p-4 ring-1 ring-brand-500/30">
      <h2 className="font-semibold text-brand-200">{draft.source.title} is due now</h2>
      <p className="mt-1 text-xs text-ink-400">
        {formatEventDay(draft.startAt, now)} · {formatEventWindow(draft)} — it repeats, but this
        one was never scheduled.
      </p>
      {can('core') ? (
        <Button className="mt-3 w-full" loading={starting} onClick={() => void start()}>
          Start it now
        </Button>
      ) : (
        <p className="mt-2 text-xs text-ink-500">
          Ask the core team to schedule it, then pull to refresh.
        </p>
      )}
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
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <EmptyState
        icon="🗓"
        title="Nothing to check into right now"
        description={
          events.length > 0
            ? 'Tally opens the right event on its own once check-in starts. Until then, pick one below to get a head start or to catch up on a past gathering.'
            : 'No gatherings are scheduled yet.'
        }
      />

      <MissingOccurrence now={now} />

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
