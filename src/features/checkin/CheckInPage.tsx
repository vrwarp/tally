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
 * The corrections live here too, because they are what the tap budget is really
 * protecting: a mis-tap that costs a trip to another screen is a mis-tap nobody
 * fixes. Undo is the check mark, one tap, no dialog. The rest of the row opens
 * a strip holding the two rarer ones — the student's profile, and "Wrong
 * person", which turns this whole screen into the person picker rather than
 * inventing a second search box on top of it. See `swapForId`.
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
import { ArchivedNight } from '@/features/checkin/ArchivedNight';
import { ChooseEvent } from '@/features/checkin/ChooseEvent';
import { QuickAddVisitorModal } from '@/features/checkin/QuickAddVisitorModal';
import { RosterList } from '@/features/checkin/RosterList';
import { SearchBar } from '@/features/checkin/SearchBar';
import { buildRoster, type RosterFocus } from '@/features/roster/predictiveRoster';
import { useActiveEvent, useSeriesHistoryEvents } from '@/hooks/useActiveEvent';
import { useAllergyNotes } from '@/hooks/useAllergyNotes';
import { useAttendance, useRsvps } from '@/hooks/useAttendance';
import { useHeightVar } from '@/hooks/useHeightVar';
import { invalidateSnapshotCache, useEventSnapshots } from '@/hooks/useEventSnapshots';
import { chainKey } from '@/lib/materialize';
import { clearSkippedNight } from '@/services/skippedNights';
import { cn, haptic } from '@/lib/utils';
import {
  checkIn,
  checkOut,
  swapCheckIn,
  undoCheckIn,
  undoCheckOut,
} from '@/services/attendance';
import { formatClock, isCheckInOpen } from '@/lib/time';
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

/** A stable empty list, for the renders before an event has been chosen. */
const NO_ENTRIES: readonly RosterEntry[] = [];

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
  inRoom: "In room",
  checkedOut: "Checked out",
};

const FOCUS_EMPTY: Record<RosterFocus, string> = {
  all: "Nobody matches these filters.",
  recent: "No regulars on this roster yet.",
  participated: "Nobody has been to this gathering yet.",
  checkedIn: "Nobody is checked in yet.",
  inRoom: "Nobody is in the room.",
  checkedOut: "Nobody has been collected yet.",
};

