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
 * than by a failure — and now it can also answer the follow-up, which is a
 * button rather than a deploy.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, ErrorBanner, SkeletonRows } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { PlanningCenterEditor } from '@/features/settings/PlanningCenterEditor';
import { formatRelative } from '@/lib/time';
import { refreshPlanningCenter } from '@/services/functions';
import {
  fetchPlanningCenterStatus,
  readPlanningCenterConfig,
  type PcoStoredConfig,
} from '@/services/planningCenter';
import type { PcoList, PcoStatus, PcoWriteBackMode } from '@/types';

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

/**
 * How the roster is selected, said the way a leader would say it.
 *
 * Naming the list rather than its id is the point: an id is what this setting
 * used to be, and an id on a status screen is unverifiable — nobody can tell
 * whether 1234567 is this year's roster or a camp list from 2019.
 */
function describeSource(status: PcoStatus): string {
  if (status.settings.rosterSource === 'grade') {
    return `Students are everyone marked as a child in grades ${status.settings.minGrade}–${status.settings.maxGrade}.`;
  }
  if (status.studentList) {
    return `Students come from the “${status.studentList.name}” list.`;
  }
  return status.settings.studentListId
    ? `Students come from list ${status.settings.studentListId}, which Tally could not read.`
    : 'Students come from a Planning Center list, but none has been chosen yet.';
}

function describeTeam(status: PcoStatus): string {
  if (status.counselorList) return `Sign-in is allowed for the “${status.counselorList.name}” list.`;
  return status.settings.counselorListId
    ? `Sign-in is allowed for list ${status.settings.counselorListId}, which Tally could not read.`
    : 'No counselor list is set, so sign-in falls back to your Planning Center administrators.';
}

/** Worth saying out loud on the status card, not just inside the picker. */
function listWarning(list: PcoList | null): string | null {
  if (!list) return null;
  if (list.invalid) {
    return `Planning Center says the rules behind “${list.name}” no longer work, so its members may be wrong.`;
  }
  if (!list.autoRefresh && list.refreshedAt) {
    const months = (Date.now() - list.refreshedAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months >= 6) {
      return `“${list.name}” does not refresh itself and was last run ${formatRelative(
        list.refreshedAt,
      )}. Anybody added since is not on it.`;
    }
  }
  return null;
}

export function PlanningCenterCard() {
  const { show } = useToast();
  const { profile } = useAuth();
  const { refreshRoster, rosterFetchedAt, rosterOffline } = useData();

  const [status, setStatus] = useState<PcoStatus | null>(null);
  const [stored, setStored] = useState<PcoStoredConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const check = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await fetchPlanningCenterStatus(force));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not ask Tally about the connection.');
    } finally {
      setLoading(false);
    }
    // What is *saved* is a Firestore fact, and a missing document is the
    // ordinary state of an install still running on its deploy-time parameters
    // — so a failure here must not colour the connection itself.
    try {
      setStored(await readPlanningCenterConfig());
    } catch {
      setStored(null);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // `force` on each read rather than trusting the cache drop: the server's
      // cache is per-instance, so clearing it only clears whichever instance
      // took that call. Carrying the intent on the read itself works wherever
      // the read lands.
      await refreshPlanningCenter();
      await Promise.all([check(true), refreshRoster(true)]);
      show('Read the roster again from Planning Center', { tone: 'success' });
    } catch {
      show('Could not refresh from Planning Center.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * After a save, ask again with `force`.
   *
   * The saved list is a different cache key from the old one, so a stale
   * roster is not the risk — the risk is a leader believing a change worked.
   * Re-reading is how the card can answer "and how many students does that see"
   * in the same breath.
   */
  const afterSave = async () => {
    await Promise.all([check(true), refreshRoster(true)]);
    show('Planning Center settings saved', { tone: 'success' });
  };

  const studentWarning = status ? listWarning(status.studentList) : null;
  const teamWarning = status ? listWarning(status.counselorList) : null;

  return (
    <Card>
      <CardHeader
        title="Planning Center"
        description="Where Tally reads your people from. It keeps no copy of them."
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={busy}>
              Refresh
            </Button>
            <Button size="sm" onClick={() => setEditing(true)} disabled={!status}>
              Change
            </Button>
          </div>
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

            {studentWarning ?? teamWarning ? (
              <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
                {studentWarning ?? teamWarning}
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
                  {describeSource(status)}
                  <span className="block text-ink-500">{describeTeam(status)}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Write-back
                </dt>
                <dd className="text-ink-300">{WRITE_BACK_LABEL[status.settings.writeBack]}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Freshness
                </dt>
                <dd className="text-ink-300">
                  {describeCache(status.settings.cacheTtlSeconds)}
                  {rosterFetchedAt ? (
                    <span className="block text-ink-500">
                      This device last read it {formatRelative(rosterFetchedAt)}.
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-ink-500">
              {status.settings.managedInApp && stored?.updatedAt
                ? `Changed here ${formatRelative(stored.updatedAt)}.`
                : 'These settings came with the deploy. Changing any of them here takes over from it.'}
              {profile?.role === 'admin'
                ? ' The credentials themselves live in Secret Manager and are not editable from the app.'
                : ''}
            </p>
          </>
        ) : null}
      </div>

      {status ? (
        <PlanningCenterEditor
          open={editing}
          settings={status.settings}
          storedBaseUrl={stored?.baseUrl ?? ''}
          onClose={() => setEditing(false)}
          onSaved={afterSave}
        />
      ) : null}
    </Card>
  );
}
