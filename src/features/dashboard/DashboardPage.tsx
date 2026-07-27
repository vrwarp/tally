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
 * Below that sit the two sections no gathering owns: profiles missing a parent
 * contact, which is a property of the roster, and one-off events, which are not
 * instances of anything and so cannot be missed, trended or streaked.
 *
 * Attendance history is fetched once for a fixed window per gathering (see
 * `useEventSnapshots`) — a Friday from six weeks ago will not change while a
 * leader reads this.
 */
import { useMemo, useState } from 'react';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
  SkeletonRows,
  StatTile,
  TabBar,
} from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useNow } from '@/hooks/useNow';
import { useParentContact } from '@/hooks/useParentContact';
import { AttendanceTrend } from '@/features/dashboard/AttendanceTrend';
import { IncompleteProfileList } from '@/features/dashboard/IncompleteProfileList';
import { MiaList } from '@/features/dashboard/MiaList';
import { NewVisitorList } from '@/features/dashboard/NewVisitorList';
import { OneOffOnlyList, OneOffRecapList } from '@/features/dashboard/OneOffInsights';
import {
  computeIncompleteProfiles,
  computeMiaByGathering,
  computeNewVisitors,
  computeOneOffOnly,
  computeOneOffRecaps,
  computeSummary,
  groupByGathering,
  mergeMia,
} from '@/features/dashboard/insights';
import { chainKey } from '@/lib/materialize';
import { presumedCancelled } from '@/lib/sessionHistory';
import { formatShortDate } from '@/lib/time';
import type { TallyEvent } from '@/types';

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
  const { students, events, series, settings, loading, rosterLoading } = useData();
  const now = useNow(60_000);
  const [selected, setSelected] = useState<string>(ALL);

  /*
   * The window, taken per gathering.
   *
   * Only finished events. A night still in progress would count as a miss for
   * every student who has not walked in yet, and would put the whole ministry
   * on the MIA list at 7:05pm.
   */
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

    return picked;
  }, [events, now]);

  const { snapshots, loading: snapshotsLoading, error } = useEventSnapshots(recentEvents);

  /*
   * The gatherings that actually happened, grouped by the chain they belong to.
   * A scheduled night with nobody checked in was cancelled, and counting it
   * would flag every student in the ministry as having missed it.
   */
  const gatherings = useMemo(() => groupByGathering(snapshots, series), [snapshots, series]);

  // A tab can vanish when the window scrolls past a dormant gathering; fall back
  // rather than render lists for a chain that is no longer offered.
  const active = gatherings.some((gathering) => gathering.key === selected) ? selected : ALL;
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
    () => computeMiaByGathering(students, snapshots, settings, series),
    [students, snapshots, settings, series],
  );
  const mia = useMemo(
    () =>
      activeGathering
        ? miaRows.filter((row) => row.gatheringKey === activeGathering.key)
        : mergeMia(miaRows),
    [miaRows, activeGathering],
  );

  const visitorRows = useMemo(
    () => computeNewVisitors(students, snapshots, settings, now),
    [students, snapshots, settings, now],
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
  const incomplete = useMemo(
    () => computeIncompleteProfiles(students, parentContact.reachable),
    [students, parentContact.reachable],
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

  const awaitingHistory = snapshotsLoading && snapshots.length === 0;
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
   */
  const awaitingRoster = rosterLoading;
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
  // Named under "All", where the tile would otherwise be a number about a
  // gathering the reader has not been told about.
  const deltaHint = activeGathering || !headCount ? change : `${headCount.title} · ${change}`;

  const scopeLabel = activeGathering
    ? `of ${activeGathering.title}`
    : 'across every gathering';

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
      <header>
        <h1 className="text-xl font-bold text-ink-50">Insights</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {awaitingHistory
            ? 'Reading the recent attendance…'
            : lastGathering
              ? `Through ${lastGathering.title}, ${formatShortDate(lastGathering.startAt)} · last ${held.length} ${held.length === 1 ? 'night' : 'nights'} ${scopeLabel}`
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
      {gatherings.length > 1 ? (
        <TabBar
          label="Show insights for"
          options={[
            { id: ALL, label: 'All' },
            ...gatherings.map((gathering) => ({ id: gathering.key, label: gathering.title })),
          ]}
          selected={active}
          onSelect={setSelected}
        />
      ) : null}

      {error ? <ErrorBanner message={`Could not load attendance history. ${error}`} /> : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label={activeGathering ? 'Last night' : 'Last gathering'}
          value={summary.lastEventCount}
          hint={deltaHint}
        />
        <StatTile
          label="MIA"
          value={pending(summary.miaCount)}
          hint={`${settings.miaConsecutiveMisses}+ missed in a row`}
          tone={!awaitingRoster && summary.miaCount > 0 ? 'danger' : 'neutral'}
        />
        <StatTile
          label="New faces"
          value={pending(summary.newVisitorCount)}
          hint={`last ${settings.newVisitorWindowDays} days`}
          tone={!awaitingRoster && summary.newVisitorCount > 0 ? 'success' : 'neutral'}
        />
        <StatTile
          label="Incomplete"
          value={awaitingContacts ? '—' : pending(summary.incompleteCount)}
          hint="no parent contact"
          tone={
            !awaitingRoster && !awaitingContacts && summary.incompleteCount > 0 ? 'warn' : 'neutral'
          }
        />
      </div>

      {awaiting ? (
        <Card>
          <span role="status" className="sr-only">
            {awaitingRoster ? 'Loading the roster' : 'Loading attendance history'}
          </span>
          <SkeletonRows count={4} />
        </Card>
      ) : recentEvents.length === 0 ? (
        <Card>
          <EmptyState
            title="No gatherings on record yet."
            description="Check a few students in and this screen fills itself: who has drifted, who is new, and who nobody can reach."
          />
        </Card>
      ) : (
        <>
          <MiaList
            items={mia}
            threshold={settings.miaConsecutiveMisses}
            gatheringTitle={activeGathering?.title ?? null}
          />
          <NewVisitorList
            items={newVisitors}
            windowDays={settings.newVisitorWindowDays}
            gatheringTitle={activeGathering?.title ?? null}
            reachable={parentContact.reachable}
          />
          <AttendanceTrend
            snapshots={snapshots}
            gatheringKey={activeGathering?.key ?? null}
            gatheringTitle={activeGathering?.title ?? null}
          />
        </>
      )}

      {/* Independent of attendance history, so it renders even while snapshots
          are in flight or the ministry has not run an event yet — but not
          before the roster it is a statement about has arrived. */}
      {awaitingRoster ? null : (
        <IncompleteProfileList
          students={incomplete}
          now={now}
          checking={awaitingContacts}
          error={parentContact.error}
        />
      )}

      {/* Outside the tabs on purpose: a one-off belongs to no chain of repeats,
          so it neither filters by one nor answers the questions they do. */}
      {!awaiting && (oneOffRecaps.length > 0 || oneOffOnly.length > 0) ? (
        <>
          <OneOffRecapList items={oneOffRecaps} />
          <OneOffOnlyList items={oneOffOnly} />
        </>
      ) : null}
    </div>
  );
}