export function CheckInPage() {
  const { eventId } = useParams();
  const { event, eventLoading, fromArchive, now, selectableEvents } = useActiveEvent(
    eventId ?? null,
  );

  const { students, settings, loading: dataLoading, rosterError } = useData();
  const { user, can } = useAuth();
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

  /*
   * A check-out roster opens on the room while the gathering is running.
   *
   * `isCheckInOpen` as a *default*, never as a lock — the rest of this screen
   * is built on the principle that a counselor may record attendance whenever
   * they get to it. After the window it opens on the whole roster, because the
   * question has changed from "who is here" to "who came".
   */
  const openedOnRoom = useRef(false);
  useEffect(() => {
    if (!event?.requiresCheckOut || openedOnRoom.current) return;
    openedOnRoom.current = true;
    setFocus(isCheckInOpen(event, now) ? "inRoom" : "all");
  }, [event, now]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  /**
   * The one row with its action strip open, if any.
   *
   * One at a time, screen-wide: a column of open strips would push the queue
   * off the bottom of a phone, and the strip is a detour from the queue rather
   * than part of working it.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /**
   * The check-in being handed to somebody else, by student id.
   *
   * "Wrong person" is not a modal with a second search box in it. It puts *this
   * screen* into the picking mood: the same search field, the same fuzzy
   * matching, the same grade chips, the same rows — which is the entire point,
   * because the counselor is looking for the student they have just failed to
   * find once already, and a different search box would behave differently at
   * exactly the wrong moment. Only what a tap means changes, and every row says
   * so while it is true.
   */
  const [swapForId, setSwapForId] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);

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
    // Both are statements about one row of one gathering, and neither survives
    // being pointed at a different night.
    setExpandedId(null);
    setSwapForId(null);
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

  /**
   * The check-in being moved, read live rather than captured on the tap.
   *
   * Two phones are on this queue. If the other counselor undoes the check-in
   * while this one is still looking for the right name, the thing being
   * corrected no longer exists — and moving a record that has been deleted
   * would quietly *create* one, at a timestamp copied from a screen. So the
   * source is looked up on every render and the mode closes itself when it goes.
   */
  const swapSource = useMemo(() => {
    if (!swapForId) return null;
    const record = attendance.find((item) => item.studentId === swapForId);
    const student = students.find((item) => item.id === swapForId);
    if (!record || !student) return null;
    return { record, student };
  }, [swapForId, attendance, students]);

  useEffect(() => {
    if (!swapForId || swapSource) return;
    setSwapForId(null);
    show("That check-in is gone — there is nothing left to move.", { tone: "info" });
  }, [swapForId, swapSource, show]);

  // The action strip is a check-in's own, so an undo — this counselor's or the
  // other phone's — takes it away with the check mark it was hanging off.
  useEffect(() => {
    if (!expandedId) return;
    if (!attendance.some((record) => record.studentId === expandedId)) setExpandedId(null);
  }, [attendance, expandedId]);

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

  /*
   * What the flagged rows are actually allergic to.
   *
   * Asked for the rows on screen rather than for the whole ministry, and only
   * for the ones the roster read already flagged — the point of the read is that
   * a counselor can act on the badge without leaving the queue, not that the
   * device ends up holding four hundred children's medical notes. A row whose
   * note has not landed, or could not be read, keeps the badge it always had.
   */
  const allergyNotes = useAllergyNotes(roster?.entries ?? NO_ENTRIES);

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
    if (!event || event.checkInClosesAt >= new Date()) return;
    invalidateSnapshotCache(event.id);

    /*
     * The same correction, told to everybody else.
     *
     * A finished night with nobody in it gets written down as skipped, and every
     * profile then reads it from that one document instead of re-deriving it. So
     * the moment somebody back-fills a register, that entry has to go — a night
     * this leader just proved happened must stop being reported as one that did
     * not.
     *
     * Only while the register is nearly empty. The entry is gone after the first
     * tap; the next couple are insurance against a lost write, and after that a
     * back-fill of forty students would be forty writes to one document to
     * remove something already removed.
     *
     * Fire and forget, deliberately. The check-in is committed and correct, and
     * a derived summary that failed to update is not worth a red toast over a
     * tap that worked — the next examination that finds this night held will
     * clear the entry anyway.
     */
    if (attendance.length <= 3) {
      void clearSkippedNight(chainKey(event), event.id).catch(() => {});
    }
  }, [attendance.length, event]);

  /**
   * Whether this student can be given a check-in at all, and a reason if not.
   *
   * A frozen student — their Planning Center record deleted or merged away —
   * cannot: the rules would refuse the write, and saying why beats a generic
   * failure toast landing after an optimistic green flash. It guards the two
   * writes that *create* attendance for somebody, a check-in and the receiving
   * end of a swap. Undo is deliberately not guarded: a delete is allowed, and a
   * student who was frozen after being checked in must not be stranded present.
   */
  const refuseFrozen = useCallback(
    (entry: RosterEntry): boolean => {
      if (entry.student.pcoRecordMissing !== true) return false;
      const frozen = `${studentFullName(entry.student)} is frozen — their Planning Center record was deleted or merged away. Fix it from their student page first.`;
      setAnnouncement(frozen);
      show(frozen, { tone: 'error' });
      return true;
    },
    [show],
  );

  /**
   * The bookkeeping every attendance write shares.
   *
   * `ids` is what the write touches — one student for a check-in or an undo,
   * two for a swap, and both of those have to be locked out for the duration.
   * The guard is a ref rather than `pending` so a second tap is rejected before
   * React has re-rendered anything.
   */
  const write = useCallback(
    async (ids: readonly string[], failure: string, work: () => Promise<void>) => {
      if (ids.some((id) => inFlight.current.has(id))) return;
      for (const id of ids) {
        inFlight.current.add(id);
        setBusy(id, true);
      }

      try {
        await work();
      } catch {
        setAnnouncement(failure);
        show(failure, { tone: "error" });
      } finally {
        forgetCachedHistory();
        for (const id of ids) {
          inFlight.current.delete(id);
          setBusy(id, false);
        }
      }
    },
    [setBusy, show, forgetCachedHistory],
  );

  const handleCheckIn = useCallback(
    async (entry: RosterEntry) => {
      if (!event || !user) return;
      if (refuseFrozen(entry)) return;
      const name = studentFullName(entry.student);

      await write([entry.student.id], `Could not check in ${name}. Try again.`, async () => {
        // Paint and buzz first — the confirmation must land on the tap, not on
        // the round trip.
        haptic();
        flash(entry.student.id);
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
      });
    },
    [event, user, query, flash, write, refuseFrozen],
  );

  const handleUndo = useCallback(
    async (entry: RosterEntry) => {
      if (!event) return;
      const name = studentFullName(entry.student);

      // No confirm dialog: a mistaken undo costs one more tap, whereas a modal
      // costs every counselor a beat on every correction.
      setExpandedId(null);
      await write([entry.student.id], `Could not undo ${name}. Try again.`, async () => {
        await undoCheckIn(event.id, entry.student.id);
        setAnnouncement(`${name} removed`);
        show(`Undid ${name}`, { tone: "info" });
      });
    },
    [event, show, write],
  );

  const handleCheckOut = useCallback(
    async (entry: RosterEntry) => {
      if (!event || !user) return;
      // The rules refuse a check-out on a frozen student just as they refuse a
      // check-in, so say why rather than letting it die on a generic toast.
      if (refuseFrozen(entry)) return;
      const name = studentFullName(entry.student);

      setExpandedId(null);
      await write([entry.student.id], `Could not check out ${name}. Try again.`, async () => {
        // No `flash`: the green animation means "checked in", and saying that
        // as somebody leaves would be the wrong confirmation entirely.
        haptic();
        setAnnouncement(`${name} checked out`);
        await checkOut(event.id, entry.student.id, user.uid);
      });
    },
    [event, user, write, refuseFrozen],
  );

  const handleUndoCheckOut = useCallback(
    async (entry: RosterEntry) => {
      if (!event) return;
      if (refuseFrozen(entry)) return;
      const name = studentFullName(entry.student);

      setExpandedId(null);
      await write([entry.student.id], `Could not undo the check-out for ${name}. Try again.`, async () => {
        haptic();
        setAnnouncement(`${name} back in the room`);
        await undoCheckOut(event.id, entry.student.id);
      });
    },
    [event, write, refuseFrozen],
  );

  /**
   * Hands one check-in to the student it should have been.
   *
   * The mode is dropped before the write rather than after it: the source
   * record disappears out of the local cache the instant the batch is queued,
   * and a picker still on screen looking for a record that is already gone
   * would announce that the thing it is holding no longer exists.
   */
  const handleSwapPick = useCallback(
    async (entry: RosterEntry) => {
      if (!event || !user || !swapSource) return;
      if (refuseFrozen(entry)) return;
      const from = swapSource;
      const wrong = studentFullName(from.student);
      const right = studentFullName(entry.student);
      const when = formatClock(from.record.checkedInAt);

      setSwapForId(null);
      setQuery("");

      await write(
        [from.student.id, entry.student.id],
        `Could not move the check-in to ${right}. Try again.`,
        async () => {
          haptic();
          flash(entry.student.id);
          setAnnouncement(`${when} check-in moved from ${wrong} to ${right}`);
          await swapCheckIn({
            event,
            from: from.record,
            to: entry.student,
            uid: user.uid,
          });
          show(`${wrong} → ${right}, still ${when}`, { tone: "success" });
        },
      );
    },
    [event, user, swapSource, flash, show, write, refuseFrozen],
  );

  /**
   * The one entry point the rows have, because a row is one target.
   *
   * What it means depends on the screen's mood and on whether the student is
   * already here — and that ordering matters: while a check-in is being moved,
   * *every* row is a candidate for it, including one a counselor might
   * otherwise have been about to check in.
   */
  const onPress = useCallback(
    (entry: RosterEntry) => {
      if (swapForId) {
        void handleSwapPick(entry);
        return;
      }
      if (entry.attendance) {
        setExpandedId((current) => (current === entry.student.id ? null : entry.student.id));
        return;
      }
      void handleCheckIn(entry);
    },
    [swapForId, handleSwapPick, handleCheckIn],
  );

  const onUndo = useCallback(
    (entry: RosterEntry) => {
      void handleUndo(entry);
    },
    [handleUndo],
  );

  /**
   * "Wrong person" — the roster becomes a picker.
   *
   * The query is cleared and the caret put in the search box, because the next
   * thing that happens is always typing: the two names that get confused for
   * each other are the ones that look alike, and finding the right one is the
   * job the search box already does.
   */
  const onSwap = useCallback((entry: RosterEntry) => {
    setSwapForId(entry.student.id);
    setExpandedId(null);
    setQuery("");
    searchInput.current?.focus();
  }, []);

  const cancelSwap = useCallback(() => {
    setSwapForId(null);
    setQuery("");
  }, []);

  /*
   * Escape leaves the picker — on the second press, if something has been typed.
   *
   * The search field clears itself on the first one (see `TextField`), and that
   * is the right order: a counselor who mistyped a name wants their query back,
   * not the whole correction abandoned.
   */
  useEffect(() => {
    if (!swapForId) return;
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape" || query !== "") return;
      setSwapForId(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [swapForId, query]);

  /* ---- Render ------------------------------------------------------------ */

  /*
   * A night from before the loaded calendar: a record, not a roster.
   *
   * This is checked before the roster branch below, because `roster` is built
   * from history that is not loaded for a night this old and would otherwise
   * describe the wrong term. See `ArchivedNight`.
   */
  if (event && fromArchive) {
    return <ArchivedNight event={event} attendance={attendance} students={students} now={now} />;
  }

  if (!event || !roster) {
    if (dataLoading || eventLoading) {
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

  /*
   * A check-out roster spends both chip slots on the room.
   *
   * A nursery volunteer is not filtering by predicted regulars — they are
   * working a room, and In room / Checked out are the whole job. Recent still
   * *applies* if it is somehow the active focus; it just stops competing for a
   * slot it would win and then not be used.
   */
  const tracksCheckOut = event.requiresCheckOut;

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
    !tracksCheckOut && canFocusParticipated && (!canFocusRecent || appliedFocus === 'participated');
  const showRecentChip = canFocusRecent && (!tracksCheckOut || appliedFocus === 'recent');

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
  const shownCount =
    appliedFocus === 'recent'
      ? counts.recent
      : appliedFocus === 'inRoom'
        ? counts.inRoom
        : appliedFocus === 'checkedOut'
          ? counts.checkedOut
          : counts.present;
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
          inRoom={counts.inRoom}
          tracksCheckOut={event.requiresCheckOut}
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
          {/* Rides the sticky band rather than sitting above the list, so the
              question stays on screen for the whole hunt. A counselor who
              scrolls past it and forgets what a tap now does is the one way
              this mode can do harm. */}
          {swapSource ? (
            <div
              role="status"
              className="mb-2 flex items-center gap-3 rounded-xl bg-brand-500/10 px-3 py-2 ring-1 ring-brand-500/30"
            >
              {/* Wraps rather than truncating: the half a counselor needs is
                  the half that was falling off the end — that the correction
                  keeps the minute the student actually arrived. */}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-brand-200">
                  Who should this be?
                </span>
                <span className="block text-xs leading-snug text-ink-300">
                  Tap the right student. {studentFullName(swapSource.student)}’s check-in moves
                  across, still {formatClock(swapSource.record.checkedInAt)}.
                </span>
              </span>
              <button
                type="button"
                onClick={cancelSwap}
                className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800 active:bg-ink-800"
              >
                Cancel
              </button>
            </div>
          ) : null}

          <SearchBar
            value={query}
            onChange={setQuery}
            inputRef={searchInput}
            placeholder={swapSource ? 'Search for the right student…' : undefined}
            /* Quick-add is stood down while a check-in is being moved: it
               creates a *new* student and checks them in on the server clock,
               which is the one thing this correction exists to avoid. */
            onQuickAdd={swapSource ? undefined : () => setQuickAddOpen(true)}
          />
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
          showRecent={showRecentChip}
          recentCount={counts.recent}
          showParticipated={showParticipatedChip}
          participatedCount={counts.participated}
          present={counts.present}
          tracksCheckOut={tracksCheckOut}
          inRoomCount={counts.inRoom}
          checkedOutCount={counts.checkedOut}
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
            description={
              swapSource
                ? "Nobody by that name to move this check-in to. Leave it and add them as a visitor instead."
                : "First time here? Add them as a visitor — it takes three fields."
            }
            action={
              /* A brand-new student is not somewhere a check-in can be *moved*
                 to — quick-add writes its own, on the server clock — so the way
                 out of the picker is offered rather than a button that would
                 quietly do something else. */
              swapSource ? (
                <button
                  type="button"
                  onClick={cancelSwap}
                  className="min-h-11 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-ink-300 ring-1 ring-ink-800 hover:bg-ink-800 active:bg-ink-800"
                >
                  Leave it where it is
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(true)}
                  className="min-h-11 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-400 active:bg-brand-600"
                >
                  Add as visitor
                </button>
              )
            }
          />
        ) : (
          <>
            {/* One list, always. A tap recolours a row; it never relocates it. */}
            <RosterList
              title={roster.isFiltered ? "Results" : FOCUS_TITLE[appliedFocus]}
              entries={roster.entries}
              description={
                // While a check-in is being moved the list is a picker, and
                // what it is filtered to matters less than what a tap now does.
                swapSource
                  ? "tap the right student"
                  : appliedFocus === "recent" && counts.historyWindow > 0
                    ? `from the last ${counts.historyWindow} ${counts.historyWindow === 1 ? "gathering" : "gatherings"}`
                    : appliedFocus === "participated"
                      ? // Says which window, because "participated" is only ever
                        // true of what the app loaded — and says which
                        // *question*, because an event with no history of its
                        // own is answering a weaker one. See
                        // `ParticipationSource`.
                        roster.participationSource === "gathering"
                        ? `been here in the last ${counts.participationWindow} ${counts.participationWindow === 1 ? "gathering" : "gatherings"}`
                        : "checked in at least once before"
                      : appliedFocus === "checkedIn"
                        ? "tap the check mark to undo"
                        : appliedFocus === "inRoom"
                          ? "tap Out when somebody collects them"
                          : appliedFocus === "checkedOut"
                            ? "tap ↺ to put somebody back"
                            : undefined
              }
              emptyLabel={FOCUS_EMPTY[appliedFocus]}
              tone={
                appliedFocus === "checkedIn" || appliedFocus === "inRoom" ? "present" : "default"
              }
              showRecentHint={event.mode === "recurring"}
              onPress={onPress}
              onUndo={onUndo}
              onSwap={onSwap}
              onCheckOut={handleCheckOut}
              onUndoCheckOut={handleUndoCheckOut}
              tracksCheckOut={tracksCheckOut}
              mode={swapSource ? "swap" : "checkin"}
              swapSourceId={swapSource?.student.id ?? null}
              expandedId={expandedId}
              canOpenProfile={can("core")}
              flashing={flashing}
              busy={pending}
              allergyNotes={allergyNotes}
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
