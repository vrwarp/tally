import { createContext, useContext } from 'react';
import type { RosterBackendStatus } from '@/services/functions';
import type {
  AppSettings,
  EventSeries,
  PcoErrorReport,
  PcoRosterPerson,
  Student,
  TallyEvent,
} from '@/types';

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
  settings: AppSettings;
  /** True until every stream has delivered its first snapshot. */
  loading: boolean;
  /** Set when a listener was rejected, usually by security rules. */
  error: string | null;

  /* ---- Roster ------------------------------------------------------------ */
  /** True while the roster is being read from Planning Center. */
  rosterLoading: boolean;
  /**
   * True once a read has finished — landed or failed — at least once.
   *
   * The distinction `rosterLoading` cannot draw on its own: it is equally true
   * of the first read, when there is nothing trustworthy on screen, and of the
   * revalidation fired on coming back to the tab, when there is. A screen that
   * holds its content behind a skeleton wants the first and not the second, or
   * it takes back a number the reader has already believed.
   */
  rosterSettled: boolean;
  /**
   * Set when Planning Center could not be reached. The roster may still hold
   * a copy from a previous session, so this is a warning rather than an empty
   * screen — `rosterOffline` says which.
   *
   * The whole report rather than a sentence, because the roster is the one read
   * whose failure looks *exactly* like success: no names came back, so the
   * screens draw an empty roster. Somebody has to be able to forward the status
   * code and the URL — see `@/components/RosterErrorBanner`.
   */
  rosterError: PcoErrorReport | null;
  /** True when what is on screen came from this device, not from the network. */
  rosterOffline: boolean;
  /** When the backends were last successfully read. */
  rosterFetchedAt: Date | null;
  /**
   * Each connected backend's own outcome of the last successful read. A read
   * can land with one backend down — its people carried from this device's
   * saved copy — and that is a different, smaller warning than `rosterError`,
   * which means the read as a whole failed. Empty until a read reports it,
   * and always empty against a server from before backends could fail apart.
   */
  rosterBackends: RosterBackendStatus[];
  /**
   * Asks for the roster again. `force` skips whatever the server is holding —
   * needed because that cache lives in one function instance, so clearing it
   * from here would only ever clear one of them.
   */
  refreshRoster: (force?: boolean) => Promise<void>;
  /**
   * Puts one Planning Center row into the roster, in place of re-reading it.
   *
   * For a screen that has just written to Planning Center and been handed the
   * finished row back — `updateStudentProfile` returns one. The alternative,
   * and what every such screen used to do, was `refreshRoster(true)`: a forced
   * sweep of every child in the church, paged and uncached, waited on with a
   * spinner over a modal, to learn one field the write had already confirmed.
   *
   * Not an optimistic update. Nothing is applied until the server has said the
   * write landed, and what is applied is the server's row rather than the
   * browser's guess at it — so this can only ever agree with the next read.
   *
   * Given nothing, or somebody the roster does not hold, it falls back to a
   * re-read in the background. That covers a person whose upstream record was
   * merged mid-edit, where the row comes back under the surviving id and there
   * is nothing here to match it to.
   */
  applyRosterPerson: (person?: PcoRosterPerson | null) => void;
}

export const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside <DataProvider>.');
  return value;
}
