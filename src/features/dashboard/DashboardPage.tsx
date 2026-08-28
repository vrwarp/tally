/**
 * The core team's Tuesday-morning screen (Journey 5).
 *
 * Everything above the fold is a call list: who has drifted, who just arrived,
 * whose profile is still a name and a grade. Raw numbers only appear as the
 * four tiles that decide whether any of it needs attention today, and the trend
 * strip sits last inside its block because it is context rather than an action.
 *
 * The screen is split by gathering. Friday Fellowship and Sunday School are
 * different crowds — the check-in roster has always predicted them separately —
 * and pooling them here meant a Sunday regular who has never been to a Friday
 * read as "missed three in a row". The tabs pick one chain of repeats and every
 * scoped list below answers for that chain alone; "All" merges them, one row per
 * student, worst streak winning.
 *
 * That includes the profiles missing a parent contact, which is the one list
 * here that is not about attendance at all — but "who do we see on a Friday and
 * cannot reach" is a real question, and a card that ignored the tabs read as
 * though picking a gathering had done nothing.
 *
 * Below it sits the one section no gathering owns: one-off events, which are
 * not instances of anything and so cannot be missed, trended or streaked.
 *
 * Attendance history is fetched once for a fixed window per gathering (see
 * `useEventSnapshots`) — a Friday from six weeks ago will not change while a
 * leader reads this.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
  StatTile,
  TabBar,
} from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useNow } from '@/hooks/useNow';
import { useParentContact } from '@/hooks/useParentContact';
import { useTransitions } from '@/hooks/useTransitions';
import { AttendanceTrend } from '@/features/dashboard/AttendanceTrend';
import { IncompleteProfileList } from '@/features/dashboard/IncompleteProfileList';
import { MiaList } from '@/features/dashboard/MiaList';
import { sessionReleaseKey, type SessionRelease } from '@/features/dashboard/sessionRelease';
import { NewVisitorList } from '@/features/dashboard/NewVisitorList';
import { OneOffOnlyList, OneOffRecapList } from '@/features/dashboard/OneOffInsights';
import { ReleaseDialog, type ReleaseTarget } from '@/features/dashboard/ReleaseDialog';
import { TransitionLedger, type LedgerRow } from '@/features/dashboard/TransitionLedger';
import {
  computeIncompleteProfiles,
  computeMiaByGathering,
  computeNewVisitors,
  computeOneOffOnly,
  computeOneOffRecaps,
  computeSummary,
  gatheringsOnCalendar,
  groupByGathering,
  isInertRelease,
  mergeMia,
  seenAt,
} from '@/features/dashboard/insights';
import { chainKey } from '@/lib/materialize';
import { presumedCancelled } from '@/lib/sessionHistory';
import { formatShortDate } from '@/lib/time';
import { cn, sameItems } from '@/lib/utils';
import { releaseStudent, undoRelease } from '@/services/transitions';
import { studentFullName, type MiaStudent, type TallyEvent, type Transition, type TransitionReason } from '@/types';

/**
 * How many past nights of *each* gathering the dashboard reasons over.
 *
 * Per gathering rather than across the calendar, which is the whole point of
 * the split: a pooled window of ten covering both Fridays and Sundays gave each
 * of them five, and a five-night window can barely hold a three-miss streak.
 * Eight is about two months of one weekly gathering — long enough to see a
 * drift, short enough that somebody who left in the autumn does not haunt it.
 */
const PER_GATHERING_WINDOW = 8;

/** Recent one-offs to recap. A ministry runs a handful a year, not a term of them. */
const ONE_OFF_WINDOW = 4;

/**
 * A hard ceiling on the attendance reads one dashboard load costs, whatever the
 * calendar looks like. Newest first, so what falls off the end is the oldest
 * night of whichever gathering has the most of them.
 */
const MAX_EVENTS = 24;

const ALL = 'all';

