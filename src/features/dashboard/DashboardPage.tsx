/**
 * The core team's Tuesday-morning screen (Journey 5).
 *
 * Everything above the fold is a call list: who has drifted, who just arrived,
 * whose profile is still a name and a grade. Raw numbers only appear as the
 * four tiles that decide whether any of it needs attention today, and the trend
 * strip sits last because it is context rather than an action.
 *
 * Attendance history is fetched once for a fixed window of recent gatherings
 * (see `useEventSnapshots`) — a Friday from six weeks ago will not change while
 * a leader reads this.
 */
import { useMemo } from 'react';
import { Card, EmptyState, ErrorBanner, LoadingScreen, SkeletonRows, StatTile } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useNow } from '@/hooks/useNow';
import { AttendanceTrend } from '@/features/dashboard/AttendanceTrend';
import { IncompleteProfileList } from '@/features/dashboard/IncompleteProfileList';
import { MiaList } from '@/features/dashboard/MiaList';
import { NewVisitorList } from '@/features/dashboard/NewVisitorList';
import {
  computeIncompleteProfiles,
  computeMia,
  computeNewVisitors,
  computeSummary,
} from '@/features/dashboard/insights';
import { formatShortDate } from '@/lib/time';

/**
 * How many past gatherings the dashboard reasons over. Ten covers roughly a
 * month of Fridays and Sundays together — enough to spot a drift, short enough
 * that a student who left the ministry in the autumn does not haunt the list.
 */
const GATHERING_WINDOW = 10;

export function DashboardPage() {
  const { students, events, series, settings, loading } = useData();
  const now = useNow(60_000);

  const recentGatherings = useMemo(
    () =>
      events
        .filter(
          (event) =>
            event.mode === 'recurring' &&
            event.status !== 'cancelled' &&
            // Only finished gatherings. A night still in progress would count
            // as a miss for every student who has not walked in yet, and would
            // put the whole ministry on the MIA list at 7:05pm.
            event.checkInClosesAt < now,
        )
        .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
        .slice(0, GATHERING_WINDOW),
    [events, now],
  );

  const { snapshots, loading: snapshotsLoading, error } = useEventSnapshots(recentGatherings);

  const mia = useMemo(
    () => computeMia(students, snapshots, settings),
    [students, snapshots, settings],
  );
  const newVisitors = useMemo(
    () => computeNewVisitors(students, snapshots, settings, now),
    [students, snapshots, settings, now],
  );
  const incomplete = useMemo(() => computeIncompleteProfiles(students), [students]);
  const summary = useMemo(
    () => computeSummary({ snapshots, mia, newVisitors, incomplete }),
    [snapshots, mia, newVisitors, incomplete],
  );

  if (loading) return <LoadingScreen message="Loading insights…" />;

  const lastGathering = recentGatherings[0] ?? null;
  const awaitingHistory = snapshotsLoading && snapshots.length === 0;

  const previous = summary.previousEventCount;
  const delta = summary.lastEventCount - previous;
  const deltaHint =
    previous === 0
      ? 'first one in this window'
      : delta === 0
        ? `same as the ${previous} before`
        : `${delta > 0 ? '+' : ''}${delta} vs ${previous} before`;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4">
      <header>
        <h1 className="text-xl font-bold text-ink-50">Insights</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {lastGathering
            ? `Through ${lastGathering.title}, ${formatShortDate(lastGathering.startAt)} · last ${recentGatherings.length} gatherings`
            : 'No gatherings on record yet.'}
        </p>
      </header>

      {error ? <ErrorBanner message={`Could not load attendance history. ${error}`} /> : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Last gathering" value={summary.lastEventCount} hint={deltaHint} />
        <StatTile
          label="MIA"
          value={summary.miaCount}
          hint={`${settings.miaConsecutiveMisses}+ missed in a row`}
          tone={summary.miaCount > 0 ? 'danger' : 'neutral'}
        />
        <StatTile
          label="New faces"
          value={summary.newVisitorCount}
          hint={`last ${settings.newVisitorWindowDays} days`}
          tone={summary.newVisitorCount > 0 ? 'success' : 'neutral'}
        />
        <StatTile
          label="Incomplete"
          value={summary.incompleteCount}
          hint="no parent contact"
          tone={summary.incompleteCount > 0 ? 'warn' : 'neutral'}
        />
      </div>

      {awaitingHistory ? (
        <Card>
          <span role="status" className="sr-only">
            Loading attendance history
          </span>
          <SkeletonRows count={4} />
        </Card>
      ) : recentGatherings.length === 0 ? (
        <Card>
          <EmptyState
            title="No gatherings on record yet."
            description="Check a few students in and this screen fills itself: who has drifted, who is new, and who nobody can reach."
          />
        </Card>
      ) : (
        <>
          <MiaList items={mia} threshold={settings.miaConsecutiveMisses} />
          <NewVisitorList items={newVisitors} windowDays={settings.newVisitorWindowDays} />
        </>
      )}

      {/* Independent of attendance history, so it renders even while snapshots
          are in flight or the ministry has not run an event yet. */}
      <IncompleteProfileList students={incomplete} now={now} />

      {recentGatherings.length > 0 && !awaitingHistory ? (
        <AttendanceTrend snapshots={snapshots} series={series} />
      ) : null}
    </div>
  );
}
