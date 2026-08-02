/**
 * Resolving one gathering by id, whether or not the calendar is holding it.
 *
 * `DataProvider` keeps a fixed window of events open — enough history to run
 * the predictive roster and the dashboard, and no more, because that array is
 * a live listener on every counselor's phone and is re-projected every minute.
 * That is the right shape for "what is on", and it is the wrong shape for the
 * question a URL asks: *this* night, named exactly, however long ago it was.
 *
 * The two were the same question for as long as Tally's own history was
 * younger than the window. Importing years of Check-Ins history separated
 * them: the Events tab pages the whole past out of Firestore and happily lists
 * a gathering from two years ago, and every screen those rows link to resolved
 * the id by scanning the window — so the link dead-ended on the chooser, which
 * reads to somebody pressing it as the app losing their tap.
 *
 * So a miss falls back to reading the one document by name. It is a listener
 * rather than a one-shot read because it costs the same and keeps the screen
 * honest: a leader looking at a night while somebody else cancels it should
 * see that happen, exactly as they would for a night inside the window.
 */
import { useEffect, useState } from 'react';
import { useData } from '@/context/dataContext';
import { subscribeEvent } from '@/services/events';
import type { TallyEvent } from '@/types';

export interface ResolvedEvent {
  /** The gathering, from the calendar or from its own document. */
  event: TallyEvent | null;
  /** True while there is still somewhere left to look. */
  loading: boolean;
  /**
   * True when this came from reading the document rather than from the loaded
   * calendar — which is the same thing as "older than the window".
   *
   * Callers use it to decide what they may honestly offer. The check-in screen
   * reads it as "no chain history is loaded around this night, so nothing here
   * can be predicted", and shows the night read-only instead.
   */
  fromArchive: boolean;
}

const MISSING: ResolvedEvent = { event: null, loading: false, fromArchive: false };

export function useEvent(eventId: string | null | undefined): ResolvedEvent {
  const { events, loading: calendarLoading } = useData();

  const loaded = eventId ? (events.find((event) => event.id === eventId) ?? null) : null;
  // The identity of `loaded` changes on every projection tick; only its
  // presence decides whether the fallback runs.
  const isLoaded = loaded !== null;

  const [archived, setArchived] = useState<TallyEvent | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    setArchived(null);

    // Nothing to look up, already have it, or the calendar has not finished
    // arriving — in the last case the id may be about to show up in it, and
    // opening a second listener for something already on its way is waste.
    if (!eventId || isLoaded || calendarLoading) {
      setReading(false);
      return;
    }

    setReading(true);
    let live = true;
    const stop = subscribeEvent(
      eventId,
      (next) => {
        if (!live) return;
        setArchived(next);
        setReading(false);
      },
      () => {
        // A refused or failed read is indistinguishable from a deleted night
        // to everything downstream, and both mean the same thing to the person
        // looking at it: this is not here. The screens say so.
        if (!live) return;
        setArchived(null);
        setReading(false);
      },
    );

    return () => {
      live = false;
      stop();
    };
  }, [eventId, isLoaded, calendarLoading]);

  if (!eventId) return MISSING;
  if (loaded) return { event: loaded, loading: false, fromArchive: false };

  return {
    event: archived,
    loading: calendarLoading || reading,
    fromArchive: archived !== null,
  };
}
