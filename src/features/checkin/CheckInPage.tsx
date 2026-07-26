/**
 * The check-in screen — the reason Tally exists.
 *
 * Everything here serves one number: under three seconds per student, thumb
 * only, in a noisy hallway. That budget is why the roster is derived in memory
 * from listeners that are already open, why a tap paints and buzzes before the
 * network is consulted, and why undo is a second tap rather than a dialog.
 *
 * The live check-in state is *never* mirrored in component state. Firestore's
 * local cache echoes a write back through `useAttendance` within a frame, so the
 * onSnapshot stream is the only source of truth for who is present — which is
 * also what keeps two counselors' phones agreeing with each other. The one piece
 * of local state, `flashing`, exists purely to drive an animation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RosterErrorBanner } from '@/components/RosterErrorBanner';
import { EmptyState, ErrorBanner, SkeletonRows } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { EventHeader } from '@/features/checkin/EventHeader';
import { NoActiveEvent } from '@/features/checkin/NoActiveEvent';
import { QuickAddVisitorModal } from '@/features/checkin/QuickAddVisitorModal';
import { RosterList } from '@/features/checkin/RosterList';
import { ScopeBar } from '@/features/checkin/ScopeBar';
import { SearchBar } from '@/features/checkin/SearchBar';
import { buildRoster, type RosterFocus } from '@/features/roster/predictiveRoster';
import { useActiveEvent, useSeriesHistoryEvents } from '@/hooks/useActiveEvent';
import { useAttendance, useRsvps } from '@/hooks/useAttendance';
import { invalidateSnapshotCache, useEventSnapshots } from '@/hooks/useEventSnapshots';
import { haptic } from '@/lib/utils';
import { checkIn, undoCheckIn } from '@/services/attendance';
import { studentFullName, type Grade, type RosterEntry } from '@/types';

/** Long enough to register as confirmation, short enough not to lag the queue. */
const FLASH_MS = 700;

/** What the one list is called, given the filter currently applied to it. */
const FOCUS_TITLE: Record<RosterFocus, string> = {
  all: "Roster",
  recent: "Recent",
  checkedIn: "Checked in",
};

const FOCUS_EMPTY: Record<RosterFocus, string> = {
  all: "Nobody matches these filters.",
  recent: "No regulars on this roster yet.",
  checkedIn: "Nobody is checked in yet.",
};

