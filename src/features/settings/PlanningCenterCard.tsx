/**
 * Planning Center sync status and the manual trigger.
 *
 * The sync itself lives in a Cloud Function — the Personal Access Token must
 * never reach a browser — so this card's whole job is to explain what that
 * function last did, in terms a youth pastor can act on. It states the roster
 * source and write-back mode it ran with, because "why is this student not in
 * Tally?" is almost always answered by one of those two settings rather than by
 * a failure.
 */
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorBanner,
  Spinner,
  type BadgeProps,
} from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { formatDateTime, formatRelative } from '@/lib/time';
import { syncPlanningCenterNow } from '@/services/functions';
import { subscribePcoSyncState } from '@/services/pcoSync';
import type {
  PcoRosterSource,
  PcoSyncCounts,
  PcoSyncState,
  PcoSyncStatus,
  PcoWriteBackMode,
} from '@/types';

const STATUS_META: Record<PcoSyncStatus, { label: string; tone: BadgeProps['tone'] }> = {
  never: { label: 'Not set up', tone: 'neutral' },
  running: { label: 'Running', tone: 'brand' },
  ok: { label: 'Healthy', tone: 'success' },
  error: { label: 'Last run failed', tone: 'danger' },
};

const ROSTER_SOURCE_LABEL: Record<PcoRosterSource, string> = {
  list: 'a Planning Center list',
  grade: 'grade fields on each person',
};

const WRITE_BACK_LABEL: Record<PcoWriteBackMode, string> = {
  off: 'Tally never writes to Planning Center.',
  create: 'Tally creates new people in Planning Center but never edits existing ones.',
  full: 'Tally creates and updates people in Planning Center.',
};

const COUNTS: readonly { key: keyof PcoSyncCounts; label: string }[] = [
  { key: 'peopleScanned', label: 'Scanned' },
  { key: 'studentsCreated', label: 'Created' },
  { key: 'studentsUpdated', label: 'Updated' },
  { key: 'studentsDeactivated', label: 'Deactivated' },
  { key: 'teamMembersMapped', label: 'Team mapped' },
  { key: 'visitorsPushed', label: 'Pushed out' },
];

export function PlanningCenterCard() {
  const { show } = useToast();
  const [state, setState] = useState<PcoSyncState | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => subscribePcoSyncState(setState, (cause) => setStreamError(cause.message)),
    [],
  );

  const runSync = async (full: boolean) => {
    setBusy(true);
    try {
      const result = await syncPlanningCenterNow(full ? { full: true } : {});
      const { status, message } = result.data;
      show(message || (status === 'ok' ? 'Sync finished.' : 'Sync did not finish.'), {
        tone: status === 'ok' ? 'success' : status === 'already-running' ? 'info' : 'error',
      });
    } catch (cause) {
      show(cause instanceof Error ? cause.message : 'Could not reach the sync function.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const running = state?.status === 'running';
  const meta = state ? STATUS_META[state.status] : null;
  const lastRunAt = state?.finishedAt ?? state?.startedAt ?? null;

  return (
    <Card>
      <CardHeader
        title="Planning Center"
        description="People come from Planning Center; Tally mirrors them."
        action={
          meta ? (
            <Badge tone={meta.tone}>
              {running ? <Spinner className="size-3 border-current" label="Sync running" /> : null}
              {meta.label}
            </Badge>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 px-4 py-3">
        {streamError ? <ErrorBanner message={`Could not read sync status. ${streamError}`} /> : null}

        {!state ? (
          <p className="flex items-center gap-2 text-sm text-ink-400">
            <Spinner className="size-4" /> Checking sync status…
          </p>
        ) : state.status === 'never' ? (
          <p className="text-sm text-ink-300">
            No sync has run yet — Planning Center has not been connected. Add the Personal Access
            Token and roster settings described in{' '}
            <code className="rounded bg-ink-800 px-1 text-xs text-ink-200">
              docs/planning-center.md
            </code>
            , then run the first sync. Nothing is broken until then; Tally simply has no people to
            mirror.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-300">
              Last run{' '}
              {lastRunAt ? (
                <span className="font-semibold text-ink-100" title={formatDateTime(lastRunAt)}>
                  {formatRelative(lastRunAt)}
                </span>
              ) : (
                'unknown'
              )}
              {state.triggeredBy ? ' · run by hand' : ' · scheduled run'}
              {state.lastFullSyncAt
                ? ` · full sweep ${formatRelative(state.lastFullSyncAt)}`
                : ''}
              .
            </p>

            <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {COUNTS.map((entry) => (
                <div key={entry.key} className="rounded-xl bg-ink-950/60 px-2 py-1.5 ring-1 ring-ink-800">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
                    {entry.label}
                  </dt>
                  <dd className="text-lg font-bold tabular-nums text-ink-50">
                    {state.counts[entry.key]}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="text-xs text-ink-500">
              Roster comes from {ROSTER_SOURCE_LABEL[state.rosterSource]}.{' '}
              {WRITE_BACK_LABEL[state.writeBack]}
              {state.cursor
                ? ` Incremental runs pick up from ${formatDateTime(state.cursor)}.`
                : ''}
            </p>

            {state.counts.errors > 0 && state.status !== 'error' ? (
              <p className="text-xs text-warn-400">
                {state.counts.errors} {state.counts.errors === 1 ? 'record' : 'records'} were
                skipped on the last run.
              </p>
            ) : null}

            {state.status === 'error' && state.lastError ? (
              <ErrorBanner message={state.lastError} />
            ) : null}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void runSync(false)} loading={busy} disabled={running}>
            {running ? 'Sync in progress…' : 'Sync now'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runSync(true)}
            disabled={busy || running}
          >
            Full re-sync
          </Button>
        </div>
        <p className="text-xs text-ink-500">
          A normal sync only asks Planning Center for people changed since the last run. A full
          re-sync ignores that cursor and walks the whole roster — slower, and the thing to reach
          for when somebody was edited in Planning Center but never appeared here.
        </p>
      </div>
    </Card>
  );
}