export function DashboardPage() {
  const {
    students,
    events,
    series,
    settings,
    loading,
    rosterLoading,
    rosterSettled,
    rosterBackends,
    canWork,
  } = useData();
  const now = useNow(60_000);
  const [selected, setSelected] = useState<string>(ALL);
  const { user, profile } = useAuth();
  const { show } = useToast();

  /*
   * The aging-out record (docs/aging-out.md), read live so the ledger strip
   * and the undo reflect an act made on another device. Loaded here and on
   * the student page only — never provider-wide, because the check-in
   * screen's promise is that this feature costs a door nothing.
   */
  const { transitions } = useTransitions();

  /** The release being composed, if any: the dialog's whole state. */
  const [pendingRelease, setPendingRelease] = useState<{
    item: MiaStudent;
    target: ReleaseTarget;
  } | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  /**
   * Rows released this session, so they grey in place instead of vanishing
   * under the reader who pressed the button. Cleared only by undo — a reload
   * hands the record to the ledger strip.
   */
  const [sessionReleases, setSessionReleases] = useState<ReadonlyMap<string, SessionRelease>>(
    new Map(),
  );
  const [undoBusyKey, setUndoBusyKey] = useState<string | null>(null);
  const [ledgerUndoBusyId, setLedgerUndoBusyId] = useState<string | null>(null);

  /*
   * The window, taken per gathering.
   *
   * Only finished events. A night still in progress would count as a miss for
   * every student who has not walked in yet, and would put the whole ministry
   * on the MIA list at 7:05pm.
   */
  /*
   * The clock ticks once a minute and almost never moves an event across the
   * "finished" boundary, so almost every tick picks exactly the same window.
   * Handing back a new array anyway recomputed every list on this screen —
   * gatherings, MIA, new faces, the summary tiles — sixty times an hour for a
   * leader who left the tab open. The window's identity only changes when its
   * members do.
   */
  const lastWindow = useRef<TallyEvent[]>([]);

  const recentEvents = useMemo(() => {
    const finished = events
      .filter((event) => event.status !== 'cancelled' && event.checkInClosesAt < now)
      .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

    const takenPerGathering = new Map<string, number>();
    let oneOffs = 0;
    const picked: TallyEvent[] = [];

    for (const event of finished) {
      if (picked.length >= MAX_EVENTS) break;

      if (event.mode === 'oneoff') {
        if (oneOffs >= ONE_OFF_WINDOW) continue;
        oneOffs += 1;
      } else {
        const key = chainKey(event);
        const taken = takenPerGathering.get(key) ?? 0;
        if (taken >= PER_GATHERING_WINDOW) continue;
        takenPerGathering.set(key, taken + 1);
      }

      picked.push(event);
    }

    if (!sameItems(lastWindow.current, picked)) lastWindow.current = picked;
    return lastWindow.current;
  }, [events, now]);

  /*
   * Narrowed to the gatherings this reader may work, before the read.
   *
   * This is where restriction stops being cosmetic for the core team: the
   * numbers on this screen come from registers, so a gathering the reader is
   * not on cannot appear in them at all. Silently shrinking would be the worst
   * failure available on a screen whose job is "who is missing" — a leader
   * would read a smaller MIA list as good news. So what was left out is named
   * under the tabs.
   */
  const workable = useMemo(() => recentEvents.filter(canWork), [recentEvents, canWork]);
  const { snapshots, loading: snapshotsLoading, error } = useEventSnapshots(workable);
  /**
   * No register has come back yet, so nothing on this screen that is counted
   * from one can be drawn. Declared up here rather than beside its two
   * siblings below because the tabs consult it, and they are settled before
   * anything is rendered.
   *
   * "Not yet", never "again" — the same rule `rosterSettled` states for the
   * roster, and it earns its keep for the same reason. The window is rebuilt
   * whenever the calendar or this reader's access does, and a rebuilt window is
   * briefly a set of nights nothing is cached for: `snapshots` empties, this
   * would go true a second time, and the chart a leader was already looking at
   * would drop back to a placeholder and then redraw. Once history has landed
   * once, what is in flight is a revalidation with nothing to correct until it
   * comes back different.
   */
  const sawHistory = useRef(false);
  useEffect(() => {
    if (snapshots.length > 0) sawHistory.current = true;
  }, [snapshots]);
  const awaitingHistory = snapshotsLoading && snapshots.length === 0 && !sawHistory.current;

  /** The gatherings excluded from every number on this screen, by title. */
  const excluded = useMemo(() => {
    const titles = new Map<string, string>();
    for (const event of recentEvents) {
      if (!canWork(event)) titles.set(chainKey(event), event.title);
    }
    return [...titles.values()].sort((a, b) => a.localeCompare(b));
  }, [recentEvents, canWork]);

  /*
   * The gatherings that actually happened, grouped by the chain they belong to.
   * A scheduled night with nobody checked in was cancelled, and counting it
   * would flag every student in the ministry as having missed it.
   */
  const gatherings = useMemo(() => groupByGathering(snapshots, series), [snapshots, series]);

  /**
   * What the tabs offer: the gatherings that were held, or — until the
   * registers say which those are — the ones the calendar shows ran.
   *
   * The row sits above everything else on this screen, so drawing it only once
   * the registers had landed pushed the tiles, the call lists and the chart
   * down 60px, seconds after a leader started reading them. Which gatherings
   * ran is a fact about the calendar, and the calendar has streamed in before
   * this screen paints at all.
   *
   * It hands over to the history rather than standing in for it, because the
   * two can honestly disagree: a chain that was scheduled and that nobody ever
   * checked into is not a gathering this screen can say anything about, and
   * `groupByGathering` is what decides that. So the calendar's answer holds the
   * row until the real one arrives, and the real one wins.
   */
  const planned = useMemo(() => gatheringsOnCalendar(workable, series), [workable, series]);
  const tabs = awaitingHistory ? planned : gatherings;

  // A tab can vanish when the window scrolls past a dormant gathering; fall back
  // rather than render lists for a chain that is no longer offered.
  const active = tabs.some((gathering) => gathering.key === selected) ? selected : ALL;
  const activeGathering = gatherings.find((gathering) => gathering.key === active) ?? null;

  /** The nights the header counts: one gathering's, or every gathering's. */
  const held = useMemo(
    () => (activeGathering ? activeGathering.snapshots : gatherings.flatMap((g) => g.snapshots)),
    [activeGathering, gatherings],
  );

  // Said out loud rather than left implicit: "last 8 gatherings" when the
  // calendar shows ten scheduled reads as a bug in the numbers, and a leader
  // who knows two nights were called off can confirm it. One-offs are excluded
  // — an empty retreat is not a cancelled gathering.
  const skipped = useMemo(
    () =>
      presumedCancelled(snapshots).filter(
        (snapshot) =>
          snapshot.event.mode === 'recurring' &&
          (active === ALL || chainKey(snapshot.event) === active),
      ).length,
    [snapshots, active],
  );

  /*
   * Computed over the whole window and filtered afterwards, never computed from
   * the filtered history: which gathering a first-timer walked into is a fact
   * about the calendar, and a window narrowed to Sunday would attribute a
   * Friday arrival to Sunday.
   */
  const miaRows = useMemo(
    () => computeMiaByGathering(students, snapshots, settings, series, transitions),
    [students, snapshots, settings, series, transitions],
  );
  const mia = useMemo(
    () =>
      activeGathering
        ? miaRows.filter((row) => row.gatheringKey === activeGathering.key)
        : mergeMia(miaRows),
    [miaRows, activeGathering],
  );

  /*
   * The act, from the row that announces the need for it.
   *
   * A gathering row releases from that gathering; an unseen row that a
   * moved-on release produced re-answers the same release (usually with the
   * other reason). One student at a time, deliberately — see `ReleaseDialog`
   * for why there is no multi-select.
   */
  const handleResolve = useCallback((item: MiaStudent) => {
    const chain = item.gatheringKey ?? item.release?.chainKey;
    if (!chain) return;
    setPendingRelease({
      item,
      target: {
        student: item.student,
        chainKey: chain,
        gatheringTitle: item.gatheringTitle ?? item.release?.fromTitle ?? 'this gathering',
        // An unseen row is by definition unseen since its last visit; a
        // gathering row carries the pre-computed mark or nothing.
        notSeenAnywhereSince:
          item.notSeenAnywhereSince ?? (item.gatheringKey === null ? item.lastAttendedAt : null),
      },
    });
  }, []);

  const confirmRelease = useCallback(
    async (target: ReleaseTarget, reason: TransitionReason, note: string) => {
      if (!pendingRelease || !user) return;
      setReleaseBusy(true);
      try {
        await releaseStudent({
          chainKey: target.chainKey,
          studentId: target.student.id,
          reason,
          note,
          uid: user.uid,
          authorName: profile?.displayName ?? user.email ?? 'Somebody',
        });
        const key = sessionReleaseKey(pendingRelease.item.gatheringKey, target.student.id);
        setSessionReleases((current) =>
          new Map(current).set(key, { item: pendingRelease.item, reason }),
        );
        setPendingRelease(null);
      } catch {
        show('Could not save the release. Nothing changed.', { tone: 'error' });
      } finally {
        setReleaseBusy(false);
      }
    },
    [pendingRelease, user, profile, show],
  );

  const handleUndoSessionRelease = useCallback(
    async (release: SessionRelease) => {
      const chain = release.item.gatheringKey ?? release.item.release?.chainKey;
      if (!chain) return;
      const key = sessionReleaseKey(release.item.gatheringKey, release.item.student.id);
      setUndoBusyKey(key);
      try {
        await undoRelease(chain, release.item.student.id);
        setSessionReleases((current) => {
          const next = new Map(current);
          next.delete(key);
          return next;
        });
      } catch {
        show('Could not undo the release.', { tone: 'error' });
      } finally {
        setUndoBusyKey(null);
      }
    },
    [show],
  );

  /*
   * The ledger, scoped like every list on this screen: one gathering's
   * releases under its tab, all of them under "All". Names come from the
   * roster (the record holds ids), titles from the same map the tabs use, and
   * a release the student's own attendance has stood down is rendered as
   * stood down rather than dropped.
   */
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    const scoped = activeGathering
      ? transitions.filter((transition) => transition.chainKey === activeGathering.key)
      : transitions;
    if (scoped.length === 0) return [];

    const titles = new Map<string, string>();
    for (const entry of [...planned, ...gatherings]) titles.set(entry.key, entry.title);
    const byChain = new Map(gatherings.map((gathering) => [gathering.key, gathering.snapshots]));

    return scoped.map((transition) => {
      const student = students.find(
        (candidate) =>
          candidate.id === transition.studentId ||
          (candidate.mergedFromStudentIds ?? []).includes(transition.studentId),
      );
      return {
        transition,
        studentName: student ? studentFullName(student) : 'Someone no longer on the roster',
        gatheringTitle: titles.get(transition.chainKey) ?? null,
        inert: isInertRelease(
          transition,
          byChain.get(transition.chainKey),
          student?.id ?? transition.studentId,
        ),
      };
    });
  }, [transitions, activeGathering, planned, gatherings, students]);

  const handleLedgerUndo = useCallback(
    async (transition: Transition) => {
      setLedgerUndoBusyId(transition.id);
      try {
        await undoRelease(transition.chainKey, transition.studentId);
      } catch {
        show('Could not undo the release.', { tone: 'error' });
      } finally {
        setLedgerUndoBusyId(null);
      }
    },
    [show],
  );

  /*
   * The whole calendar, not `recentEvents`, and this is the one list here that
   * wants it.
   *
   * A first-timer appears the instant they are checked in — `firstAttendedAt`
   * is on the student document and streams live — but the history above is
   * finished nights only, on purpose, so nothing in it can name the night they
   * are standing in. The row said "Unknown event" for the whole of a visitor's
   * first evening, which is exactly when a leader reads it. `computeNewVisitors`
   * falls back to the gathering that began on that instant; passing the events
   * unfiltered is what lets it.
   */
  const visitorRows = useMemo(
    () => computeNewVisitors(students, snapshots, settings, now, events),
    [students, snapshots, settings, now, events],
  );
  const newVisitors = useMemo(
    () =>
      activeGathering
        ? visitorRows.filter((row) => row.gatheringKey === activeGathering.key)
        : visitorRows,
    [visitorRows, activeGathering],
  );

  /*
   * Who has a parent on file is Planning Center's answer, not the roster's: a
   * roster read reports `profileComplete: null` for everybody, because
   * hydrating households is not work a counselor should wait through at a door.
   * Asked here, by the one screen that lists the students nobody can reach.
   */
  const parentContact = useParentContact();
  const incompleteRows = useMemo(
    () => computeIncompleteProfiles(students, parentContact.reachable),
    [students, parentContact.reachable],
  );

  /*
   * The two session-held answers a follow-up file needs and its rows do not
   * carry: who can be reached, and when each backend last answered. Assembled
   * once here rather than in three cards, so all three files agree.
   */
  const exportContext = useMemo(
    () => ({ reachable: parentContact.reachable, backends: rosterBackends }),
    [parentContact.reachable, rosterBackends],
  );
  /*
   * Narrowed to the gathering the tabs are showing, like every other list here.
   *
   * An unfinished profile is a fact about the roster rather than about a night,
   * so this card used to ignore the tabs entirely — and read as though picking
   * Friday had done nothing. "Who do we see on a Friday and cannot reach" is
   * the question a leader is actually asking, and `seenAt` is what answers it.
   * Students no loaded gathering has seen keep their place under "All", which
   * is where the MIA list already leaves the people no gathering can claim.
   */
  const incomplete = useMemo(
    () => (activeGathering ? seenAt(activeGathering, incompleteRows) : incompleteRows),
    [incompleteRows, activeGathering],
  );

  /*
   * Head counts always come from one gathering, even under "All".
   *
   * "17, down 5 from 22 before" was Sunday School measured against Friday
   * Fellowship — two different crowds, and a number that read as a collapse
   * every time the two took turns. The most recent gathering answers for the
   * tile, and the tile says which one it was.
   */
  const headCount = activeGathering ?? gatherings[0] ?? null;
  const summary = useMemo(
    () =>
      computeSummary({ snapshots: headCount?.snapshots ?? [], mia, newVisitors, incomplete }),
    [headCount, mia, newVisitors, incomplete],
  );

  const oneOffRecaps = useMemo(
    () => computeOneOffRecaps(snapshots, { limit: ONE_OFF_WINDOW }),
    [snapshots],
  );
  const oneOffOnly = useMemo(() => computeOneOffOnly(students, snapshots), [students, snapshots]);

  if (loading) return <LoadingScreen message="Loading insights…" />;

  /*
   * The roster arrives separately from the streams — it is read from Planning
   * Center — and every list on this screen is a statement about who is on it.
   *
   * Without this the screen spends its first second saying "Nobody has missed 3
   * in a row — nice" and then replaces it with eleven names. The check-in screen
   * holds its roster behind a skeleton for exactly this reason: a list that
   * fills in after the fact is one a leader has already read and believed.
   *
   * `rosterLoading` alone, not "and there is nobody yet": the roster is the
   * union of Planning Center's people and Tally's own documents, and the second
   * half streams in from Firestore in milliseconds. Waiting only for an *empty*
   * roster therefore waited for nothing at all — five quick-added visitors were
   * enough to call it loaded and publish a call list missing everybody else.
   *
   * Only until the first read settles, though. `rosterLoading` is equally true
   * of every re-read after it, including the one fired on coming back to the
   * tab, and waiting on that meant a counselor returning from their texts
   * watched every tile blank to a dash and every list vanish — the screen they
   * had already read, taken away and handed back a second later. Once a roster
   * has landed once, these numbers are computed from a real one, and a
   * revalidation has nothing to correct until it comes back different.
   */
  const awaitingRoster = rosterLoading && !rosterSettled;
  /*
   * The same rule, for the same reason, about the other read this screen makes:
   * who has a parent contact is a separate question put to Planning Center, and
   * until it answers the only unreachable students Tally can name are its own
   * quick-adds. A tile that says "5" and becomes "12" a second later has already
   * been read and believed.
   */
  const awaitingContacts = parentContact.loading && !parentContact.loaded;
  const awaiting = awaitingHistory || awaitingRoster;
  /** The dash a tile shows rather than a zero it would have to take back. */
  const pending = (value: number) => (awaitingRoster ? '—' : value);
  // The most recent night there is evidence for, not merely the most recent one
  // on the calendar — "Through Friday Fellowship" must not name a night nobody
  // came to.
  const lastGathering = held[0]?.event ?? null;

  const previous = summary.previousEventCount;
  const delta = summary.lastEventCount - previous;
  const change =
    previous === 0
      ? 'first one in this window'
      : delta === 0
        ? `same as the ${previous} before`
        : `${delta > 0 ? '+' : ''}${delta} vs ${previous} before`;
  /*
   * Named under "All", where the tile would otherwise be a number about a
   * gathering the reader has not been told about — and said at all only when
   * there is a gathering behind it. With nothing on record the tile read "0 ·
   * first one in this window": a delta about a gathering that does not exist,
   * printed directly above a card saying there are none.
   */
  const deltaHint = !headCount
    ? undefined
    : activeGathering
      ? change
      : `${headCount.title} · ${change}`;

  /*
   * The tiles, as the row that is actually going to be rendered.
   *
   * Assembled first and measured second, because the template has to answer
   * their number rather than assert one: four is the usual answer, but the
   * check-out tile is non-null for any ministry that collects children, and a
   * fifth tile in a four-wide template wrapped into an implicit second row —
   * an orphan on a laptop, a half-width one under a 2+2 on a phone, for
   * exactly the ministries the feature exists for.
   */
  const tiles = [
    <StatTile key="last" label="Last gathering" value={summary.lastEventCount} hint={deltaHint} />,
    <StatTile
      key="mia"
      label="MIA"
      value={pending(summary.miaCount)}
      hint={`${settings.miaConsecutiveMisses}+ missed in a row`}
      tone={!awaitingRoster && summary.miaCount > 0 ? 'danger' : 'neutral'}
      // The one tile in the row that is a call to action, and so the one
      // that gets the tinted field.
      emphasis
    />,
    <StatTile
      key="new"
      label="New faces"
      value={pending(summary.newVisitorCount)}
      hint={`last ${settings.newVisitorWindowDays} days`}
      tone={!awaitingRoster && summary.newVisitorCount > 0 ? 'success' : 'neutral'}
    />,
    <StatTile
      key="incomplete"
      label="Incomplete"
      value={awaitingContacts ? '—' : pending(summary.incompleteCount)}
      hint="no parent contact"
      tone={
        !awaitingRoster && !awaitingContacts && summary.incompleteCount > 0 ? 'warn' : 'neutral'
      }
    />,
    /* Only for a ministry that actually collects children — see
       `checkOutRate`. Neutral whatever it says: this is a record of what got
       written down, not a score. */
    ...(summary.checkOutRate !== null
      ? [
          <StatTile
            key="checkout"
            label="Checked out"
            value={`${summary.checkOutRate}%`}
            hint="of check-ins on check-out gatherings"
            tone="neutral"
          />,
        ]
      : []),
  ];

  /*
   * Enumerated rather than computed, because Tailwind reads these as literals.
   *
   * Four tiles keep the row they were designed for: three over the left column,
   * one over the right, so the row shares the body's seam and its gutter
   * instead of running its own — which means it follows that seam when the
   * body's right column narrows at `xl`. Five cannot share a seam that is not
   * there, so they take a five-wide row of their own, and while the grid is
   * still two and three wide the odd tile out spans the pair below it rather
   * than sitting half-width beside a hole.
   */
  const tileTemplate =
    tiles.length === 5
      ? 'grid-cols-2 [&>*:last-child]:col-span-2 sm:grid-cols-3 lg:grid-cols-5 lg:[&>*:last-child]:col-span-1'
      : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-[repeat(3,minmax(0,1fr))_28rem] xl:grid-cols-[repeat(3,minmax(0,1fr))_24rem]';

  const scopeLabel = activeGathering
    ? `of ${activeGathering.title}`
    // The noun lives here rather than before it: scoped, the gathering's own
    // name is the noun ("last 8 of Sunday School"), and repeating it would read
    // as "last 8 gatherings of Sunday School".
    : `${held.length === 1 ? 'gathering' : 'gatherings'}, across every one`;

  return (
    <PageFrame width="lg">
      <header>
        <h1 className="text-xl font-bold text-ink-50">Insights</h1>
        {/*
          Two lines' room on a phone, one where the sentence fits on one.

          What this line will say — which gathering, which night, how many of
          them — is the last thing on the screen to be known, and it sits above
          everything else on it. "Reading the recent attendance…" is one line at
          any width; the sentence that replaces it is two on a phone, so the
          whole screen dropped 20px the moment the registers answered. The
          reservation costs a phone a line of air under the heading while the
          read is out, and costs a laptop nothing.
        */}
        <p className="mt-0.5 min-h-10 text-sm text-ink-500 sm:min-h-5">
          {awaitingHistory
            ? 'Reading the recent attendance…'
            : lastGathering
              ? `Through ${lastGathering.title}, ${formatShortDate(lastGathering.startAt)} · last ${held.length} ${scopeLabel}`
              : recentEvents.length > 0
                ? 'Nobody has been checked into any of the recent gatherings.'
                : 'No gatherings on record yet.'}
        </p>
        {skipped > 0 ? (
          <p className="mt-1 text-xs text-ink-600">
            {skipped === 1
              ? 'One scheduled gathering had nobody checked in, so it counts as cancelled here.'
              : `${skipped} scheduled gatherings had nobody checked in, so they count as cancelled here.`}
          </p>
        ) : null}
      </header>

      {/* Only worth offering when there is more than one gathering to tell
          apart. A ministry with a single Friday sees the screen it always saw. */}
      {tabs.length > 1 ? (
        <TabBar
          label="Show insights for"
          options={[
            { id: ALL, label: 'All' },
            ...tabs.map((gathering) => ({ id: gathering.key, label: gathering.title })),
          ]}
          selected={active}
          onSelect={setSelected}
        />
      ) : null}

      {excluded.length > 0 ? (
        <p className="text-xs text-ink-500">
          {excluded.length === 1
            ? `${excluded[0]} is not shown — you're not on it.`
            : `${excluded.slice(0, -1).join(', ')} and ${excluded[excluded.length - 1]} are not shown — you're not on them.`}
        </p>
      ) : null}

      {error ? <ErrorBanner message={`Could not load attendance history. ${error}`} /> : null}

      {/*
        No tiles at all until something has been recorded.

        With no history the row answered with four confident zeros — "MIA 0 ·
        3+ missed in a row", "New faces 0 · last 7 days" — facts derived from
        nothing, sitting above a card saying there are no gatherings on record.
        It read as "your ministry has nobody" rather than "nothing has been
        recorded yet", which is the opposite of true for a ministry setting
        Tally up. The empty state below says the one thing there is to say, and
        the profiles nobody can reach still carry their own count on their own
        card.
      */}
      {recentEvents.length > 0 ? (
        <div className={cn('grid gap-2 lg:gap-6', tileTemplate)}>{tiles}</div>
      ) : null}

      {/*
        Two columns where there is a pointer, one where there is a thumb.

        The three questions this screen answers — who drifted, who is new, who
        nobody can reach — used to be stacked in single file behind each other,
        so a leader on a laptop saw three and a half MIA names and had to scroll
        past a two-month chart to reach a two-name list. Side by side, all three
        are on one screen. The long list gets the fluid column because it is the
        one that grows; the short lists get a fixed 28rem, which is the width at
        which a name like "Bree Sandoval" stops truncating.

        At `xl` the short lists give 4rem of that back, and it is the single
        biggest density win on the screen. 1280 is the commonest laptop width;
        there the body is 992px, so a 28rem right column leaves 520 on the left
        and every MIA row rendered four lines tall with Call and Text stacked
        underneath — exactly as on a phone, on the screen whose whole job is
        "who do I phone this week". At 24rem the left column is 584 and the
        contact block folds up beside the name instead of under it: four names
        above the fold instead of three, and every name still whole — see
        `MiaList`, which had to give the phone number a line of its own to keep
        that promise at this width. 384px is what the short lists actually need —
        "Bree Sandoval" and its grade take 154 of the 214 a row leaves for a
        name there, and 384 is still wider than the 358 the same cards get on a
        phone.
      */}
      {/*
        Said once for the whole screen: three cards are waiting on the same two
        reads, and three interleaved "loading" announcements name no more than
        one does.
      */}
      {awaiting ? (
        <span role="status" className="sr-only">
          {awaitingRoster ? 'Loading the roster' : 'Loading attendance history'}
        </span>
      ) : null}

      <div className="contents lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {/*
            While the roster or the history is still in flight, the waiting
            shape is the settled shape: the same cards, in the same order, with
            the same headers, holding pulse rows where the names will land —
            drawn *by the cards themselves*, so the swap happens inside a DOM
            node that stays put.

            It used to be one anonymous skeleton card standing in for the whole
            column, with the right-hand column simply absent — so when a slow
            Planning Center answer finally came back, the entire screen below
            the tiles recomposed under a leader who had started reading it.
            What the cards will be called and roughly what a row costs are both
            known before any answer is; only the names are not, so only the
            names arrive late.
          */}
          {/*
            Whether the calendar holds anything is known before this screen
            paints at all — `loading` above holds it behind a spinner until the
            streams are in — so the ministry with no gatherings yet gets its
            empty state immediately, rather than a loading card that becomes
            one a second later.
          */}
          {recentEvents.length === 0 ? (
            <Card>
              <EmptyState
                title="No gatherings on record yet."
                description="Check a few students in and this screen fills itself: who has drifted, who is new, and who nobody can reach."
              />
            </Card>
          ) : (
            <MiaList
              items={mia}
              threshold={settings.miaConsecutiveMisses}
              loading={awaiting}
              gatheringTitle={activeGathering?.title ?? null}
              onContactAdded={parentContact.refresh}
              exportContext={exportContext}
              onResolve={handleResolve}
              sessionReleases={sessionReleases}
              onUndoSessionRelease={handleUndoSessionRelease}
              undoBusyKey={undoBusyKey}
            />
          )}
          {/*
            The ledger renders whenever there is anything to say — including
            when the list above is empty, because months on, "the tab is
            clean" must never be the only record of what was released from it.
          */}
          {recentEvents.length === 0 ? null : (
            <TransitionLedger
              rows={ledgerRows}
              showGathering={activeGathering === null}
              onUndo={handleLedgerUndo}
              undoBusyId={ledgerUndoBusyId}
            />
          )}
          {/*
            Ordered by question on a phone, by column on a laptop.

            The two column wrappers above are `display: contents` below
            `lg`, so all six sections are flex children of the page again —
            which means the desktop split cannot decide the phone's reading
            order as a side effect. It did once: the chart ended up gating
            "who is new", so a leader passed a block with no names in it to
            reach a two-name list they could act on. The chart is the one
            section here nobody phones anybody about, so it sorts after the
            three that are call lists.

            Gated on the history alone, unlike the lists beside it: every bar
            is a head count from the registers, which stream from Firestore,
            so the chart has its answer while the roster is still being read.
          */}
          {recentEvents.length === 0 ? null : (
            <AttendanceTrend
              snapshots={snapshots}
              loading={awaitingHistory}
              gatheringKey={activeGathering?.key ?? null}
              gatheringTitle={activeGathering?.title ?? null}
              className="order-5 lg:order-none"
            />
          )}
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {recentEvents.length > 0 ? (
            <NewVisitorList
              items={newVisitors}
              windowDays={settings.newVisitorWindowDays}
              loading={awaiting}
              gatheringTitle={activeGathering?.title ?? null}
              reachable={parentContact.reachable}
              onContactAdded={parentContact.refresh}
              exportContext={exportContext}
            />
          ) : null}

          {/* Scoped by the tabs like everything above it, but rendered outside
              that block on purpose: a ministry that has not run a gathering yet
              still has quick-added visitors nobody can reach, and this is the
              only list that can say so without any attendance history behind
              it. There are no tabs in that state, so it shows the whole roster
              — which is what "All" means. It still waits for the roster it is a
              statement about.

              Every one of the three lists on this screen is a view of the same
              answer — who the ministry can reach — so a contact added in any of
              them asks Planning Center again for all of them. */}
          <IncompleteProfileList
            students={incomplete}
            now={now}
            loading={awaitingRoster}
            checking={awaitingContacts}
            error={parentContact.error}
            gatheringTitle={activeGathering?.title ?? null}
            onContactAdded={parentContact.refresh}
            exportContext={exportContext}
          />

          {/* Outside the tabs on purpose: a one-off belongs to no chain of
              repeats, so it neither filters by one nor answers the questions
              they do.

              Not gated on the roster, unlike the call lists above: a recap is
              a head count, and head counts come from the registers. Holding
              both cards back until the slowest read of the screen returned
              meant the one card that already had its answer arrived with the
              rest — landing at the foot of a column somebody was reading. */}
          {oneOffRecaps.length > 0 || oneOffOnly.length > 0 ? (
            <>
              <OneOffRecapList items={oneOffRecaps} className="order-6 lg:order-none" />
              <OneOffOnlyList
                items={oneOffOnly}
                className="order-4 lg:order-none"
                exportContext={exportContext}
              />
            </>
          ) : null}
        </div>
      </div>

      <ReleaseDialog
        target={pendingRelease?.target ?? null}
        threshold={settings.miaConsecutiveMisses}
        busy={releaseBusy}
        onClose={() => setPendingRelease(null)}
        onConfirm={confirmRelease}
      />
    </PageFrame>
  );
}
