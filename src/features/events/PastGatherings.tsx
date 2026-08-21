/**
 * The history at the foot of the events calendar: every gathering that has
 * already happened, newest first, going back as far as somebody keeps scrolling.
 * `PastEventRow` is exported from here because the check-in screen hangs a short
 * tail of the same rows off its chooser — see `PastEventDestination` for the one
 * way the two differ.
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
import { Badge, EmptyState, ErrorBanner } from '@/components/ui';
import { EventIcon } from '@/components/ui/EventIcon';
import { LockedChainGroup } from '@/features/events/LockedChainGroup';
import { partitionBand } from '@/features/events/lockedChains';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useData } from '@/context/dataContext';
import { usePastEvents } from '@/hooks/usePastEvents';
import { formatEventWindow } from '@/lib/time';
import { cn } from '@/lib/utils';
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
 *
 * A ruler that scrolls off the top of the screen is not a ruler, which is why
 * the heading below is `sticky` — see the note on it.
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
 *
 * The fourth state, `locked`, has exactly one caller left.
 *
 * On the events calendar it was fourteen copies of one sentence down the margin
 * of a list, and the fact belongs to the chain rather than to the row — see
 * `LockedChainGroup`. On the check-in screen's catch-up tail it is at most five
 * rows, on a screen where the reader is standing at a door and any grouping
 * would cost a tap; there the caption is still the cheapest true thing to say.
 */
