import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { subscribeEventSeries, subscribeEvents, subscribeSettings } from '@/services/events';
import { subscribeEventAccess } from '@/services/eventAccess';
import { subscribeStudents } from '@/services/students';
import { cachedRoster, fetchRoster, mergeRoster, rememberRosterPerson } from '@/services/roster';
import { applyPendingEdits } from '@/features/roster/pendingEdits';
import { subscribeUpstreamEdits } from '@/services/upstreamEdits';
import type { RosterBackendStatus } from '@/services/functions';
import { fromRosterPerson } from '@/services/converters';
import { useNow } from '@/hooks/useNow';
import { calendarSignature, projectEvents } from '@/lib/eventProjection';
import { canWorkChain } from '@/lib/eventAccess';
import { chainKey } from '@/lib/materialize';
import { pcoErrorReport } from '@/lib/pcoErrors';
import { useAuth } from '@/context/authContext';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type EventAccess,
  type EventSeries,
  type PcoErrorReport,
  type PcoRosterPerson,
  type Student,
  type TallyEvent,
  type UpstreamEdit,
} from '@/types';
import { DataContext, type DataContextValue } from '@/context/dataContext';

/**
 * How much event history to keep in memory for prediction and the dashboard.
 *
 * A year, because that is what the roster's own rule already says: nothing older
 * than `PARTICIPATION_MAX_AGE_DAYS` counts as participation, and holding less
 * than that made the loader — rather than the rule — the thing deciding who
 * belongs to a gathering. The gap showed on any chain that does not meet weekly.
 * "Has been here before" reads the last `PARTICIPATION_WINDOW` instances of the
 * chain out of this list, and twelve fortnightly gatherings are 168 days while
 * twelve monthly ones are the whole year; both were silently cut down to
 * whatever happened to fall inside four months.
 *
 * The cost is counted in gatherings, not in students: four chains a week is a
 * couple of hundred small documents, and the per-minute re-projection over them
 * is already collapsed by `calendarSignature` on every tick that moves nothing.
 *
 * Anything older is still reachable — the Events tab pages the whole past with a
 * cursor, and `useEvent` resolves a single night by id — so this bounds what is
 * held live, not what can be opened.
 */
export const EVENT_WINDOW_DAYS = 365;

/**
 * How often the roster is re-read while the app is open.
 *
 * This is not the cache — that lives on the server and is measured in seconds.
 * This is "a counselor has had Tally open on the check-in screen for an hour and
 * somebody was added to Planning Center in the meantime".
 */
const ROSTER_REFRESH_MS = 10 * 60 * 1000;

/**
 * How recently the roster must have been read for coming back to the tab to
 * leave it alone.
 *
 * The visibility resync below is for a phone that has been in a pocket, not for
 * a counselor who flicked to their texts and back. Without a floor, every such
 * flick spent a Planning Center round-trip — and, because a read in flight is
 * what the insights screen waits on, blanked every tile on that screen on the
 * way out and filled it back in on the way home.
 */
const ROSTER_RESYNC_AFTER_MS = 60 * 1000;

/**
 * A cheap identity for a roster, so an unchanged one can be dropped.
 *
 * The provider paints from this device's saved copy immediately and then reads
 * Planning Center, which almost always returns exactly the same people. Setting
 * state anyway re-renders every screen and re-sorts the list a second or two
 * after it appeared — visible as a flicker, and worse than that on a slow
 * device: a counselor's thumb is already moving toward a row when it is
 * replaced, and Playwright sees the same thing as "element was detached from
 * the DOM".
 *
 * Every field the roster renders has to be in here, and the bug this comment
 * now exists for is what happens to one that is not. `birthday` was missing:
 * saving a birthday from the badge wrote it to Planning Center, re-read the
 * roster, found a snapshot this function called identical, and kept the old
 * array — so the screen behind the panel still said "no birthday" until
 * somebody reloaded the page. A field worth drawing is a field worth comparing.
 */
function rosterSignature(students: readonly Student[]): string {
  return students
    .map(
      (s) =>
        `${s.id}|${s.firstName}|${s.lastName}|${s.grade}|${s.status}|${s.profileComplete}|${s.hasAllergies}|${s.birthday}`,
    )
    .join('\n');
}

function describeRosterError(cause: unknown): string {
  const code = (cause as { code?: string })?.code ?? '';
  // The server's sentence already names which backend failed — "Planning
  // Center is rate-limiting us", "Could not reach Attendees to load the
  // roster" — which this side cannot know on its own.
  const said = (cause as { message?: string })?.message || null;
  if (code.includes('unauthenticated')) return 'Your session expired. Sign in again.';
  if (code.includes('permission-denied')) return 'Your access to Tally is not active.';
  if (code.includes('resource-exhausted')) {
    return said ?? 'The roster is being rate-limited upstream. It will refresh shortly.';
  }
  if (code.includes('failed-precondition')) {
    return said ?? 'No people backend is configured.';
  }
  if (code.includes('unavailable') && said) return said;
  return 'Could not reach the people backend for the roster.';
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
    ...pcoErrorReport(cause, 'Could not reach the people backend for the roster.'),
    message: describeRosterError(cause),
  };
}

