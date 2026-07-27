/**
 * Gatherings — the chains of repeats a prediction can come from, and which one
 * a given event reads.
 *
 * `chainKey` in `lib/materialize.ts` answers "which chain is this event *in*",
 * which is a fact about the calendar and is shared with the Cloud Functions.
 * This module answers the two questions that are only about the roster: which
 * chain an event *predicts from*, and which chains a leader may point a trip at.
 * They are the same answer for a weekly gathering and deliberately not for a
 * one-off — see `predictFromChain` on `TallyEventDoc`.
 */
import { chainKey } from '@/lib/materialize';
import type { EventSeries, TallyEvent } from '@/types';

/**
 * The chain whose past instances predict this event's roster, or null when
 * nothing does.
 *
 * A recurring gathering reads its own chain: every Friday under one series (or
 * one recurrence root) is the same gathering, and the last few of them are what
 * "Recent" means. A one-off has no chain of its own to read, so it reads the one
 * a leader pointed it at, and nothing at all when they pointed it at nothing.
 */
export function predictionChain(
  event: Pick<TallyEvent, 'id' | 'mode' | 'seriesId' | 'recurrenceRootId' | 'predictFromChain'>,
): string | null {
  if (event.mode === 'oneoff') return event.predictFromChain;
  return chainKey(event);
}

/** One recurring gathering, as something to pick from a list. */
export interface GatheringOption {
  /** Its `chainKey` — what `predictFromChain` stores. */
  key: string;
  title: string;
  /**
   * The latest instance loaded, which is what the list is ordered by. Possibly
   * one still ahead: the calendar reaches forward as well as back, and a
   * gathering with a Friday booked is a live one.
   */
  lastStartAt: Date;
}

/**
 * The recurring gatherings present in `events`, one entry per chain.
 *
 * The list a trip picks its regulars from. Ordered by most recently active, so
 * the Friday that met last week is above the small group that stopped in March —
 * and titled from the series document when there is one, so renaming a series
 * renames it here, exactly as on the insights screen.
 *
 * Built from the events already loaded rather than from `eventSeries`, because a
 * series document is not where gatherings come from: nothing in the app creates
 * one, and a weekly gathering scheduled by a leader has a recurrence root and no
 * series at all. Listing series alone would offer the two seeded chains and hide
 * every gathering the ministry has actually added since.
 */
export function gatheringOptions(
  events: readonly TallyEvent[],
  series: readonly EventSeries[] = [],
): GatheringOption[] {
  const seriesTitles = new Map(series.map((entry) => [entry.id, entry.title]));
  const found = new Map<string, GatheringOption>();

  for (const event of events) {
    if (event.mode !== 'recurring') continue;

    const key = chainKey(event);
    const existing = found.get(key);
    // The latest instance names the chain, for the reason the projection takes
    // its template from there: a gathering that was renamed is called what it is
    // called now, not what it was called in March.
    if (existing && existing.lastStartAt >= event.startAt) continue;

    found.set(key, {
      key,
      title: (event.seriesId ? seriesTitles.get(event.seriesId) : undefined) ?? event.title,
      lastStartAt: event.startAt,
    });
  }

  return [...found.values()].sort((a, b) => b.lastStartAt.getTime() - a.lastStartAt.getTime());
}
