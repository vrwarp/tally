import { useMemo } from 'react';
import { useData } from '@/context/dataContext';
import { useNow } from '@/hooks/useNow';
import { pickActiveEvent, recentSeriesInstances } from '@/lib/time';
import type { TallyEvent } from '@/types';

export interface ActiveEventResult {
  /** The event to check into, honouring an explicit override. */
  event: TallyEvent | null;
  /** What temporal awareness alone would have chosen. */
  autoEvent: TallyEvent | null;
  /** True when the counselor overrode the automatic choice. */
  isOverridden: boolean;
  /** Ticking clock the selection was made against. */
  now: Date;
  /** Events a counselor may reasonably switch to: recent past plus upcoming. */
  selectableEvents: TallyEvent[];
}

/**
 * Resolves which event the counselor is checking into (PRD 4.3).
 *
 * Automatic by default — nobody should have to pick "Friday Fellowship" on a
 * Friday night — with an explicit override for the cases automation cannot
 * know about, like taking attendance for last week after the fact.
 */
export function useActiveEvent(eventIdOverride?: string | null): ActiveEventResult {
  const { events } = useData();
  const now = useNow();

  return useMemo(() => {
    const autoEvent = pickActiveEvent(events, now);

    const override = eventIdOverride
      ? (events.find((event) => event.id === eventIdOverride) ?? null)
      : null;

    // Anything from the last month plus everything still ahead: enough to
    // back-fill a missed Sunday without scrolling through a year.
    const monthAgo = new Date(now.getTime() - 31 * 86_400_000);
    const selectableEvents = events
      .filter((event) => event.status !== 'cancelled' && event.startAt >= monthAgo)
      .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

    return {
      event: override ?? autoEvent,
      autoEvent,
      isOverridden: Boolean(override) && override?.id !== autoEvent?.id,
      now,
      selectableEvents,
    };
  }, [events, now, eventIdOverride]);
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
 */
export function useSeriesHistoryEvents(event: TallyEvent | null): TallyEvent[] {
  const { events, settings } = useData();
  const now = useNow(60_000);

  return useMemo(() => {
    if (!event?.seriesId) return [];
    return recentSeriesInstances(
      events,
      event.seriesId,
      now,
      settings.predictiveOfLastN + CANCELLED_ALLOWANCE,
    ).filter((instance) => instance.id !== event.id);
  }, [event, events, now, settings.predictiveOfLastN]);
}