/**
 * A cheap identity for the per-backend report, mirroring `rosterSignature`:
 * only what a screen would draw. `fetchedAt` is deliberately absent — every
 * fresh read restamps it, and restamping is not a change worth re-rendering
 * every consumer of the context for.
 */
function backendReportSignature(entries: readonly RosterBackendStatus[]): string {
  return entries
    .map((e) => `${e.backendId}|${e.ok}|${e.error ?? ''}|${e.people}|${e.unresolved}|${e.missing}`)
    .join('\n');
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { profile, can } = useAuth();
  /*
   * The rules refuse `upstreamEdits` to a counselor, so the listener is not
   * opened for one. Not a permission check standing in for the rules — those
   * are the fence — but the difference between a screen that never asks and one
   * that asks, is refused, and has to decide what to do about it.
   */
  const canReadEdits = can('core');
  const [documents, setDocuments] = useState<Student[]>([]);
  const [storedEvents, setStoredEvents] = useState<TallyEvent[]>([]);
  const [series, setSeries] = useState<EventSeries[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Seeded from this device so a cold start on bad signal draws names
  // immediately rather than an empty roster with a spinner over it.
  const [roster, setRoster] = useState<Student[]>(() => cachedRoster()?.students ?? []);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterSettled, setRosterSettled] = useState(false);
  const [rosterError, setRosterError] = useState<PcoErrorReport | null>(null);
  const [rosterOffline, setRosterOffline] = useState(() => cachedRoster() !== null);
  const [rosterFetchedAt, setRosterFetchedAt] = useState<Date | null>(null);
  const [rosterBackends, setRosterBackends] = useState<RosterBackendStatus[]>([]);

  const [access, setAccess] = useState<Map<string, EventAccess>>(() => new Map());

  const [ready, setReady] = useState({
    students: false,
    events: false,
    series: false,
    settings: false,
    access: false,
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
          setStoredEvents(next);
          markReady('events');
        },
        { sinceDaysAgo: EVENT_WINDOW_DAYS },
        fail('events'),
      ),

      subscribeEventSeries((next) => {
        setSeries(next);
        markReady('series');
      }, fail('series')),

      subscribeSettings((next) => {
        setSettings(next);
        markReady('settings');
      }, fail('settings')),

      subscribeEventAccess((next) => {
        setAccess(next);
        markReady('access');
      }, fail('access')),
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

  /**
   * When a read last finished, landed or failed, for the freshness floor above.
   *
   * A failed read counts: Planning Center being unreachable is not a reason to
   * ask it again every time the tab regains focus. Only the visibility resync
   * consults this — the ten-minute interval and the "Try again" button both call
   * `refreshRoster` directly, because both are already deliberate about when.
   */
  const lastAttemptAt = useRef(0);

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
      /*
       * Compared by instant rather than by identity, for the same reason the
       * signature above compares people rather than arrays.
       *
       * `fetchRoster` builds a new `Date` on every call, so setting this
       * unconditionally published a new context value — and re-rendered every
       * screen reading `useData` — even when the server had answered out of its
       * own cache with the very same timestamp. It made the signature check
       * pointless: the roster was correctly recognised as unchanged and then
       * announced as changed anyway, one line later, for a relative time on the
       * settings screen.
       */
      setRosterFetchedAt((current) =>
        current?.getTime() === snapshot.fetchedAt?.getTime() ? current : snapshot.fetchedAt,
      );
      // Same churn guard again: most reads report the same backends saying the
      // same thing, and that is not worth a context publish.
      const reported = snapshot.perBackend ?? [];
      setRosterBackends((current) =>
        backendReportSignature(current) === backendReportSignature(reported) ? current : reported,
      );
      setRosterOffline(false);
      setRosterError(null);
    } catch (cause) {
      // Deliberately not clearing `roster`: whatever is already on screen is
      // more useful than nothing, and `rosterOffline` says where it came from.
      setRosterError(rosterErrorReport(cause));
      setRosterOffline(true);
    } finally {
      inFlight.current = false;
      lastAttemptAt.current = Date.now();
      setRosterLoading(false);
      setRosterSettled(true);

      const queued = pending.current;
      pending.current = null;
      if (queued) void refreshRoster(queued.force);
    }
  }, []);

  /**
   * The roster as last committed, for `applyRosterPerson` to look somebody up
   * in without the callback having to be rebuilt — and every consumer of the
   * context re-rendered — on every read that lands.
   */
  const held = useRef<Student[]>(roster);
  useEffect(() => {
    held.current = roster;
  }, [roster]);

  const applyRosterPerson = useCallback(
    (person?: PcoRosterPerson | null) => {
      if (!person || !held.current.some((student) => student.pcoPersonId === person.pcoPersonId)) {
        // Nothing here answers to them, so there is nothing to correct in
        // place. Not awaited: the caller has its confirmation already, and the
        // point of this whole path is that a write does not wait on a read.
        void refreshRoster(true);
        return;
      }

      const row = fromRosterPerson(person, new Date());
      setRoster((current) =>
        current.map((student) => (student.pcoPersonId === person.pcoPersonId ? row : student)),
      );
      // And on this device, so a reload does not paint the row as it was.
      rememberRosterPerson(person);
    },
    [refreshRoster],
  );

  useEffect(() => {
    void refreshRoster();

    const timer = setInterval(() => void refreshRoster(), ROSTER_REFRESH_MS);

    // Coming back to a phone that has been in a pocket is the moment the roster
    // is most likely to be stale and most likely to matter.
    const resync = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastAttemptAt.current < ROSTER_RESYNC_AFTER_MS) return;
      void refreshRoster();
    };
    document.addEventListener('visibilitychange', resync);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [refreshRoster]);

  /* ---- Profile edits on their way upstream ------------------------------- */

  /*
   * A live stream, unlike the roster beside it, because this is the one thing
   * on these screens that changes without anybody on this device doing
   * anything: a job queued on a phone in a corridor lands from a server, and
   * the laptop watching the same student has to stop saying "sending".
   *
   * Small by construction — everything in flight, plus failures nobody has
   * resolved, plus a couple of minutes of freshly-landed ones. A ministry that
   * has never had a failure holds a handful of documents. It is also core-team
   * only at the rules, so a counselor's listener is never opened at all.
   */
  const [upstreamEdits, setUpstreamEdits] = useState<UpstreamEdit[]>([]);

  useEffect(() => {
    if (!canReadEdits) {
      setUpstreamEdits([]);
      return;
    }
    return subscribeUpstreamEdits(setUpstreamEdits, () => {
      // Deliberately quiet. The queue is an aid to somebody already editing;
      // a listener the rules refuse must not put an error banner in front of a
      // leader who was doing something else entirely.
      setUpstreamEdits([]);
    });
  }, [canReadEdits]);

  /*
   * The overlay is applied *after* the merge, so identity is settled before
   * anything is painted over it: `mergeRoster` decides which document and which
   * backend row are the same person, and only then does a job get to say what
   * somebody is in the middle of changing about them.
   */
  const students = useMemo(
    () => applyPendingEdits(mergeRoster(roster, documents), upstreamEdits),
    [roster, documents, upstreamEdits],
  );

  /* ---- The calendar ------------------------------------------------------ */

  /*
   * Documents plus the gatherings the recurrence rules describe.
   *
   * Done once here rather than in each screen so that everything downstream —
   * Upcoming, the dashboard, temporal awareness, check-in — keeps reading one
   * list of events and never has to know which half a gathering came from.
   *
   * The clock is what makes a projection possible at all: a rule has no end, so
   * "what is on" is only a question relative to a moment. A minute is finer
   * than any boundary this decides.
   */
  const now = useNow(60_000);
  const lastCalendar = useRef<{ signature: string; events: TallyEvent[] } | null>(null);

  const events = useMemo(() => {
    const projected = projectEvents(storedEvents, now);

    // Almost every tick projects exactly the same gatherings, and handing back
    // a new array anyway re-renders every screen in the app once a minute.
    const signature = calendarSignature(projected);
    if (lastCalendar.current?.signature === signature) return lastCalendar.current.events;

    lastCalendar.current = { signature, events: projected };
    return projected;
  }, [storedEvents, now]);

  const loading = !Object.values(ready).every(Boolean);

  /**
   * Whether the signed-in person may work a gathering.
   *
   * Keyed on the chain rather than the night, because most nights on the
   * calendar are projected and have no document of their own — `chainKey` is
   * already what the app means by "the same gathering" everywhere else.
   *
   * **Fails open when the access stream is broken**, and that is a decision
   * rather than an oversight. If this collection cannot be read, the honest
   * options are to hide every gathering or to show every gathering; hiding
   * gives a counselor at a door an empty screen, which is the failure this
   * whole feature is shaped to avoid, and showing gives them a locked screen at
   * worst. The rules refuse the reads and writes either way, so nothing is
   * protected by guessing here — the client is a courtesy, not the fence.
   */
  const canWork = useCallback(
    (event: Pick<TallyEvent, 'id' | 'seriesId' | 'recurrenceRootId'>) =>
      canWorkChain(access.get(chainKey(event)), profile?.id ?? '', can('admin')),
    [access, profile?.id, can],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      students,
      events,
      series,
      settings,
      access,
      canWork,
      loading,
      error,
      rosterLoading,
      rosterSettled,
      rosterError,
      rosterOffline,
      rosterFetchedAt,
      rosterBackends,
      refreshRoster,
      applyRosterPerson,
      upstreamEdits,
    }),
    [
      students,
      events,
      series,
      settings,
      access,
      canWork,
      loading,
      error,
      rosterLoading,
      rosterSettled,
      rosterError,
      rosterOffline,
      rosterFetchedAt,
      rosterBackends,
      refreshRoster,
      applyRosterPerson,
      upstreamEdits,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
