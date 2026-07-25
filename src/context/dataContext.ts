import { createContext, useContext } from 'react';
import type { AppSettings, EventSeries, SmallGroup, Student, TallyEvent } from '@/types';

/**
 * App-wide live data.
 *
 * The Firestore collections here are small, needed on nearly every screen, and
 * change rarely — so Tally opens exactly one `onSnapshot` listener for each at
 * the root instead of re-subscribing per screen. Per-event attendance and RSVPs
 * are deliberately *not* here: those are hot, scoped to one event, and torn
 * down when the counselor leaves it.
 *
 * `students` is the odd one out and worth reading carefully. It is not a
 * Firestore collection: it is the Planning Center roster, read on demand, with
 * Tally's own student documents merged on top. It therefore does not stream —
 * it is fetched, and `refreshRoster` is how a screen asks for it again.
 */
export interface DataContextValue {
  /** The Planning Center roster merged with Tally's own documents. */
  students: Student[];
  events: TallyEvent[];
  series: EventSeries[];
  groups: SmallGroup[];
  settings: AppSettings;
  /** True until every stream has delivered its first snapshot. */
  loading: boolean;
  /** Set when a listener was rejected, usually by security rules. */
  error: string | null;

  /* ---- Roster ------------------------------------------------------------ */
  /** True while the roster is being read from Planning Center. */
  rosterLoading: boolean;
  /**
   * Set when Planning Center could not be reached. The roster may still hold
   * a copy from a previous session, so this is a warning rather than an empty
   * screen — `rosterOffline` says which.
   */
  rosterError: string | null;
  /** True when what is on screen came from this device, not from the network. */
  rosterOffline: boolean;
  /** When Planning Center was last successfully read. */
  rosterFetchedAt: Date | null;
  /**
   * Asks for the roster again. `force` skips whatever the server is holding —
   * needed because that cache lives in one function instance, so clearing it
   * from here would only ever clear one of them.
   */
  refreshRoster: (force?: boolean) => Promise<void>;
}

export const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside <DataProvider>.');
  return value;
}
