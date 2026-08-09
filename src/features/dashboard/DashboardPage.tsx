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
import { useMemo, useRef, useState } from 'react';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingScreen,
  SkeletonRows,
  StatTile,
  TabBar,
} from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
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
  seenAt,
} from '@/features/dashboard/insights';
import { chainKey } from '@/lib/materialize';
import { presumedCancelled } from '@/lib/sessionHistory';
import { formatShortDate } from '@/lib/time';
import { sameItems } from '@/lib/utils';
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
  // Named under "All", where the tile would otherwise be a number about a
  // gathering the reader has not been told about.
  const deltaHint = activeGathering || !headCount ? change : `${headCount.title} · ${change}`;

  const scopeLabel = activeGathering
    ? `of ${activeGathering.title}`
    : 'across every gathering';

  return (
    <PageFrame width="lg">
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

      {excluded.length > 0 ? (
        <p className="text-xs text-ink-500">
          {excluded.length === 1
            ? `${excluded[0]} is not shown — you're not on it.`
            : `${excluded.slice(0, -1).join(', ')} and ${excluded[excluded.length - 1]} are not shown — you're not on them.`}
        </p>
      ) : null}

      {error ? <ErrorBanner message={`Could not load attendance history. ${error}`} /> : null}

      {/* Three tiles over the left column, one over the right, so the row
          shares the body's seam and its gutter instead of running its own. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-[repeat(3,minmax(0,1fr))_28rem] lg:gap-6">
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
          // The one tile in the row that is a call to action, and so the one
          // that gets the tinted field.
          emphasis
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
        {/* Only for a ministry that actually collects children — see
            `checkOutRate`. Neutral whatever it says: this is a record of what
            got written down, not a score. */}
        {summary.checkOutRate !== null ? (
          <StatTile
            label="Checked out"
            value={`${summary.checkOutRate}%`}
            hint="of check-ins on check-out gatherings"
            tone="neutral"
          />
        ) : null}
      </div>

      {/*
        Two columns where there is a pointer, one where there is a thumb.

        The three questions this screen answers — who drifted, who is new, who
        nobody can reach — used to be stacked in single file behind each other,
        so a leader on a laptop saw three and a half MIA names and had to scroll
        past a two-month chart to reach a two-name list. Side by side, all three
        are on one screen. The long list gets the fluid column because it is the
        one that grows; the short lists get a fixed 28rem, which is the width at
        which a name like "Bree Sandoval" stops truncating.
      */}
      <div className="contents lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start lg:gap-6">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
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
                onContactAdded={parentContact.refresh}
                exportContext={exportContext}
              />
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
              */}
              <AttendanceTrend
                snapshots={snapshots}
                gatheringKey={activeGathering?.key ?? null}
                gatheringTitle={activeGathering?.title ?? null}
                className="order-5 lg:order-none"
              />
            </>
          )}
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {!awaiting && recentEvents.length > 0 ? (
            <NewVisitorList
              items={newVisitors}
              windowDays={settings.newVisitorWindowDays}
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
          {awaitingRoster ? null : (
            <IncompleteProfileList
              students={incomplete}
              now={now}
              checking={awaitingContacts}
              error={parentContact.error}
              gatheringTitle={activeGathering?.title ?? null}
              onContactAdded={parentContact.refresh}
              exportContext={exportContext}
            />
          )}

          {/* Outside the tabs on purpose: a one-off belongs to no chain of
              repeats, so it neither filters by one nor answers the questions
              they do. */}
          {!awaiting && (oneOffRecaps.length > 0 || oneOffOnly.length > 0) ? (
            <>
              <OneOffRecapList items={oneOffRecaps} className="order-6 lg:order-none" />
              <OneOffOnlyList items={oneOffOnly} className="order-4 lg:order-none" />
            </>
          ) : null}
        </div>
      </div>
    </PageFrame>
  );
}
