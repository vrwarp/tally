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
import { EmptyState, ErrorBanner, SkeletonRows } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { EventHeader } from '@/features/checkin/EventHeader';
import { NoActiveEvent } from '@/features/checkin/NoActiveEvent';
import { QuickAddVisitorModal } from '@/features/checkin/QuickAddVisitorModal';
import { RosterSection } from '@/features/checkin/RosterSection';
import { ScopeBar } from '@/features/checkin/ScopeBar';
import { SearchBar } from '@/features/checkin/SearchBar';
import { buildRoster } from '@/features/roster/predictiveRoster';
import { useActiveEvent, useSeriesHistoryEvents } from '@/hooks/useActiveEvent';
import { useAttendance, useRsvps } from '@/hooks/useAttendance';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { haptic } from '@/lib/utils';
import { checkIn, undoCheckIn } from '@/services/attendance';
import { studentFullName, type Grade, type RosterEntry } from '@/types';

/** Long enough to register as confirmation, short enough not to lag the queue. */
const FLASH_MS = 700;

export function CheckInPage() {
  const { eventId } = useParams();
  const { event, autoEvent, isOverridden, now, selectableEvents } = useActiveEvent(eventId ?? null);

  const { students, groups, settings, loading: dataLoading } = useData();
  const { profile, user } = useAuth();
  const { show } = useToast();

  const { attendance, error: attendanceError } = useAttendance(event?.id ?? null);
  const { rsvps } = useRsvps(event?.id ?? null, event?.requiresRsvp ?? false);
  const historyEvents = useSeriesHistoryEvents(event);
  const { snapshots } = useEventSnapshots(historyEvents);

  const [query, setQuery] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const [flashing, setFlashing] = useState<ReadonlySet<string>>(() => new Set());
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
    event?.mode === 'recurring' && event.defaultGroupingMode === 'smallGroup'
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
  const group = groups.find((candidate) => candidate.id === scopeGroupId) ?? null;

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
      filters: { query, grade },
      group,
    });
  }, [event, students, attendance, rsvps, snapshots, settings, query, grade, group]);

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
          show(`Undid ${name}`, { tone: 'info' });
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
            method: query.trim() ? 'search' : 'tap',
          });
        }
      } catch {
        const failure = entry.attendance
          ? `Could not undo ${name}. Try again.`
          : `Could not check in ${name}. Try again.`;
        setAnnouncement(failure);
        show(failure, { tone: 'error' });
      } finally {
        inFlight.current.delete(studentId);
        setBusy(studentId, false);
      }
    },
    [event, user, query, flash, setBusy, show],
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

  const { counts } = roster;
  const notHereYet = [...roster.recent, ...roster.roster];
  const visible = notHereYet.length + roster.checkedIn.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-ink-800 bg-ink-950">
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
            grade={grade}
            onGradeChange={setGrade}
            assignedGroupId={profile?.assignedGroupId ?? null}
            present={counts.present}
            eligible={counts.eligible}
            absent={counts.absent}
          />
        </div>
      </div>

      {/* Bottom padding clears the floating quick-add button, which would
          otherwise sit on top of the last student's tap target. */}
      <div className="scroll-touch min-h-0 flex-1 overflow-y-auto pb-36">
        {attendanceError ? (
          <div className="px-3 pt-3">
            <ErrorBanner message={attendanceError} />
          </div>
        ) : null}

        {counts.eligible === 0 ? (
          <EmptyState
            className="pt-10"
            icon="👋"
            title={event.requiresRsvp ? 'Nobody has RSVP’d yet' : 'Nobody on this roster yet'}
            description={
              event.requiresRsvp
                ? 'This trip is limited to students who RSVP’d. Add them from the event page, or quick-add someone who turned up anyway.'
                : 'Students appear here as soon as the roster syncs. You can still quick-add anyone who walks in.'
            }
          />
        ) : roster.isFiltered && visible === 0 ? (
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
        ) : roster.isFiltered ? (
          <RosterSection
            title="Results"
            entries={notHereYet}
            onPress={onPress}
            flashing={flashing}
            busy={pending}
          />
        ) : group ? (
          /* Scoped to a small group, the question is who is *missing*, so the
             prediction split is dropped for one undivided absence list. */
          <RosterSection
            title="Not here yet"
            entries={notHereYet}
            emptyLabel="Everyone in this group is checked in."
            onPress={onPress}
            flashing={flashing}
            busy={pending}
          />
        ) : (
          <>
            <RosterSection
              title="Recent"
              entries={roster.recent}
              description={
                counts.historyWindow > 0
                  ? `from the last ${counts.historyWindow} ${counts.historyWindow === 1 ? 'gathering' : 'gatherings'}`
                  : undefined
              }
              showRecentHint={event.mode === 'recurring'}
              onPress={onPress}
              flashing={flashing}
              busy={pending}
            />
            <RosterSection
              title={roster.recent.length > 0 ? 'Everyone else' : 'Roster'}
              entries={roster.roster}
              emptyLabel={roster.recent.length > 0 ? undefined : 'Everyone is checked in.'}
              onPress={onPress}
              flashing={flashing}
              busy={pending}
            />
          </>
        )}

        <RosterSection
          title="Checked in"
          entries={roster.checkedIn}
          description="tap to undo"
          tone="present"
          onPress={onPress}
          flashing={flashing}
          busy={pending}
        />
      </div>

      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        aria-label="Quick add a visitor"
        className="fixed bottom-safe-bottom right-4 z-30 mb-20 flex size-14 items-center justify-center rounded-full bg-brand-500 text-3xl leading-none text-white shadow-lg shadow-black/40 active:bg-brand-600"
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
            // Clearing the search guarantees the new visitor is visible in the
            // "Checked in" block instead of hiding behind a stale query.
            setQuery('');
            setAnnouncement(`${name} added and checked in`);
          }}
        />
      ) : null}

      <span aria-live="polite" role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
