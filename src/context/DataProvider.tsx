import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  subscribeEventSeries,
  subscribeEvents,
  subscribeSettings,
  subscribeSmallGroups,
} from '@/services/events';
import { subscribeStudents } from '@/services/students';
import { DEFAULT_SETTINGS, type AppSettings, type EventSeries, type SmallGroup, type Student, type TallyEvent } from '@/types';
import { DataContext, type DataContextValue } from '@/context/dataContext';

/** How much event history to keep in memory for prediction and the dashboard. */
const EVENT_WINDOW_DAYS = 120;

export function DataProvider({ children }: { children: ReactNode }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [events, setEvents] = useState<TallyEvent[]>([]);
  const [series, setSeries] = useState<EventSeries[]>([]);
  const [groups, setGroups] = useState<SmallGroup[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState({
    students: false,
    events: false,
    series: false,
    groups: false,
    settings: false,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const markReady = (key: keyof typeof ready) =>
      setReady((current) => (current[key] ? current : { ...current, [key]: true }));

    const fail = (label: string) => (cause: Error) => {
      setError(`Could not load ${label}: ${cause.message}`);
      // Still mark ready — a permanently blocked stream must not wedge the app
      // behind a spinner forever.
      markReady(label as keyof typeof ready);
    };

    const unsubscribers = [
      subscribeStudents((next) => {
        setStudents(next);
        markReady('students');
      }, fail('students')),

      subscribeEvents(
        (next) => {
          setEvents(next);
          markReady('events');
        },
        { sinceDaysAgo: EVENT_WINDOW_DAYS },
        fail('events'),
      ),

      subscribeEventSeries((next) => {
        setSeries(next);
        markReady('series');
      }, fail('series')),

      subscribeSmallGroups((next) => {
        setGroups(next);
        markReady('groups');
      }, fail('groups')),

      subscribeSettings((next) => {
        setSettings(next);
        markReady('settings');
      }, fail('settings')),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const loading = !Object.values(ready).every(Boolean);

  const value = useMemo<DataContextValue>(
    () => ({ students, events, series, groups, settings, loading, error }),
    [students, events, series, groups, settings, loading, error],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
