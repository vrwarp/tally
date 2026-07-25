/**
 * The event calendar.
 *
 * Someone has to create next Friday every single week, so that path is the one
 * this screen optimises: a quick action per active series materialises the next
 * occurrence and hands it straight to the editor, which makes scheduling two
 * taps instead of a form. Everything else — browsing, un-cancelling, opening an
 * event — is a list.
 *
 * RSVP counts deliberately do not appear on a row. They live in a subcollection
 * that this screen does not subscribe to, and a plausible-looking wrong number
 * is worse than no number when it is what a leader is chasing.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, EmptyState, SkeletonRows } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { EventEditorModal } from '@/features/events/EventEditorModal';
import { useNow } from '@/hooks/useNow';
import { formatEventDay, formatEventWindow, nextSeriesOccurrence, startOfDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { setEventStatus, type EventDraft } from '@/services/events';
import type { EventSeries, TallyEvent } from '@/types';

interface EditorTarget {
  event: TallyEvent | null;
  defaults?: Partial<EventDraft>;
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function EventRow({
  event,
  now,
  onUncancel,
  uncancelling,
}: {
  event: TallyEvent;
  now: Date;
  onUncancel: (event: TallyEvent) => void;
  uncancelling: boolean;
}) {
  const cancelled = event.status === 'cancelled';

  return (
    // `min-w-0` at every level of the flex chain: a flex item defaults to
    // `min-width: auto`, which refuses to shrink below its content and pushes
    // the whole page sideways when an event has a long location.
    <li className="flex min-w-0 items-stretch gap-2">
      <Link
        to={`/events/${event.id}`}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 ring-1 ring-ink-800 active:bg-ink-800"
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate font-semibold',
              cancelled ? 'text-ink-500 line-through' : 'text-ink-100',
            )}
          >
            {event.title}
          </span>

          <span className="mt-0.5 block truncate text-xs text-ink-500">
            {formatEventDay(event.startAt, now)} · {formatEventWindow(event)}
            {event.location ? ` · ${event.location}` : ''}
          </span>

          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge tone={event.mode === 'recurring' ? 'neutral' : 'brand'}>
              {event.mode === 'recurring' ? 'Recurring' : 'One-off'}
            </Badge>
            {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
            {event.requiresWaiver ? <Badge tone="warn">Waiver</Badge> : null}
            {event.requiresPayment ? <Badge tone="warn">Payment</Badge> : null}
          </span>
        </span>

        <span aria-hidden="true" className="shrink-0 text-lg text-ink-600">
          ›
        </span>
      </Link>

      {/* Outside the link rather than inside it: nesting a button in an anchor
          makes both targets ambiguous to a thumb and to a screen reader. */}
      {cancelled ? (
        <button
          type="button"
          onClick={() => onUncancel(event)}
          disabled={uncancelling}
          aria-label={`Un-cancel ${event.title}`}
          className="min-h-16 shrink-0 rounded-xl bg-ink-800 px-3 text-xs font-semibold text-brand-300 ring-1 ring-ink-700 active:bg-ink-700 disabled:opacity-50"
        >
          Un-cancel
        </button>
      ) : null}
    </li>
  );
}

function QuickAction({
  series,
  now,
  existing,
  onSchedule,
}: {
  series: EventSeries;
  now: Date;
  existing: TallyEvent | null;
  onSchedule: (series: EventSeries) => void;
}) {
  const occurrence = nextSeriesOccurrence(series, now);
  const when = `${formatEventDay(occurrence.startAt, now)} · ${formatEventWindow(occurrence)}`;

  if (existing) {
    return (
      <li>
        <Link
          to={`/events/${existing.id}`}
          className="flex min-h-14 items-center gap-3 rounded-xl bg-ink-900 px-4 py-2 ring-1 ring-ink-800 active:bg-ink-800"
        >
          <span aria-hidden="true" className="text-present-400">
            ✓
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-300">
              {series.title} is scheduled
            </span>
            <span className="block truncate text-xs text-ink-500">{when}</span>
          </span>
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSchedule(series)}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-brand-500/10 px-4 py-2 text-left ring-1 ring-brand-500/30 active:bg-brand-500/20"
      >
        <span aria-hidden="true" className="text-lg leading-none text-brand-300">
          +
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-brand-200">
            Schedule next {series.title}
          </span>
          <span className="block truncate text-xs text-ink-400">{when}</span>
        </span>
      </button>
    </li>
  );
}

