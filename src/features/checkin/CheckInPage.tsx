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
 *
 * The event is never chosen here. `/` is a question — see `ChooseEvent` — and
 * this screen only renders once `/event/:eventId` names an answer. That is a
 * deliberate reversal: Tally used to pick from the clock and open straight into
 * a roster, which saved a tap and made the app capable of being confidently,
 * silently wrong about which night forty check-ins belonged to.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { pageFrameWidth } from '@/components/pageFrameWidth';
import { RosterErrorBanner } from '@/components/RosterErrorBanner';
import { EmptyState, ErrorBanner, SkeletonRows } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { EventHeader } from '@/features/checkin/EventHeader';
import { FilterBar } from '@/features/checkin/FilterBar';
import { ChooseEvent } from '@/features/checkin/ChooseEvent';
import { QuickAddVisitorModal } from '@/features/checkin/QuickAddVisitorModal';
import { RosterList } from '@/features/checkin/RosterList';
import { SearchBar } from '@/features/checkin/SearchBar';
import { buildRoster, type RosterFocus } from '@/features/roster/predictiveRoster';
import { useActiveEvent, useSeriesHistoryEvents } from '@/hooks/useActiveEvent';
import { useAttendance, useRsvps } from '@/hooks/useAttendance';
import { useHeightVar } from '@/hooks/useHeightVar';
import { invalidateSnapshotCache, useEventSnapshots } from '@/hooks/useEventSnapshots';
import { cn, haptic } from '@/lib/utils';
import { checkIn, undoCheckIn } from '@/services/attendance';
import { isCheckInOpen } from '@/lib/time';
import { ensureMaterialized } from '@/services/events';
import { studentFullName, type Grade, type RosterEntry } from '@/types';

/**
 * The one left edge this screen has.
 *
 * Check-in is four stacked bands rather than one column — the event header, the
 * search box that sticks, the filter row and its rule, the roster — and each is
 * its own element because two of them have to reach past the others (sticky
 * offsets, an opaque background). They all carry this so the bands line up with
 * each other and, more to the point, with Insights, Events, Students and
 * Settings: same gutter off the rail, same measure, same page.
 *
 * `widen: false` is the deliberate half. See `PageFrame`.
 */
const BAND = pageFrameWidth({ width: '3xl', widen: false });

/** Long enough to register as confirmation, short enough not to lag the queue. */
const FLASH_MS = 700;

/**
 * How long the screen waits for the prediction before giving up on it.
 *
 * One round trip is worth waiting behind the skeleton that is already up. A
 * stalled one is not: a counselor cannot check anybody in against a skeleton,
 * and the whole roster is never the *wrong* answer, only a longer one.
 */
const PREDICTION_GRACE_MS = 1500;

/** What the one list is called, given the filter currently applied to it. */
const FOCUS_TITLE: Record<RosterFocus, string> = {
  all: "Roster",
  recent: "Recent",
  participated: "Participated",
  checkedIn: "Checked in",
};

const FOCUS_EMPTY: Record<RosterFocus, string> = {
  all: "Nobody matches these filters.",
  recent: "No regulars on this roster yet.",
  participated: "Nobody has been to this gathering yet.",
  checkedIn: "Nobody is checked in yet.",
};

