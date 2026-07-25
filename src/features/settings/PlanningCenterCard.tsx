/**
 * The Planning Center connection, as a question a leader can ask.
 *
 * This card used to be a sync console: a status badge, six counters, a "last
 * full sweep" timestamp and a Sync now button. All of that existed because Tally
 * kept a copy of the church's people and somebody had to be able to see whether
 * the copy was current.
 *
 * There is no copy any more. The roster is read from Planning Center when it is
 * needed and held for at most `cacheTtlSeconds`, so there is nothing to fall out
 * of date and nothing to watch. What is left is the only question anyone
 * actually had: *is this working, and how many of my students can Tally see?*
 *
 * It still states the roster source and write-back mode, because "why is this
 * student not in Tally?" is almost always answered by one of those two rather
 * than by a failure.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, ErrorBanner, SkeletonRows } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { formatRelative } from '@/lib/time';
import { getPlanningCenterStatus, refreshPlanningCenter } from '@/services/functions';
import type { PcoRosterSource, PcoStatus, PcoWriteBackMode } from '@/types';

const SOURCE_LABEL: Record<PcoRosterSource, string> = {
  list: 'a Planning Center list',
  grade: 'grade fields on each person',
};

const WRITE_BACK_LABEL: Record<PcoWriteBackMode, string> = {
  off: 'Tally never writes to Planning Center. Visitors stay queued until this is turned on.',
  create: 'Tally creates people it has not seen before, but never edits an existing one.',
  full: 'Tally creates people, and updates the fields Planning Center lets it manage.',
};

function describeCache(seconds: number): string {
  if (seconds === 0) {
    return 'Caching is off. Every screen asks Planning Center directly — slower, and always current.';
  }
  return `An answer is reused for up to ${seconds} ${
    seconds === 1 ? 'second' : 'seconds'
  } before Tally asks Planning Center again.`;
}

export function PlanningCenterCard() {
  const { show } = useToast();
  const { refreshRoster, rosterFetchedAt, rosterOffline } = useData();

  const [status, setStatus] = useState<PcoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getPlanningCenterStatus();
      setStatus(response.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not ask Tally about the connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Drop the server's held answer first, or "Refresh" would cheerfully hand
      // back the same cached roster and look broken.
      await refreshPlanningCenter();
      await Promise.all([check(), refreshRoster()]);
      show('Read the roster again from Planning Center', { tone: 'success' });
    } catch {
      show('Could not refresh from Planning Center.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Planning Center"
        description="Where Tally reads your people from. It keeps no copy of them."
        action={
          <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={busy}>
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-3 px-4 py-3">
        {error ? <ErrorBanner message={error} /> : null}

        {loading && !status ? (
          <SkeletonRows count={3} />
        ) : status ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {!status.configured ? (
                <Badge tone="warn">Not set up</Badge>
              ) : status.reachable ? (
                <Badge tone="success">Connected</Badge>
              ) : (
                <Badge tone="danger">Unreachable</Badge>
              )}

              {status.peopleVisible !== null ? (
                <span className="text-sm text-ink-300">
                  <span className="font-semibold tabular-nums text-ink-100">
                    {status.peopleVisible}
                  </span>{' '}
                  {status.peopleVisible === 1 ? 'student' : 'students'} visible
                </span>
              ) : null}

              {status.baseUrlOverridden ? (
                // Somebody pointed this at a test rig. That must never be a
                // silent state on a screen that otherwise says "Connected".
                <Badge tone="warn">Not the real Planning Center</Badge>
              ) : null}
            </div>

            {status.problem ? (
              <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
                {status.problem}
              </p>
            ) : null}

            {rosterOffline ? (
              <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
                This device is showing a roster it saved earlier. Check-in still works; anyone added
                since will not appear until Planning Center is reachable again.
              </p>
            ) : null}

            <dl className="flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Roster</dt>
                <dd className="text-ink-300">
                  Students come from {SOURCE_LABEL[status.rosterSource]}.
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Write-back
                </dt>
                <dd className="text-ink-300">{WRITE_BACK_LABEL[status.writeBack]}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Freshness
                </dt>
                <dd className="text-ink-300">
                  {describeCache(status.cacheTtlSeconds)}
                  {rosterFetchedAt ? (
                    <span className="block text-ink-500">
                      This device last read it {formatRelative(rosterFetchedAt)}.
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
          </>
        ) : null}
      </div>
    </Card>
  );
}
