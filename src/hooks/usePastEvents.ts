/**
 * Gatherings that have already happened, a page at a time.
 *
 * The rest of the app reads one calendar — `DataProvider` keeps a bounded
 * window of documents open and projects the recurrence rules over it — and that
 * is the right shape for every screen that asks "what is on". It is the wrong
 * shape for "what happened": the window ends at a fixed number of days, which
 * is exactly the boundary somebody scrolling back through a ministry's history
 * is trying to cross.
 *
 * So this reads its own pages, straight from Firestore, and owns them. Nothing
 * here is live — a Friday from March is not going to change while somebody
 * scrolls past it, and a listener per page would be a listener per page
 * forever.
 *
 * Deduplicated against the ids already held rather than trusted to the cursor.
 * Firestore's own cursor is exact, but a page can arrive twice — React 18's
 * development double-effect does it on the first render alone — and a duplicate
 * key in a list of gatherings is a React warning followed by two identical rows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPastEvents,
  PAST_EVENTS_PAGE_SIZE,
  type PastEventsCursor,
} from '@/services/events';
import type { TallyEvent } from '@/types';

export interface PastEventsResult {
  events: TallyEvent[];
  /** True while a page is in flight, including the first one. */
  loading: boolean;
  /** False once the collection is exhausted. */
  hasMore: boolean;
  error: string | null;
  /** Asks for the next page. A no-op while one is already in flight. */
  loadMore: () => void;
  /** Re-reads from the top. For the retry button on a failed page. */
  retry: () => void;
}

/**
 * @param before Where history starts — everything strictly earlier than this.
 *   Read once and then held; see the note on the boundary below.
 */
export function usePastEvents(before: Date, pageSize = PAST_EVENTS_PAGE_SIZE): PastEventsResult {
  const [events, setEvents] = useState<TallyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /*
   * The cursor lives in a ref rather than in state.
   *
   * It is not rendered, and putting it in state would make `loadMore` change
   * identity on every page — which is the callback the scroll sentinel's
   * IntersectionObserver is subscribed to, so the observer would be torn down
   * and rebuilt each time and fire again immediately on the element it is
   * already watching.
   */
  const cursor = useRef<PastEventsCursor | null>(null);
  const inFlight = useRef(false);
  // Stryker disable next-line BooleanLiteral: the mount effect calls `load(true)`,
  // whose reset block assigns this before anything reads it — so no test can
  // distinguish the two initial values, and none should have to pretend it can.
  const exhausted = useRef(false);

  /*
   * Where "the past" starts, frozen for as long as the pages last.
   *
   * `before` is derived from a ticking clock, and a bound that crept forward
   * between pages would eventually hand back a gathering that had slipped into
   * the past *underneath* one already on screen — the classic paging duplicate.
   * The caller's latest value is kept beside it and picked up on a reset, so a
   * retry reads from a fresh boundary rather than from a stale one.
   */
  const latest = useRef(before);
  latest.current = before;
  const boundary = useRef(before);

  const load = useCallback(
    async (reset: boolean) => {
      if (inFlight.current) return;
      if (!reset && exhausted.current) return;

      inFlight.current = true;
      if (reset) {
        cursor.current = null;
        exhausted.current = false;
        boundary.current = latest.current;
      }
      setLoading(true);

      try {
        const page = await fetchPastEvents(boundary.current, reset ? null : cursor.current, pageSize);
        cursor.current = page.cursor;
        exhausted.current = !page.hasMore;

        setEvents((current) => {
          const base = reset ? [] : current;
          const seen = new Set(base.map((event) => event.id));
          return [...base, ...page.events.filter((event) => !seen.has(event.id))];
        });
        setHasMore(page.hasMore);
        setError(null);
      } catch {
        // The cursor is left where it was, so a retry asks for the same page
        // rather than skipping one.
        setError('Could not load older gatherings.');
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [pageSize],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const loadMore = useCallback(() => {
    if (error) return;
    void load(false);
  }, [load, error]);

  const retry = useCallback(() => {
    setError(null);
    void load(false);
  }, [load]);

  return { events, loading, hasMore, error, loadMore, retry };
}