export function CheckInPage() {
  const { eventId } = useParams();
  const { event, now, selectableEvents } = useActiveEvent(eventId ?? null);

  const { students, settings, loading: dataLoading, rosterError } = useData();
  const { user } = useAuth();
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

  /*
   * The gathering in front of the counselor becomes a document, if it was not
   * one already.
   *
   * The calendar is projected from the recurrence rules, so tonight's Friday
   * exists as a computed occurrence until somebody does something about it —
   * and taking attendance is that something. Done when check-in opens rather
   * than on the first tap, so the round trip happens while a counselor is still
   * finding the first student instead of underneath them.
   *
   * Gated on the window being open, not merely on an event being selected.
   * Browsing next month's Friday from the picker is not doing anything to it,
   * and it must not leave a document behind for a night nobody turned up to.
   * The tap itself is covered separately, in `handlePress`.
   *
   * Failure is deliberately silent here. It is retried on the tap, and saying
   * "could not create the event" to somebody with a queue at the door would be
   * noise about a thing they did not ask for.
   */
  const materializing = useRef<string | null>(null);
  useEffect(() => {
    if (!event || event.materialized || !isCheckInOpen(event, now)) return;
    if (materializing.current === event.id) return;

    materializing.current = event.id;
    void ensureMaterialized(event).catch(() => {
      materializing.current = null;
    });
  }, [event, now]);

  // Published for the roster heading below it, which sticks to the underside of
  // the search box rather than to the top of the window.
  const searchBar = useHeightVar<HTMLDivElement>('--checkin-search-h');

  /*
   * Everybody this screen has seen checked in, for as long as it is open.
   *
   * Checking somebody in brings them onto the Recent list even when the
   * prediction never expected them. Undoing it dropped them off again, and an
   * undo is usually a mis-tap being corrected — so the row a counselor reaches
   * for next was the one that had just disappeared out from under the thumb.
   * Pinned ids keep it there until the page is reloaded.
   *
   * Derived from the attendance stream rather than from the tap handler, which
   * costs nothing and covers the two cases a tap does not: a visitor arriving
   * already checked in from the quick-add modal, and a student the *other*
   * counselor's phone checked in a moment ago.
   */
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());

  // A different gathering is a different queue: keep nothing from the last one.
  // Guarded on the id it was built for rather than run on mount, so opening the
  // screen does not spend a second render clearing a set that is already empty.
  const pinnedFor = useRef(event?.id ?? null);
  useEffect(() => {
    const id = event?.id ?? null;
    if (pinnedFor.current === id) return;
    pinnedFor.current = id;
    setPinned(new Set());
  }, [event?.id]);

  useEffect(() => {
    setPinned((current) => {
      const added = attendance.filter((record) => !current.has(record.studentId));
      if (added.length === 0) return current;
      const next = new Set(current);
      for (const record of added) next.add(record.studentId);
      return next;
    });
  }, [attendance]);

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
      pinned,
    });
  }, [event, students, attendance, rsvps, snapshots, settings, query, grades, focus, pinned]);

  /* ---- Waiting for the prediction ---------------------------------------- */

  /**
   * The prediction arrives a beat after the roster does — it is a one-shot read
   * of the past instances' attendance, not a listener, and on a second visit
   * the students come straight back out of Firestore's local cache while that
   * read goes to the network. Painting the whole ministry and then deleting two
   * thirds of it when the read lands is the same jump this screen exists to
   * avoid, so the list waits behind a skeleton until the prediction is in.
   *
   * Derived from the data rather than from `useEventSnapshots`'s own `loading`,
   * which is only raised inside an effect — one frame after the wide roster
   * would already have been painted.
   */
  const predictionPending = historyEvents.length > snapshots.length;
  const waitingForPrediction = focus === "recent" && predictionPending;

  useEffect(() => {
    if (!waitingForPrediction) return;
    // Giving up switches the filter off rather than leaving it armed to narrow
    // the list later, under a thumb that has already started tapping.
    const timer = setTimeout(() => setFocus("all"), PREDICTION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [waitingForPrediction]);

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
          // Attendance hangs off the event document, so the gathering has to be
          // one. Almost always already done by the effect above; this is what
          // makes it true for a counselor getting a head start on a gathering
          // whose check-in has not opened yet.
          await ensureMaterialized(event);
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
        <div className={cn(BAND, 'pt-4 lg:pt-6')}>
          <SkeletonRows />
        </div>
      );
    }
    return <ChooseEvent events={selectableEvents} now={now} />;
  }

  const { counts, focus: appliedFocus } = roster;

  // Offering the prediction as a filter it cannot honour would be a chip that
  // does nothing: a search has to reach the whole roster, and a series with no
  // regulars has none to show.
  const canFocusRecent = !roster.isFiltered && counts.recent > 0;

  // Same test one rung wider, plus one of its own: a filter that selects every
  // eligible student is not a filter. These mirror `resolveFocus`, which is what
  // actually decides — the chips only have to agree with it.
  const canFocusParticipated =
    !roster.isFiltered && counts.participated > 0 && counts.participated < counts.eligible;

  /*
   * Two focus chips is what a phone holds, so the third has to earn its slot.
   *
   * At 412px the filter row has ~258px for chips before the grade dropdown, and
   * three of them come to 392 — which does not crowd anything, it pushes
   * "Checked in" clean off the edge of a scroller with no visible overflow. That
   * chip is how a counselor reviews the queue mid-shift; losing it to a filter
   * that is one tap away underneath the list is a bad trade.
   *
   * So Participated appears only when it is doing something a chip has to do:
   * standing in for Recent when the prediction has nothing to say, or being the
   * filter currently applied, which must always be possible to turn off. When
   * the counselor is on Recent, the button under the roster is the way to it —
   * and that button says so in words.
   */
  const showParticipatedChip =
    canFocusParticipated && (!canFocusRecent || appliedFocus === 'participated');

  /*
   * The way back out, one rung at a time.
   *
   * This used to be a single jump to "Show all 129 students", which on a roster
   * synced from Planning Center is every teenager the church has a record of —
   * a list nobody wants and which buries the forty students who actually come.
   * So a counselor widening out of Recent lands on the gathering's own people
   * first, and only reaches the whole ministry from there.
   *
   * The rung is skipped when it would reveal nobody new, so the button is never
   * an invitation to press it and watch nothing happen.
   */
  const shownCount = appliedFocus === 'recent' ? counts.recent : counts.present;
  const widenTo: RosterFocus =
    appliedFocus !== 'participated' && canFocusParticipated && counts.participated > shownCount
      ? 'participated'
      : 'all';

  return (
    <div className="flex flex-col">
      {/* Scrolls away, and is meant to. Which event, what time, how many are
          here — a counselor reads that on arrival and then works the queue for
          an hour without needing it again, so it is the one part of the screen
          that can afford to cost nothing once it has been read. */}
      <div className={cn(BAND, 'pt-4 lg:pt-6')}>
        <EventHeader
          event={event}
          selectableEvents={selectableEvents}
          now={now}
          present={counts.present}
          eligible={counts.eligible}
        />
      </div>

      {/* The one thing that stays. Search is how a counselor finds the student
          in front of them in a list of two hundred, and it has to be reachable
          from anywhere in that list — so it rides the page down and then pins
          itself under the app bar, whose height is measured rather than assumed
          (safe-area inset on a notched phone, nothing at all on desktop).

          Opaque, not translucent: roster rows are `bg-ink-900` cards passing
          underneath, and a blurred band would let them smear through the
          placeholder text. */}
      <div
        className="sticky z-20 bg-ink-950 pt-2"
        style={{ top: 'var(--app-header-h, 0px)' }}
        ref={searchBar}
      >
        <div className={BAND}>
          <SearchBar value={query} onChange={setQuery} onQuickAdd={() => setQuickAddOpen(true)} />
        </div>
      </div>

      {/* The rule ends where the chips do. It used to run the full width of the
          window while everything inside it stopped at a centred column, which
          drew a full-bleed layout the page never delivered and underlined
          nothing at all for 336px on either side. */}
      <div className={cn(BAND, 'border-b border-ink-800')}>
        <FilterBar
          grades={grades}
          onGradesChange={setGrades}
          focus={appliedFocus}
          onFocusChange={setFocus}
          showRecent={canFocusRecent}
          recentCount={counts.recent}
          showParticipated={showParticipatedChip}
          participatedCount={counts.participated}
          present={counts.present}
        />
      </div>

      {/* Nothing floats over the end of this list any more — quick-add rides
          the search band, see `SearchBar`. */}
      <div className={cn(BAND, 'pb-4 lg:pb-6')}>
        {attendanceError ? (
          <div className="pt-3">
            <ErrorBanner message={attendanceError} />
          </div>
        ) : null}

        {/* Above the roster rather than below it: a counselor who cannot find a
            student needs to know the list is short before they conclude the
            student is not on it and quick-add a duplicate. */}
        <RosterErrorBanner className="mt-3" />

        {/* The list, and only the list, waits for the prediction. The header,
            the search box and the quick-add button are all still usable — a
            visitor walking in while the history read is in flight must not find
            a screen with nothing on it. */}
        {waitingForPrediction ? (
          <div className="pt-3">
            <SkeletonRows />
          </div>
        ) : counts.eligible === 0 ? (
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
                className="min-h-11 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-400 active:bg-brand-600"
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
                  : appliedFocus === "participated"
                    // Says which window, because "participated" is only ever
                    // true of what the app loaded — and says which *question*,
                    // because an event with no history of its own is answering
                    // a weaker one. See `ParticipationSource`.
                    ? roster.participationSource === "gathering"
                      ? `been here in the last ${counts.participationWindow} ${counts.participationWindow === 1 ? "gathering" : "gatherings"}`
                      : "checked in at least once before"
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
              <div className="pb-3">
                <button
                  type="button"
                  onClick={() => setFocus(widenTo)}
                  className="min-h-11 w-full rounded-xl bg-ink-900 px-4 text-sm font-semibold text-ink-300 ring-1 ring-ink-800 hover:bg-ink-800 active:bg-ink-800"
                >
                  {widenTo === "participated"
                    ? `Show all ${counts.participated} who have participated`
                    : `Show all ${counts.eligible} students`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

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