function AttendanceStat({
  event,
  count,
  locked,
}: {
  event: TallyEvent;
  count: number | undefined;
  locked?: boolean;
}) {
  if (event.status === 'cancelled') {
    return <Badge tone="danger">Cancelled</Badge>;
  }

  /*
   * A lock, not a spinner.
   *
   * The count for a gathering this reader is not on is never read — the callers
   * narrow the window before asking — so the pulsing placeholder below would
   * pulse forever. It is also the wrong claim twice over: a skeleton says "this
   * is arriving", and a nought would say "nobody came".
   */
  if (locked) {
    return (
      <span className="block text-right text-[11px] leading-tight text-ink-500">
        <span aria-hidden>🔒</span>
        <span className="block">not yours</span>
      </span>
    );
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

  /*
   * A footnote, not the headline — and then one step back up.
   *
   * This used to be `text-xl font-bold text-present-400`, a full type step above
   * the gathering it annotated, in the green that means "this student is checked
   * in right now". Squint at a list of those and you read "16 24 18 26 21" as a
   * column and the names second, which is backwards: the thing being chosen is
   * the gathering.
   *
   * Demoting it went one notch too far for the reader this list is hardest for.
   * On a calendar where most chains are somebody else's, this can be the only
   * number on the page, and it was set two steps below the title of its own row
   * — the answer to "what was the head count three weeks ago" quieter than a
   * name the reader already knew. It is the brightest thing in its row now and
   * `checked in` carries the demotion, at `ink-400` rather than `ink-500`
   * because at 11px on `ink-900` the fainter token is 3.9:1 and this is the word
   * that distinguishes 32 checked in from 32 of anything else.
   */
  return (
    <span className="block text-right leading-tight">
      <span aria-hidden="true" className="text-base font-bold tabular-nums text-ink-100">
        {count}
      </span>
      <span className="sr-only">{count} students checked in</span>
      <span aria-hidden="true" className="block text-[11px] leading-none text-ink-400">
        checked in
      </span>
    </span>
  );
}

/**
 * Where tapping a finished gathering should land.
 *
 * The two readers of this list want opposite things from the same row, and
 * sending both to one screen strands one of them.
 *
 *  - `register` — the check-in screen's catch-up tail. A counselor down here is
 *    back-filling a night nobody took the register for, and the register is the
 *    whole errand; an event page in between is a tap they did not ask for.
 *  - `page` — the events calendar. A core-team leader paging back through
 *    history came to *do something about* a night: rename it, cancel it, or
 *    delete the Friday that was recorded twice. None of that is on the register,
 *    and the event page carries a "Take attendance" button at the top of it, so
 *    this direction loses nothing and the other loses everything.
 *
 * This used to be one hard-coded `/event/` for both, which made the calendar's
 * whole history band a dead end: every other row on that page — today's hero,
 * the week ahead, a locked chain — goes to `/events/`, and a one-off that had
 * already happened had no other row anywhere to reach it by. Deleting one was
 * unreachable except by editing the address bar.
 */
export type PastEventDestination = 'register' | 'page';

/**
 * One finished gathering. Exported because the check-in screen shows a short
 * tail of these as its catch-up escape, and two renderings of "a Friday that
 * already happened" would drift.
 */
export function PastEventRow({
  event,
  count,
  locked,
  destination = 'register',
}: {
  event: TallyEvent;
  count: number | undefined;
  /**
   * Not this reader's gathering — the head count was never asked for. Only the
   * check-in screen's catch-up tail passes this; the calendar below groups its
   * locked gatherings by chain instead. See `AttendanceStat`.
   */
  locked?: boolean;
  /**
   * Defaults to the register, which is what the check-in screen wants and what
   * this row has always done. See `PastEventDestination`.
   */
  destination?: PastEventDestination;
}) {
  return (
    <li>
      <Link
        to={destination === 'page' ? `/events/${event.id}` : `/event/${event.id}`}
        className="flex min-h-16 min-w-0 items-center gap-3 rounded-xl bg-ink-900 px-3 py-2.5 ring-1 ring-ink-800 hover:bg-ink-800/40 active:bg-ink-800"
      >
        <EventIcon name={event.icon} size="md" />

        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink-100">{event.title}</span>
          {/* A step closer than it was: with two series alternating down this
              list, the date is the only thing telling one row from another. */}
          <span className="mt-0.5 block truncate text-xs text-ink-400">
            {format(event.startAt, 'EEE d')} · {formatEventWindow(event)}
          </span>
        </span>

        <AttendanceStat event={event} count={count} locked={locked} />
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
  const { canWork } = useData();
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
  const workable = useMemo(() => events.filter(canWork), [events, canWork]);
  const { snapshots } = useEventSnapshots(workable);

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

  /*
   * A ministry on its first week, which used to render as nothing at all.
   *
   * Returning `null` here was right about the content and wrong about the
   * page: `EventsPage` draws this half of the calendar inside a column that
   * carries the divider rule, and the rule deliberately runs the height of the
   * taller column — so an install with no history got a full-height hairline
   * with a void beside it, next to a left column saying "Nothing scheduled
   * yet". A brand-new ministry read as a broken screen on the exact page where
   * "New event" is the thing to find.
   *
   * So the half states itself instead. It is the quieter of the two empty
   * states on purpose — no icon, where the left column has one — because the
   * answer on that screen is on the other side of the rule.
   */
  const empty = !loading && !error && events.length === 0;

  return (
    <section aria-labelledby="past-gatherings">
      {/* A half of the calendar, at the same rank as "Upcoming" opposite it —
          not a group inside one. */}
      <h2 id="past-gatherings" className="pb-3 text-lg font-bold text-ink-50">
        Past gatherings
      </h2>

      {empty ? (
        <EmptyState
          title="Nothing has happened yet"
          description="Gatherings appear here once they are past."
        />
      ) : null}

      <div className="flex flex-col gap-5">
        {groups.map((group) => {
          // Descending: this list reads backwards, so the date a locked chain's
          // head advertises is the latest one gone by.
          const { own, locked } = partitionBand(group.events, canWork, 'desc');

          return (
            <div key={group.key}>
              {/* One eyebrow style for both halves of the calendar. This was a
                  step quieter and a step lighter than the bands opposite it,
                  which put the structure at the same value as the rows it
                  governs.

                  And it sticks, because it is the ruler and the rows are
                  measured against it. A row here reads "Fri 24 · 7:00 PM" and
                  deliberately does not name its month — the heading was
                  supposed to carry that. But a 64px row on a 72px pitch means
                  a month with two series running is 648–720px on its own, and
                  one flick into a five-Friday month left eight rows on screen
                  with the month nowhere on it. "Fri 24" happens in July, in
                  April and in January, and opening the right weekday in the
                  wrong month means reading the wrong head count off it.

                  Opaque `ink-950` — the page's own ground, and a token because
                  the ramp flips wholesale in daylight. Not the translucent
                  band the roster's headings use: the rows passing under this
                  one are `ink-900` cards, and they smear through a blur.

                  `top` is measured rather than assumed: the phone's app bar is
                  sticky at the top of the same scroller and carries a
                  safe-area inset on a notched phone, and it is not there at
                  all on a desktop. Same idiom as the check-in roster's own
                  sticky headings. Costs the desktop column nothing. */}
              <h3
                style={{ top: 'var(--app-header-h, 0px)' }}
                className="sticky z-10 bg-ink-950 pt-1 pb-2 text-xs font-bold uppercase tracking-wider text-ink-400"
              >
                {group.label}
              </h3>
              <ul className="flex flex-col gap-2">
                {own.map((event) => (
                  <PastEventRow
                    key={event.id}
                    event={event}
                    count={counts.get(event.id)}
                    // The calendar sends every other row to the event page, and
                    // for a one-off already held this row is the only way there.
                    destination="page"
                  />
                ))}
              </ul>

              {/* Below a rule when the month has one of the reader's own in it,
                  and flush when it does not — the rule is the demotion boundary,
                  and a rule under nothing is a rule about nothing. */}
              {locked.length > 0 ? (
                <ul
                  className={cn(
                    'flex flex-col gap-2',
                    own.length > 0 && 'mt-2 border-t border-ink-800 pt-2',
                  )}
                >
                  {locked.map((chain) => (
                    <LockedChainGroup key={chain.key} chain={chain} lead="latest" />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
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
          className="mt-2 min-h-12 w-full rounded-xl bg-ink-900 text-sm font-semibold text-ink-300 ring-1 ring-ink-800 hover:bg-ink-800/40 active:bg-ink-800 pointer-fine:min-h-9"
        >
          Load older gatherings
        </button>
      ) : null}

      {/* Left-aligned, like everything else in this column. */}
      {!hasMore && !loading && events.length > 0 ? (
        <p className="pt-4 pb-1 text-xs text-ink-500">
          That is every gathering Tally has a record of.
        </p>
      ) : null}
    </section>
  );
}
