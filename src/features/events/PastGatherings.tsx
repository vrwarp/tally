/**
 * The history at the foot of the check-in screen: every gathering that has
 * already happened, newest first, going back as far as somebody keeps scrolling.
 *
 * Two things distinguish this from the "Recently" list it replaced. It is not
 * capped at five, because the reason a counselor comes down here is to
 * back-fill a night they missed and there is no reason that night should be in
 * the last fortnight. And each row carries the one fact that makes a past
 * gathering worth looking at — how many students were checked in — so the list
 * answers "which Friday am I thinking of?" without a tap.
 *
 * The attendance counts come from `useEventSnapshots`, the same session-cached
 * one-shot read the predictive roster uses, so scrolling back over a window the
 * roster has already loaded costs nothing.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Badge, ErrorBanner } from '@/components/ui';
import { EventIcon } from '@/components/ui/EventIcon';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { usePastEvents } from '@/hooks/usePastEvents';
import { formatEventWindow } from '@/lib/time';
import type { TallyEvent } from '@/types';

/** "July 2026" — the ruler the rows hang off, so each row only needs a day. */
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

interface MonthGroup {
  key: string;
  label: string;
  events: TallyEvent[];
}

/**
 * The list, cut into months.
 *
 * An unbroken column of "Sat 25 · 11:00 PM" rows loses the reader within about
 * two screens: every Friday looks like every other Friday, and the only thing
 * that distinguishes them — how long ago — is the one thing a bare weekday and
 * day-of-month cannot say. The month headings are the ruler.
 */
function groupByMonth(events: readonly TallyEvent[]): MonthGroup[] {
  const groups: MonthGroup[] = [];

  for (const event of events) {
    const key = `${event.startAt.getFullYear()}-${event.startAt.getMonth()}`;
    const last = groups.at(-1);
    if (last?.key === key) last.events.push(event);
    else groups.push({ key, label: MONTH.format(event.startAt), events: [event] });
  }

  return groups;
}

/**
 * The right-hand end of a row: what happened, in one number.
 *
 * Three states, and the third is not a rounding of the second. A gathering with
 * nobody checked in is read everywhere else in Tally as one that did not happen
 * — it does not count as a miss and it does not feed the prediction (see
 * `lib/sessionHistory.ts`) — so printing a bold `0` beside it would state a
 * turnout the app does not itself believe.
 */
function AttendanceStat({ event, count }: { event: TallyEvent; count: number | undefined }) {
  if (event.status === 'cancelled') {
    return <Badge tone="danger">Cancelled</Badge>;
  }

  if (count === undefined) {
    return (
      <span
        aria-hidden="true"
        className="block h-8 w-10 animate-pulse rounded-lg bg-ink-800/70"
      />
    );
  }

  if (count === 0) {
    return (
      <span className="block text-right text-[11px] leading-tight text-ink-500">
        Nobody
        <span className="block">checked in</span>
      </span>
    );
  }

  return (
    <span className="block text-right leading-none">
      <span aria-hidden="true" className="text-xl font-bold tabular-nums text-present-400">
        {count}
      </span>
      <span className="sr-only">{count} students checked in</span>
      <span aria-hidden="true" className="mt-1 block text-[11px] leading-none text-ink-500">
        checked in
      </span>
    </span>
  );
}

/**
 * One finished gathering. Exported because the check-in screen shows a short
 * tail of these as its catch-up escape, and two renderings of "a Friday that
 * already happened" would drift.
 */
export function PastEventRow({
  event,
  count,
}: {
  event: TallyEvent;
  count: number | undefined;
}) {
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
            {format(event.startAt, 'EEE d')} · {formatEventWindow(event)}
          </span>
        </span>

        <AttendanceStat event={event} count={count} />
      </Link>
    </li>
  );
}

export interface PastGatheringsProps {
  /**
   * Where history starts. Midnight this morning, passed in rather than read
   * from the clock here, because it is the *same* boundary the hero above uses
   * to decide what counts as today — and a gathering that fell on either side
   * of two different answers would appear twice or not at all.
   */
  before: Date;
}

export function PastGatherings({ before }: PastGatheringsProps) {
  const { events, loading, hasMore, error, loadMore, retry } = usePastEvents(before);
  const { snapshots } = useEventSnapshots(events);

  const counts = useMemo(
    () => new Map(snapshots.map((snapshot) => [snapshot.event.id, snapshot.presentStudentIds.size])),
    [snapshots],
  );
  const groups = useMemo(() => groupByMonth(events), [events]);

  /*
   * The scroll sentinel.
   *
   * `rootMargin` starts the next page most of a screen before the reader
   * reaches the end, which is the difference between an infinite list and a
   * list with a pause in it. The observer is deliberately rebuilt whenever the
   * page count changes: an element that was already intersecting does not fire
   * again on its own, so a page that arrives without moving the sentinel out of
   * view would otherwise stall the list until the reader nudged it.
   */
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || error) return;
    // Old Safari, and a jsdom without the polyfill. The button below is the
    // whole fallback: the list still pages, it just waits to be asked.
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, error, loadMore, events.length]);

  if (!loading && !error && events.length === 0) return null;

  return (
    <section aria-labelledby="past-gatherings">
      <h2
        id="past-gatherings"
        className="px-1 pb-2 text-xs font-bold uppercase tracking-wider text-ink-400"
      >
        Past gatherings
      </h2>

      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              {group.label}
            </h3>
            <ul className="flex flex-col gap-2">
              {group.events.map((event) => (
                <PastEventRow key={event.id} event={event} count={counts.get(event.id)} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {error ? (
        <ErrorBanner
          className="mt-3"
          message={error}
          details={
            <button
              type="button"
              onClick={retry}
              className="mt-2 block min-h-11 font-semibold underline underline-offset-4"
            >
              Try again
            </button>
          }
        />
      ) : null}

      {/* Placeholders rather than a spinner: the list keeps its shape while the
          next page lands, so nothing under the reader's thumb jumps. */}
      {loading ? (
        <ul aria-hidden="true" className="mt-2 flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="h-16 animate-pulse rounded-xl bg-ink-800/50" />
          ))}
        </ul>
      ) : null}

      <div ref={sentinel} aria-hidden="true" className="h-px" />

      {/*
        * The manual way down.
        *
        * The observer starts the next page most of a screen early, so this is
        * rarely on screen for long — but "rarely" is not "never", and a list
        * that only advances for a thumb is a list a keyboard cannot reach the
        * end of. It is also the entire fallback where `IntersectionObserver`
        * is missing.
        */}
      {hasMore && !loading && !error ? (
        <button
          type="button"
          onClick={loadMore}
          className="mt-2 min-h-12 w-full rounded-xl bg-ink-900 text-sm font-semibold text-ink-300 ring-1 ring-ink-800 active:bg-ink-800"
        >
          Load older gatherings
        </button>
      ) : null}

      {!hasMore && !loading && events.length > 0 ? (
        <p className="pt-4 pb-1 text-center text-xs text-ink-500">
          That is every gathering Tally has a record of.
        </p>
      ) : null}
    </section>
  );
}
