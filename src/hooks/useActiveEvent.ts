import { useMemo, useRef } from 'react';
import { useData } from '@/context/dataContext';
import { useNow } from '@/hooks/useNow';
import { predictionChain } from '@/lib/gatherings';
import { pickActiveEvent, recentChainInstances } from '@/lib/time';
import { sameItems } from '@/lib/utils';
import type { TallyEvent } from '@/types';

export interface ActiveEventResult {
  /** The event named in the URL, or null when nobody has chosen one yet. */
  event: TallyEvent | null;
  /**
   * The gathering whose check-in window covers this instant, if any.
   *
   * No longer *selects* anything — it is a fact about the clock the chooser
   * uses to sort and highlight, and the header uses to warn. See below.
   */
  liveEvent: TallyEvent | null;
  /** Ticking clock the screen was rendered against. */
  now: Date;
  /** Events a counselor may reasonably switch to: recent past plus upcoming. */
  selectableEvents: TallyEvent[];
}

/**
 * Which event the counselor is checking into.
 *
 * The choice is the URL, and nothing else. Tally used to make it from the clock
 * and open straight into the roster, which was one fewer tap and one more way
 * to be wrong: on a night with two gatherings on, or one running late, the app
 * made a confident silent choice and forty students could be filed against it
 * before anybody noticed. `ChooseEvent` now asks, and this hook only resolves
 * the answer.
 *
 * `pickActiveEvent` survives that change because "what is on right now" is
 * still worth knowing — it is what puts the live gathering at the top of the
 * chooser with the brand ring around it. It just no longer decides anything on
 * the counselor's behalf.
 */
export function useActiveEvent(eventId?: string | null): ActiveEventResult {
  const { events } = useData();
  const now = useNow();

  return useMemo(() => {
    const chosen = eventId ? (events.find((event) => event.id === eventId) ?? null) : null;

    // Anything from the last month plus everything still ahead: enough to
    // back-fill a missed Sunday without scrolling through a year.
    const monthAgo = new Date(now.getTime() - 31 * 86_400_000);
    const selectableEvents = events
      .filter((event) => event.status !== 'cancelled' && event.startAt >= monthAgo)
      .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

    return {
      event: chosen,
      liveEvent: pickActiveEvent(events, now),
      now,
      selectableEvents,
    };
  }, [events, now, eventId]);
}

/**
 * How many extra instances to load beyond the prediction window.
 *
 * `buildSeriesHistory` drops gatherings that never happened — cancelled, or with
 * nobody ever checked in — and only then takes the most recent `ofLastN`. Loading
 * exactly `ofLastN` events would mean a snowed-out Friday shrank the window to
 * two instead of reaching one week further back for a third real one. Two spare
 * reads, from a cache the dashboard shares, buys a full window through a bad
 * fortnight.
 */
const CANCELLED_ALLOWANCE = 2;

/**
 * How far back "has been to this gathering" reaches.
 *
 * The prediction only wants the last few nights — that is the point of it. The
 * roster's other question, "who belongs to this gathering at all", wants as much
 * as it can get: a student who came every week until Christmas is still one of
 * this gathering's students in February, and lumping them in with the four
 * hundred names a Planning Center sync brought along is exactly the uselessness
 * this window exists to fix.
 *
 * Twelve is a term of weekly gatherings, and it is bounded on both sides: it
 * costs twelve small parallel reads from a cache the dashboard already shares,
 * and the events themselves are already in memory (`DataProvider` holds 120
 * days), so nothing here reaches for a page of calendar that is not loaded.
 *
 * This is the read budget, not the rule. How far back participation *counts* is
 * `PARTICIPATION_MAX_AGE_DAYS`, enforced in `buildChainHistory` where it can be
 * stated once for every screen; whichever bound is tighter wins.
 */
const PARTICIPATION_WINDOW = 12;

/**
 * The past instances of an event's series that feed its predictive roster.
 * Returns event records only — attendance for them is loaded by
 * `useEventSnapshots`.
 *
 * Two windows are read out of the one list: the prediction takes the most recent
 * `predictiveOfLastN` of them, and the roster's "has been here before" filter
 * takes all of them. See `PARTICIPATION_WINDOW`.
 *
 * "Series" here means the repeat chain the event predicts from — its own for a
 * recurring gathering, and for a one-off the gathering a leader pointed it at.
 * A trip with nothing chosen loads nothing, by design: a retreat is not evidence
 * about who turns up to a retreat. See `lib/gatherings.ts`.
 */
/** One shared "no history", so an event with no chain answers identically every render. */
const NO_HISTORY: TallyEvent[] = [];

export function useSeriesHistoryEvents(event: TallyEvent | null): TallyEvent[] {
  const { events, settings } = useData();
  const now = useNow(60_000);

  /*
   * The clock is a dependency, but almost every tick picks exactly the same
   * instances — and a new array for the same instances is not a new answer.
   * Downstream, this array's identity decides whether `useEventSnapshots`
   * republishes and therefore whether the check-in screen rebuilds and repaints
   * its whole roster; without this, that happened once a minute for the entire
   * time a counselor had the screen open.
   */
  const last = useRef<TallyEvent[]>(NO_HISTORY);

  return useMemo(() => {
    const chain = event ? predictionChain(event) : null;
    if (!event || !chain) return NO_HISTORY;
    const instances = recentChainInstances(
      events,
      chain,
      now,
      Math.max(settings.predictiveOfLastN + CANCELLED_ALLOWANCE, PARTICIPATION_WINDOW),
    ).filter((instance) => instance.id !== event.id);

    if (!sameItems(last.current, instances)) last.current = instances;
    return last.current;
  }, [event, events, now, settings.predictiveOfLastN]);
}
