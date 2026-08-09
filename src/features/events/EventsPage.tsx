/**
 * The event calendar, read from where the leader is standing.
 *
 * Four bands, and they are shaped differently because they answer different
 * questions rather than because variety is nice.
 *
 *  - **Today** is the hero. If something is on, it is almost certainly what the
 *    screen was opened for, so it gets its icon, its description and a card the
 *    size of a decision.
 *  - **Next seven days** is a glance: rows, one line of detail each. This is
 *    the horizon a Friday is planned to.
 *  - **Later** is everything else the recurrence rules put on the calendar
 *    before the horizon. It is not one of the three bands the redesign asked
 *    for, and it is here anyway, because without it a retreat four weeks out
 *    would simply be missing from the events screen.
 *  - **Past gatherings** is a search. It pages into the ministry's whole
 *    history and carries a head count per row — see `PastGatherings`.
 *
 * Someone has to create next Friday every single week, so that path keeps its
 * shortcut: a quick action per active series materialises the next occurrence
 * and hands it straight to the editor, which makes scheduling two taps instead
 * of a form.
 *
 * RSVP counts deliberately do not appear on a row. They live in a subcollection
 * this screen does not subscribe to, and a plausible-looking wrong number is
 * worse than no number when it is what a leader is chasing.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, EventIcon, SkeletonRows } from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { EventEditorModal } from '@/features/events/EventEditorModal';
import { EventHeroCard } from '@/features/events/EventHeroCard';
import { AttendanceGridModal } from '@/features/events/AttendanceGridModal';
import { ImportCheckInsModal } from '@/features/events/ImportCheckInsModal';
import { PastGatherings } from '@/features/events/PastGatherings';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useNow } from '@/hooks/useNow';
import { formatEventDay, formatEventWindow, nextSeriesOccurrence, startOfDay } from '@/lib/time';
import { cn } from '@/lib/utils';
import { setEventStatus, type EventDraft } from '@/services/events';
import type { EventSeries, TallyEvent } from '@/types';

/** How far "this week" reaches. Seven days is the horizon a Friday plans to. */
const WEEK_DAYS = 7;

interface EditorTarget {
  event: TallyEvent | null;
  defaults?: Partial<EventDraft>;
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

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

  const badges = [
    event.mode === 'oneoff' ? <Badge key="oneoff" tone="brand">One-off</Badge> : null,
    cancelled ? <Badge key="cancelled" tone="danger">Cancelled</Badge> : null,
    event.requiresRsvp ? <Badge key="rsvp" tone="warn">RSVP only</Badge> : null,
    event.requiresCheckOut ? (
      <Badge key="checkout" tone="neutral">Check-out</Badge>
    ) : null,
  ].filter(Boolean);

  return (
    // `min-w-0` at every level of the flex chain: a flex item defaults to
    // `min-width: auto`, which refuses to shrink below its content and pushes
    // the whole page sideways when an event has a long location.
    <li className="flex min-w-0 items-stretch gap-2">
      <Link
        to={`/events/${event.id}`}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl bg-ink-900 px-3 py-3 ring-1 ring-ink-800 active:bg-ink-800"
      >
        <EventIcon name={event.icon} size="md" />

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate font-semibold',
              cancelled ? 'text-ink-500 line-through' : 'text-ink-100',
            )}
          >
            {event.title}
          </span>

          {/* One step closer than it was. Five of these rows say "Friday
              Fellowship" and five say "Sunday School", so the date is the only
              thing that tells them apart — and it was the quietest mark in the
              row, a step further back than the same line in the past list. */}
          <span className="mt-0.5 block truncate text-xs text-ink-400">
            {formatEventDay(event.startAt, now)} · {formatEventWindow(event)}
            {event.location ? ` · ${event.location}` : ''}
          </span>

          {/*
            Only what makes this row different from the sixteen around it.

            Every recurring row carried a grey "Recurring" chip on a line of its
            own — a badge on every row is not information, it is a repeated
            word, and it cost a line of height each while the one genuinely
            different gathering, a retreat with an RSVP list, had to compete
            with sixteen decoys wearing the same chip shape.
          */}
          {badges.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1">{badges}</span>
          ) : null}
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