export function CheckInPage() {
  const { eventId } = useParams();
  const { event, autoEvent, isOverridden, now, selectableEvents } =
    useActiveEvent(eventId ?? null);

  const { students, groups, settings, loading: dataLoading, rosterError } = useData();
  const { profile, user } = useAuth();
  const { show } = useToast();

  const { attendance, error: attendanceError } = useAttendance(
    event?.id ?? null,
  );
  const { rsvps } = useRsvps(event?.id ?? null, event?.requiresRsvp ?? false);
  const historyEvents = useSeriesHistoryEvents(event);
  const { snapshots } = useEventSnapshots(historyEvents);

  const [query, setQuery] = useState("");
  const [grades, setGrades] = useState<readonly Grade[]>(() => []);
  // The screen opens on the regulars, because on a recurring gathering they are
  // most of the taps. `buildRoster` quietly downgrades this to the whole roster
  // whenever the prediction has nothing to say, so a one-off trip or a brand-new
  // series never opens on an empty list.
  const [focus, setFocus] = useState<RosterFocus>("recent");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const [flashing, setFlashing] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const flashTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Guarding on a ref rather than on `pending` keeps the tap handler out of the
  // render cycle: a second tap is rejected even before React re-renders.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  /* ---- Scope (Journey 2) ------------------------------------------------- */

  // Sunday School opens on the counselor's own group; everything else opens on
  // everyone. Derived from the event id rather than stored in an effect so that
  // switching events cannot leave a previous event's scope behind.
  const defaultScopeGroupId =
    event?.mode === "recurring" && event.defaultGroupingMode === "smallGroup"
      ? (profile?.assignedGroupId ?? null)
      : null;
  const [scopeOverride, setScopeOverride] = useState<{
    eventId: string;
    groupId: string | null;
  } | null>(null);
  const scopeGroupId =
    scopeOverride && scopeOverride.eventId === event?.id
      ? scopeOverride.groupId
      : defaultScopeGroupId;
  const group =
    groups.find((candidate) => candidate.id === scopeGroupId) ?? null;

  const handleScopeChange = useCallback(
    (groupId: string | null) => {
      if (!event) return;
      setScopeOverride({ eventId: event.id, groupId });
    },
    [event],
  );

  /* ---- The roster -------------------------------------------------------- */

  const roster = useMemo(() => {
    if (!event) return null;
    return buildRoster({
      event,
      students,
      attendance,
      rsvps,
      history: snapshots,
      settings,
      filters: { query, grades, focus },
      group,
    });
  }, [
    event,
    students,
    attendance,
    rsvps,
    snapshots,
    settings,
    query,
    grades,
    focus,
    group,
  ]);

  /* ---- The tap ----------------------------------------------------------- */

  const flash = useCallback((studentId: string) => {
    setFlashing((current) => new Set(current).add(studentId));
    const existing = flashTimers.current.get(studentId);
    if (existing) clearTimeout(existing);
    flashTimers.current.set(
      studentId,
      setTimeout(() => {
        flashTimers.current.delete(studentId);
        setFlashing((current) => {
          const next = new Set(current);
          next.delete(studentId);
          return next;
        });
      }, FLASH_MS),
    );
  }, []);

  const setBusy = useCallback((studentId: string, busy: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (busy) next.add(studentId);
      else next.delete(studentId);
      return next;
    });
  }, []);

  /**
   * Attendance history is read once and memoised for the session, so back-filling
   * a gathering that already finished has to drop the cached answer for it.
   *
   * That matters most for the night this is usually used on: a gathering with no
   * attendance is read everywhere as cancelled, and somebody taking the register
   * for last Friday after the fact should see the dashboard agree without a
   * reload. Live events are untouched — their attendance comes from a listener.
   */
  const forgetCachedHistory = useCallback(() => {
    if (event && event.checkInClosesAt < new Date()) invalidateSnapshotCache(event.id);
  }, [event]);

  const handlePress = useCallback(
    async (entry: RosterEntry) => {
      if (!event || !user) return;
      const studentId = entry.student.id;
      if (inFlight.current.has(studentId)) return;

      const name = studentFullName(entry.student);
      inFlight.current.add(studentId);
      setBusy(studentId, true);

      try {
        if (entry.attendance) {
          // No confirm dialog: a mistaken undo costs one more tap, whereas a
          // modal costs every counselor a beat on every correction.
          await undoCheckIn(event.id, studentId);
          setAnnouncement(`${name} removed`);
          show(`Undid ${name}`, { tone: "info" });
        } else {
          // Paint and buzz first — the confirmation must land on the tap, not on
          // the round trip.
          haptic();
          flash(studentId);
          setAnnouncement(`${name} checked in`);
          await checkIn({
            event,
            student: entry.student,
            uid: user.uid,
            method: query.trim() ? "search" : "tap",
          });
        }
      } catch {
        const failure = entry.attendance
          ? `Could not undo ${name}. Try again.`
          : `Could not check in ${name}. Try again.`;
        setAnnouncement(failure);
        show(failure, { tone: "error" });
      } finally {
        forgetCachedHistory();
        inFlight.current.delete(studentId);
        setBusy(studentId, false);
      }
    },
    [event, user, query, flash, setBusy, show, forgetCachedHistory],
  );

  const onPress = useCallback(
    (entry: RosterEntry) => {
      void handlePress(entry);
    },
    [handlePress],
  );

  /* ---- Render ------------------------------------------------------------ */

  if (!event || !roster) {
    if (dataLoading) {
      return (
        <div className="min-h-0 flex-1 pt-3">
          <SkeletonRows />
        </div>
      );
    }
    return <NoActiveEvent events={selectableEvents} now={now} />;
  }

  const { counts, focus: appliedFocus } = roster;

  // Offering the prediction as a filter it cannot honour would be a chip that
  // does nothing: a search has to reach the whole roster, a small group is
  // already short, and a series with no regulars has none to show.
  const canFocusRecent = !roster.isFiltered && !group && counts.recent > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-ink-800 bg-ink-950">
        <div className="mx-auto w-full max-w-3xl">
          <EventHeader
            event={event}
            autoEvent={autoEvent}
            isOverridden={isOverridden}
            selectableEvents={selectableEvents}
            now={now}
            present={counts.present}
            eligible={counts.eligible}
          />
          <div className="pt-2">
            <SearchBar value={query} onChange={setQuery} />
            <ScopeBar
              groups={groups}
              scopeGroupId={scopeGroupId}
              onScopeChange={handleScopeChange}
              grades={grades}
              onGradesChange={setGrades}
              focus={appliedFocus}
              onFocusChange={setFocus}
              showRecent={canFocusRecent}
              recentCount={counts.recent}
              assignedGroupId={profile?.assignedGroupId ?? null}
              present={counts.present}
              eligible={counts.eligible}
              absent={counts.absent}
            />
          </div>
        </div>
      </div>

      {/* Capped width on desktop: stretched to a 27-inch monitor a roster row puts
          the student's name and the control that checks them in a foot apart, so
          the eye and the mouse both have to travel the whole way. The bottom
          padding clears the floating add button, which otherwise sits on top of
          the last student in the list.

          `relative` is doing real work: `overflow` only clips an absolutely
          positioned descendant when the scroller is also its containing block.
          Every roster row that carries a warning badge holds an `sr-only` span,
          which is `position: absolute` — left static, those escaped the box and
          added their offsets to the *page*, so the whole app frame could be
          scrolled off into empty space below the roster. */}
      <div className="scroll-touch relative mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto pb-36 lg:pb-8">
        {attendanceError ? (
          <div className="px-3 pt-3">
            <ErrorBanner message={attendanceError} />
          </div>
        ) : null}

        {/* Above the roster rather than below it: a counselor who cannot find a
            student needs to know the list is short before they conclude the
            student is not on it and quick-add a duplicate. */}
        <RosterErrorBanner className="mx-3 mt-3" />

        {counts.eligible === 0 ? (
          <EmptyState
            className="pt-10"
            icon={rosterError ? "⚠️" : "👋"}
            title={
              rosterError
                ? "The roster could not be read"
                : event.requiresRsvp
                  ? "Nobody has RSVP’d yet"
                  : "Nobody on this roster yet"
            }
            description={
              rosterError
                ? "Check-in still works: quick-add anyone who walks in, and they will be counted."
                : event.requiresRsvp
                  ? "This trip is limited to students who RSVP’d. Add them from the event page, or quick-add someone who turned up anyway."
                  : "Students appear here as soon as the roster syncs. You can still quick-add anyone who walks in."
            }
          />
        ) : roster.isFiltered && roster.entries.length === 0 ? (
          <EmptyState
            className="pt-10"
            icon="🔍"
            title={`No match for “${query.trim()}”`}
            description="First time here? Add them as a visitor — it takes three fields."
            action={
              <button
                type="button"
                onClick={() => setQuickAddOpen(true)}
                className="min-h-11 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white active:bg-brand-600"
              >
                Add as visitor
              </button>
            }
          />
        ) : (
          <>
            {/* One list, always. A tap recolours a row; it never relocates it. */}
            <RosterList
              title={roster.isFiltered ? "Results" : FOCUS_TITLE[appliedFocus]}
              entries={roster.entries}
              description={
                appliedFocus === "recent" && counts.historyWindow > 0
                  ? `from the last ${counts.historyWindow} ${counts.historyWindow === 1 ? "gathering" : "gatherings"}`
                  : appliedFocus === "checkedIn"
                    ? "tap to undo"
                    : undefined
              }
              emptyLabel={FOCUS_EMPTY[appliedFocus]}
              tone={appliedFocus === "checkedIn" ? "present" : "default"}
              showRecentHint={event.mode === "recurring"}
              onPress={onPress}
              flashing={flashing}
              busy={pending}
            />

            {/* The way back out. A filtered list looks exactly like a short
                roster, and a counselor who cannot find a student needs to be
                told the rest of the ministry is one tap away before they
                conclude the student is missing and quick-add a duplicate. */}
            {appliedFocus !== "all" ? (
              <div className="px-3 pb-3">
                <button
                  type="button"
                  onClick={() => setFocus("all")}
                  className="min-h-11 w-full rounded-xl bg-ink-900 px-4 text-sm font-semibold text-ink-300 ring-1 ring-ink-800 active:bg-ink-800"
                >
                  Show all {counts.eligible} students
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        aria-label="Quick add a visitor"
        className="fixed bottom-safe-bottom right-4 z-30 mb-20 flex size-14 items-center justify-center rounded-full bg-brand-500 text-3xl leading-none text-white shadow-lg shadow-black/40 active:bg-brand-600 lg:mb-6"
      >
        <span aria-hidden="true">+</span>
      </button>

      {user ? (
        <QuickAddVisitorModal
          open={quickAddOpen}
          onClose={() => setQuickAddOpen(false)}
          event={event}
          uid={user.uid}
          initialName={query}
          onAdded={(name) => {
            // Clearing the search is what makes the new visitor visible — they
            // arrive checked in, and every focus keeps checked-in students on
            // screen, so the filters need no nudging.
            setQuery("");
            setAnnouncement(`${name} added and checked in`);
            forgetCachedHistory();
          }}
        />
      ) : null}

      <span aria-live="polite" role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
