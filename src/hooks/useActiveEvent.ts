import { useMemo } from 'react';
import { useData } from '@/context/dataContext';
import { useNow } from '@/hooks/useNow';
import { chainKey } from '@/lib/materialize';
import { pickActiveEvent, recentChainInstances } from '@/lib/time';
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
 * The past instances of an event's series that feed its predictive roster.
 * Returns event records only — attendance for them is loaded by
 * `useEventSnapshots`.
 *
 * "Series" here means the repeat chain (`chainKey`), which is the series
 * document when there is one and the recurrence root otherwise. A one-off has
 * neither and predicts from nothing, by design: a retreat is not evidence about
 * who turns up to a retreat.
 */
export function useSeriesHistoryEvents(event: TallyEvent | null): TallyEvent[] {
  const { events, settings } = useData();
  const now = useNow(60_000);

  return useMemo(() => {
    if (!event || event.mode === 'oneoff') return [];
    return recentChainInstances(
      events,
      chainKey(event),
      now,
      settings.predictiveOfLastN + CANCELLED_ALLOWANCE,
    ).filter((instance) => instance.id !== event.id);
  }, [event, events, now, settings.predictiveOfLastN]);
}
