import { createContext, useContext } from 'react';
import type { AppSettings, EventSeries, SmallGroup, Student, TallyEvent } from '@/types';

/**
 * App-wide live data.
 *
 * These four collections are small, needed on nearly every screen, and change
 * rarely — so Tally opens exactly one `onSnapshot` listener for each at the
 * root instead of re-subscribing per screen. Per-event attendance and RSVPs are
 * deliberately *not* here: those are hot, scoped to one event, and torn down
 * when the counselor leaves it.
 */
export interface DataContextValue {
  students: Student[];
  events: TallyEvent[];
  series: EventSeries[];
  groups: SmallGroup[];
  settings: AppSettings;
  /** True until every stream has delivered its first snapshot. */
  loading: boolean;
  /** Set when a listener was rejected, usually by security rules. */
  error: string | null;
}

export const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside <DataProvider>.');
  return value;
}