export function EventsPage() {
  const { events, series, loading } = useData();
  const { user } = useAuth();
  const { show } = useToast();
  const now = useNow(60_000);

  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [uncancelling, setUncancelling] = useState<string | null>(null);

  const { upcoming, past } = useMemo(() => {
    // "Past" starts when the gathering is over, not when it starts — an event
    // in progress belongs at the top of Upcoming where someone can still open it.
    const ahead = events.filter((event) => event.endAt >= now);
    const behind = events.filter((event) => event.endAt < now);
    return {
      upcoming: [...ahead].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
      past: [...behind].sort((a, b) => b.startAt.getTime() - a.startAt.getTime()),
    };
  }, [events, now]);

  const quickActions = useMemo(
    () =>
      series
        .filter((candidate) => candidate.active)
        .map((candidate) => {
          const occurrence = nextSeriesOccurrence(candidate, now);
          const existing =
            events.find(
              (event) =>
                event.seriesId === candidate.id &&
                event.status !== 'cancelled' &&
                sameDay(event.startAt, occurrence.startAt),
            ) ?? null;
          return { series: candidate, existing };
        }),
    [series, events, now],
  );

  const handleSchedule = (candidate: EventSeries) => {
    const occurrence = nextSeriesOccurrence(candidate, now);
    setEditor({
      event: null,
      defaults: {
        title: candidate.title,
        mode: 'recurring',
        seriesId: candidate.id,
        defaultGroupingMode: candidate.defaultGroupingMode,
        ...occurrence,
      },
    });
  };

  const handleUncancel = async (event: TallyEvent) => {
    if (!user) return;
    setUncancelling(event.id);
    try {
      await setEventStatus(event.id, 'scheduled', user.uid);
      show(`${event.title} is back on`, { tone: 'success' });
    } catch {
      show('Could not un-cancel this event. Try again.', { tone: 'error' });
    } finally {
      setUncancelling(null);
    }
  };

  if (loading && events.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-4">
        <SkeletonRows count={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-50">Events</h1>
        <Button onClick={() => setEditor({ event: null })}>New event</Button>
      </header>

      {quickActions.length > 0 ? (
        <Card>
          <CardHeader title="Quick add" description="Next occurrence of each series." />
          <ul className="flex flex-col gap-2 p-3">
            {quickActions.map(({ series: candidate, existing }) => (
              <QuickAction
                key={candidate.id}
                series={candidate}
                now={now}
                existing={existing}
                onSchedule={handleSchedule}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Upcoming" count={upcoming.length} />
        {upcoming.length === 0 ? (
          <EmptyState
            icon="🗓"
            title="Nothing scheduled yet"
            description="Use a quick action above, or create a one-off for a retreat or outing."
          />
        ) : (
          <ul className="flex flex-col gap-2 p-3">
            {upcoming.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                now={now}
                onUncancel={(target) => void handleUncancel(target)}
                uncancelling={uncancelling === event.id}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Past"
          count={past.length}
          description="The last few months, newest first."
        />
        {past.length === 0 ? (
          <EmptyState title="No past gatherings yet" />
        ) : (
          <ul className="flex flex-col gap-2 p-3">
            {past.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                now={now}
                onUncancel={(target) => void handleUncancel(target)}
                uncancelling={uncancelling === event.id}
              />
            ))}
          </ul>
        )}
      </Card>

      <EventEditorModal
        open={editor !== null}
        onClose={() => setEditor(null)}
        event={editor?.event ?? null}
        defaults={editor?.defaults}
      />
    </div>
  );
}