function RowSection({
  title,
  events,
  now,
  onUncancel,
  uncancelling,
}: {
  title: string;
  events: readonly TallyEvent[];
  now: Date;
  onUncancel: (event: TallyEvent) => void;
  uncancelling: string | null;
}) {
  if (events.length === 0) return null;

  return (
    <section aria-labelledby={`events-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <h2
        id={`events-${title.replace(/\s+/g, '-').toLowerCase()}`}
        className="pb-2 text-xs font-bold uppercase tracking-wider text-ink-400"
      >
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            now={now}
            onUncancel={onUncancel}
            uncancelling={uncancelling === event.id}
          />
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Today                                                                       */
/* -------------------------------------------------------------------------- */

function Today({ events, now }: { events: readonly TallyEvent[]; now: Date }) {
  const { canWork } = useData();
  // Head counts, but only for the gatherings that have finished. See the note
  // on `present` in `EventHeroCard`.
  const finished = useMemo(
    () => events.filter((event) => event.checkInClosesAt < now),
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
  const present = useMemo(
    () => new Map(snapshots.map((s) => [s.event.id, s.presentStudentIds.size])),
    [snapshots],
  );

  if (events.length === 0) return null;

  return (
    <section aria-labelledby="events-today">
      <h2
        id="events-today"
        className="pb-2 text-xs font-bold uppercase tracking-wider text-ink-400"
      >
        Today
      </h2>
      <div className="flex flex-col gap-3">
        {events.map((event) => (
          <EventHeroCard
            key={event.id}
            event={event}
            now={now}
            present={present.get(event.id)}
            to={`/events/${event.id}`}
            cta="Open this gathering"
          />
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick actions                                                               */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */

export function EventsPage() {
  const { events, series, loading } = useData();
  const { user } = useAuth();
  const { show } = useToast();
  const now = useNow(60_000);

  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [importing, setImporting] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [uncancelling, setUncancelling] = useState<string | null>(null);

  /*
   * How far "Later" reaches before it asks.
   *
   * The recurrence rules project months ahead, so "Later" was an unbounded
   * list — sixteen rows and growing, alternating between two series, and the
   * single thing setting the page's height. On a phone it put the past half six
   * flicks away; on a laptop it made the two columns wildly different lengths,
   * so the page collapsed back into one column with the other half blank. A
   * month boundary rather than a row count, so it stays honest as the calendar
   * fills.
   */
  const [allLater, setAllLater] = useState(false);

  const { dayStart, today, thisWeek, later, laterHidden } = useMemo(() => {
    /*
     * The day boundary, not the current instant.
     *
     * A gathering that finished at four this afternoon is still today's, and a
     * leader looking at it at six should find it at the top of the screen
     * rather than in the history. `PastGatherings` reads back from the same
     * boundary, so nothing appears twice and nothing falls between them.
     */
    const dayStart = startOfDay(now);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const weekEnd = new Date(dayStart.getTime() + WEEK_DAYS * 86_400_000);

    const byStart = (a: TallyEvent, b: TallyEvent) => a.startAt.getTime() - b.startAt.getTime();
    const between = (from: Date, to: Date | null) =>
      events
        .filter((event) => event.startAt >= from && (to === null || event.startAt < to))
        .sort(byStart);

    // The end of the month after this one: "the rest of this month and next".
    const horizon = new Date(dayStart.getFullYear(), dayStart.getMonth() + 2, 1);

    const everythingLater = between(weekEnd, null);
    const nearLater = allLater
      ? everythingLater
      : everythingLater.filter((event) => event.startAt < horizon);

    return {
      dayStart,
      today: between(dayStart, dayEnd),
      thisWeek: between(dayEnd, weekEnd),
      later: nearLater,
      laterHidden: everythingLater.length - nearLater.length,
    };
  }, [events, now, allLater]);

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
        // A series is a weekly slot by definition, so the editor opens on
        // "Weekly on Friday" already filled in rather than on a blank pattern
        // the leader would have to restate.
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [candidate.dayOfWeek],
          monthlyMode: 'dayOfMonth',
          until: null,
          count: null,
        },
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
      <div className="mx-auto max-w-3xl px-4 py-4">
        <SkeletonRows count={4} />
      </div>
    );
  }

  const onUncancel = (target: TallyEvent) => void handleUncancel(target);
  const nothingAhead = today.length === 0 && thisWeek.length === 0 && later.length === 0;

  return (
    <PageFrame gap="lg" className="pb-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-50">Events</h1>
        <div className="flex items-center gap-2">
          {/* Quieter than "New event" on purpose: importing history happens a
              handful of times in an install's life, scheduling happens weekly. */}
          {/* Same weight as Import, and for the same reason: a grid is
              something a leader builds at the end of a term, not weekly. */}
          <Button variant="secondary" onClick={() => setGridOpen(true)}>
            Export
          </Button>
          <Button variant="secondary" onClick={() => setImporting(true)}>
            Import
          </Button>
          <Button onClick={() => setEditor({ event: null })}>New event</Button>
        </div>
      </header>

      {/*
        Ahead on the left, behind on the right — side by side where there is a
        pointer, stacked where there is a thumb.

        The half of this page that gets hunted through was the half that was
        furthest away: "find the Friday from three weeks ago" meant scrolling
        past a hero card for the gathering happening right now and then past
        sixteen future occurrences, about 2,500px, before the first past night
        appeared. Ten of them are on the fold now, beside the whole of what is
        coming. The phone keeps the original order, because there is only one
        column there and the calendar reads forwards.
      */}
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        <section aria-labelledby="events-upcoming" className="flex min-w-0 flex-col gap-8">
          {/* Three ranks, three treatments. The two halves of the calendar are
              the loudest, the groups inside them a step down, the month
              captions inside those a step down again. "Past gatherings" owned
              half the page and was set like a group inside the other half. */}
          <h2 id="events-upcoming" className="-mb-5 text-base font-semibold text-ink-100">
            Upcoming
          </h2>

          <Today events={today} now={now} />

          {/*
            Below tonight, not above it.

            This is the maintenance shortcut — schedule next Friday — and it sat
            first on the page wearing the loudest heading on it, so the card you
            touch when you notice something is missing outranked the gathering
            that is on tonight. Its rows already read "✓ … is scheduled" or
            "+ Schedule next …", so the explainer under the title was forty
            pixels restating them.
          */}
          {quickActions.length > 0 ? (
            <section aria-labelledby="events-series">
              <h3
                id="events-series"
                className="pb-2 text-xs font-bold uppercase tracking-wider text-ink-400"
              >
                Next in each series
              </h3>
              <ul className="flex flex-col gap-2">
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
            </section>
          ) : null}

          {nothingAhead ? (
            <EmptyState
              icon="🗓"
              title="Nothing scheduled yet"
              description="Use a quick action above, or create a one-off for a retreat or outing."
            />
          ) : null}

          <RowSection
            title="Next seven days"
            events={thisWeek}
            now={now}
            onUncancel={onUncancel}
            uncancelling={uncancelling}
          />
          <RowSection
            title="Later"
            events={later}
            now={now}
            onUncancel={onUncancel}
            uncancelling={uncancelling}
          />

          {/* The same idiom `PastGatherings` uses at the other end of the
              calendar, so both ends of the page ask the same way. */}
          {laterHidden > 0 ? (
            <button
              type="button"
              onClick={() => setAllLater(true)}
              className="min-h-12 w-full rounded-xl bg-ink-900 text-sm font-semibold text-ink-300 ring-1 ring-ink-800 active:bg-ink-800"
            >
              Show {laterHidden} later {laterHidden === 1 ? 'gathering' : 'gatherings'}
            </button>
          ) : null}
        </section>

        <PastGatherings before={dayStart} />
      </div>

      <EventEditorModal
        open={editor !== null}
        onClose={() => setEditor(null)}
        event={editor?.event ?? null}
        defaults={editor?.defaults}
      />

      <ImportCheckInsModal open={importing} onClose={() => setImporting(false)} />

      <AttendanceGridModal open={gridOpen} onClose={() => setGridOpen(false)} />
    </PageFrame>
  );
}
