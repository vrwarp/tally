import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  subscribeEventSeries,
  subscribeEvents,
  subscribeSettings,
  subscribeSmallGroups,
} from '@/services/events';
import { subscribeStudents } from '@/services/students';
import { cachedRoster, fetchRoster, mergeRoster } from '@/services/roster';
import { pcoErrorReport } from '@/lib/pcoErrors';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type EventSeries,
  type PcoErrorReport,
  type SmallGroup,
  type Student,
  type TallyEvent,
} from '@/types';
import { DataContext, type DataContextValue } from '@/context/dataContext';

/** How much event history to keep in memory for prediction and the dashboard. */
const EVENT_WINDOW_DAYS = 120;

/**
 * How often the roster is re-read while the app is open.
 *
 * This is not the cache — that lives on the server and is measured in seconds.
 * This is "a counselor has had Tally open on the check-in screen for an hour and
 * somebody was added to Planning Center in the meantime".
 */
const ROSTER_REFRESH_MS = 10 * 60 * 1000;

/**
 * A cheap identity for a roster, so an unchanged one can be dropped.
 *
 * The provider paints from this device's saved copy immediately and then reads
 * Planning Center, which almost always returns exactly the same people. Setting
 * state anyway re-renders every screen and re-sorts the list a second or two
 * after it appeared — visible as a flicker, and worse than that on a slow
 * device: a counselor's thumb is already moving toward a row when it is
 * replaced, and Playwright sees the same thing as "element was detached from
 * the DOM". Only the fields the roster renders are compared; anything else
 * changing would not be visible anyway.
 */
function rosterSignature(students: readonly Student[]): string {
  return students
    .map((s) => `${s.id}|${s.firstName}|${s.lastName}|${s.grade}|${s.status}|${s.profileComplete}|${s.hasAllergies}`)
    .join('\n');
}

function describeRosterError(cause: unknown): string {
  const code = (cause as { code?: string })?.code ?? '';
  if (code.includes('unauthenticated')) return 'Your session expired. Sign in again.';
  if (code.includes('permission-denied')) return 'Your access to Tally is not active.';
  if (code.includes('resource-exhausted')) {
    return 'Planning Center is rate-limiting us. The roster will refresh shortly.';
  }
  if (code.includes('failed-precondition')) {
    return (cause as { message?: string })?.message ?? 'Planning Center is not configured.';
  }
  return 'Could not reach Planning Center for the roster.';
}

/**
 * The failure, in a form a screen can both state and forward.
 *
 * `message` is this module's sentence rather than the callable's, because the
 * sentence a counselor needs depends on which failure it was and the server
 * cannot know that it is answering a roster read. The developer-facing message
 * is not lost — `pcoErrorReport` keeps it, and the details panel shows it under
 * "Underlying error".
 */
function rosterErrorReport(cause: unknown): PcoErrorReport {
  return {
    ...pcoErrorReport(cause, 'Could not reach Planning Center for the roster.'),
    message: describeRosterError(cause),
  };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<Student[]>([]);
  const [events, setEvents] = useState<TallyEvent[]>([]);
  const [series, setSeries] = useState<EventSeries[]>([]);
  const [groups, setGroups] = useState<SmallGroup[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Seeded from this device so a cold start on bad signal draws names
  // immediately rather than an empty roster with a spinner over it.
  const [roster, setRoster] = useState<Student[]>(() => cachedRoster()?.students ?? []);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState<PcoErrorReport | null>(null);
  const [rosterOffline, setRosterOffline] = useState(() => cachedRoster() !== null);
  const [rosterFetchedAt, setRosterFetchedAt] = useState<Date | null>(null);

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
        setDocuments(next);
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

  /* ---- The roster -------------------------------------------------------- */

  const inFlight = useRef(false);
  /**
   * A refresh asked for while another was running.
   *
   * Collapsing concurrent reads is right — two screens mounting at once must
   * not become two Planning Center reads — but *dropping* the second one is
   * not, and the difference only became visible once the roster gained an
   * "add this student" button. The read already in flight was issued before
   * the student existed, so answering with it means the person who just
   * pressed Add watches nothing happen. One more read, after this one, is the
   * whole fix.
   */
  const pending = useRef<{ force: boolean } | null>(null);

  const refreshRoster = useCallback(async (force = false) => {
    if (inFlight.current) {
      // `force` is sticky: a deliberate refresh must not be downgraded by an
      // incidental one that happened to arrive alongside it.
      pending.current = { force: force || (pending.current?.force ?? false) };
      return;
    }
    inFlight.current = true;
    setRosterLoading(true);

    try {
      const snapshot = await fetchRoster(new Date(), force);
      setRoster((current) =>
        rosterSignature(current) === rosterSignature(snapshot.students) ? current : snapshot.students,
      );
      setRosterFetchedAt(snapshot.fetchedAt);
      setRosterOffline(false);
      setRosterError(null);
    } catch (cause) {
      // Deliberately not clearing `roster`: whatever is already on screen is
      // more useful than nothing, and `rosterOffline` says where it came from.
      setRosterError(rosterErrorReport(cause));
      setRosterOffline(true);
    } finally {
      inFlight.current = false;
      setRosterLoading(false);

      const queued = pending.current;
      pending.current = null;
      if (queued) void refreshRoster(queued.force);
    }
  }, []);

  useEffect(() => {
    void refreshRoster();

    const timer = setInterval(() => void refreshRoster(), ROSTER_REFRESH_MS);

    // Coming back to a phone that has been in a pocket is the moment the roster
    // is most likely to be stale and most likely to matter.
    const resync = () => {
      if (document.visibilityState === 'visible') void refreshRoster();
    };
    document.addEventListener('visibilitychange', resync);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [refreshRoster]);

  const students = useMemo(() => mergeRoster(roster, documents), [roster, documents]);

  const loading = !Object.values(ready).every(Boolean);

  const value = useMemo<DataContextValue>(
    () => ({
      students,
      events,
      series,
      groups,
      settings,
      loading,
      error,
      rosterLoading,
      rosterError,
      rosterOffline,
      rosterFetchedAt,
      refreshRoster,
    }),
    [
      students,
      events,
      series,
      groups,
      settings,
      loading,
      error,
      rosterLoading,
      rosterError,
      rosterOffline,
      rosterFetchedAt,
      refreshRoster,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
