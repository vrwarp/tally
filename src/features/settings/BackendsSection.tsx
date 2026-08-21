/**
 * The Attendees connection, and — once two backends are on — where new
 * students go.
 *
 * One component for both cards because they are two views of one answer:
 * `getBackendStatuses` probes every backend Tally knows and says which one
 * receives pushes, and asking twice would probe every backend twice. The
 * Planning Center card above keeps its own, older callable and its own
 * behaviour; this section is everything that only exists because there can be
 * more than one backend.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, ErrorBanner, SkeletonRows } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { Attendees32Editor } from '@/features/settings/Attendees32Editor';
import { formatRelative } from '@/lib/time';
import { refreshPlanningCenter } from '@/services/functions';
import {
  fetchBackendStatuses,
  readA32EffectiveSettings,
  readAttendees32Config,
  saveDefaultPushBackend,
  type A32StoredConfig,
} from '@/services/backends';
import {
  BACKEND_LABELS,
  type BackendId,
  type BackendStatus,
  type BackendStatuses,
  type PcoWriteBackMode,
} from '@/types';

const WRITE_BACK_LABEL: Record<PcoWriteBackMode, string> = {
  off: 'Tally never writes to Attendees. Visitors stay queued until this is turned on.',
  create: 'Tally creates attendees it has not seen before, but never edits an existing one.',
  full: 'Tally creates attendees, and Edit profile saves a linked student’s name, grade, allergies and birthday straight to Attendees. It can also add a parent to the family and fill in their phone or email.',
};

export function BackendsSection() {
  const { show } = useToast();
  const { profile, user } = useAuth();
  const { refreshRoster } = useData();

  const [statuses, setStatuses] = useState<BackendStatuses | null>(null);
  const [stored, setStored] = useState<A32StoredConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);

  const check = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setStatuses(await fetchBackendStatuses(force));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not ask Tally about the connections.',
      );
    } finally {
      setLoading(false);
    }
    // What is *saved* is a Firestore fact, and a missing document is the
    // ordinary state of a backend never set up — a failure here must not
    // colour the connection itself.
    try {
      setStored(await readAttendees32Config());
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
      // Drops every backend's server-side cache, then carries `force` on the
      // reads themselves — the cache is per-instance, so the drop alone only
      // ever reaches one of them.
      await refreshPlanningCenter();
      await Promise.all([check(true), refreshRoster(true)]);
      show('Read the roster again from every connected backend', { tone: 'success' });
    } catch {
      show('Could not refresh the connections.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const afterSave = async () => {
    await Promise.all([check(true), refreshRoster(true)]);
    show('Attendees settings saved', { tone: 'success' });
  };

  const pickDefault = async (backendId: BackendId) => {
    if (!user || picking || backendId === statuses?.defaultPushBackend) return;
    setPicking(true);
    try {
      await saveDefaultPushBackend(backendId, user.uid);
      await check();
      show(`New students now go to ${BACKEND_LABELS[backendId]}`, { tone: 'success' });
    } catch {
      show('Could not change where new students go.', { tone: 'error' });
    } finally {
      setPicking(false);
    }
  };

  const a32 = statuses?.backends.find((backend) => backend.backendId === 'a32') ?? null;
  const settings = a32 ? readA32EffectiveSettings(a32.settings) : null;
  const enabledBackends = statuses?.backends.filter((backend) => backend.enabled) ?? [];

  return (
    <>
      <Card>
        <CardHeader
          title="Attendees"
          description="A second place Tally can read people from, beside Planning Center."
          action={
            <div className="flex items-center gap-2">
              {/* Nothing to refresh until something is connected. */}
              {a32?.configured ? (
                <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={busy}>
                  Refresh
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setEditing(true)} disabled={!a32}>
                Change
              </Button>
            </div>
          }
        />

        <div className="flex flex-col gap-3 px-4 py-3">
          {error ? <ErrorBanner message={error} /> : null}

          {loading && !a32 ? (
            <>
              {/* Named, and said once — see the Planning Center card. */}
              <span role="status" className="sr-only">
                Checking the Attendees connection
              </span>
              <div aria-hidden="true">
                <SkeletonRows count={2} />
              </div>
            </>
          ) : a32 && settings ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {!a32.configured ? (
                  <Badge tone="warn">Not set up</Badge>
                ) : !a32.enabled ? (
                  <Badge tone="neutral">Switched off</Badge>
                ) : a32.reachable ? (
                  <Badge tone="success">Connected</Badge>
                ) : (
                  <Badge tone="danger">Unreachable</Badge>
                )}

                {a32.peopleVisible !== null ? (
                  <span className="text-sm text-ink-300">
                    <span className="font-semibold tabular-nums text-ink-100">
                      {a32.peopleVisible}
                    </span>{' '}
                    {a32.peopleVisible === 1 ? 'student' : 'students'} visible
                  </span>
                ) : null}
              </div>

              {a32.problem ? (
                <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
                  {a32.problem}
                </p>
              ) : null}

              {/*
               * Columns where there is width for columns, one column where
               * there is not — the same `auto-fit` list as the Planning Center
               * card above, and for the same reason: stacked, these facts were
               * set at the full measure of a card in a page frame that widens
               * to `max-w-7xl`. A column is only taken when 15rem is free for
               * it, so nothing is ever squeezed into a measure too narrow to
               * read.
               */}
              {a32.configured ? (
                <dl className="grid gap-2 text-sm lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] lg:gap-x-6">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                      Roster
                    </dt>
                    <dd className="text-ink-300">
                      Students added from Attendees keep their Attendees record as the source of
                      their name, grade and family — exactly as Planning Center students do theirs.
                      {a32.unresolved > 0 ? (
                        <span className="block text-warn-400">
                          {a32.unresolved} {a32.unresolved === 1 ? 'student is' : 'students are'} on
                          the roster but can no longer be read from Attendees — removed upstream.
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                      Write-back
                    </dt>
                    <dd className="text-ink-300">{WRITE_BACK_LABEL[settings.writeBack]}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-ink-300">
                  Nothing is connected yet. Run the setup command on your Attendees server, put its
                  token in Secret Manager, then enter the addresses and slugs it prints under
                  Change.
                </p>
              )}

              <p className="text-xs text-ink-500">
                {settings.managedInApp && stored?.updatedAt
                  ? `Changed here ${formatRelative(stored.updatedAt)}.`
                  : 'These settings came with the deploy. Changing any of them here takes over from it.'}
                {profile?.role === 'admin'
                  ? ' The token itself lives in Secret Manager and is not editable from the app.'
                  : ''}
              </p>
            </>
          ) : null}
        </div>

        {settings ? (
          <Attendees32Editor
            open={editing}
            settings={settings}
            storedBaseUrl={stored?.baseUrl ?? ''}
            onClose={() => setEditing(false)}
            onSaved={afterSave}
          />
        ) : null}
      </Card>

      {/*
       * Where new students go — rendered only once the question exists. With
       * one backend there is no choice to offer, and the server defaults to
       * Planning Center exactly as it always has.
       */}
      {statuses && enabledBackends.length >= 2 ? (
        <Card>
          <CardHeader
            title="New students"
            description="Which system a student created in Tally — a quick-add at the door — is pushed to."
          />
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {enabledBackends.map((backend: BackendStatus) => {
                const chosen = backend.backendId === statuses.defaultPushBackend;
                return (
                  <Button
                    key={backend.backendId}
                    size="sm"
                    variant={chosen ? 'primary' : 'secondary'}
                    disabled={picking}
                    onClick={() => void pickDefault(backend.backendId)}
                  >
                    {chosen ? '✓ ' : ''}
                    {backend.displayName}
                  </Button>
                );
              })}
            </div>
            {statuses.queued > 0 ? (
              <p className="text-sm text-ink-300">
                {statuses.queued} {statuses.queued === 1 ? 'student is' : 'students are'} queued and
                will go to {BACKEND_LABELS[statuses.defaultPushBackend]} on the next push.
              </p>
            ) : (
              <p className="text-sm text-ink-500">
                Students already linked to a backend are not moved by this — it decides only where
                a brand-new student's record is created.
              </p>
            )}
            {/*
              Counted apart from the queue on purpose: a held family is not
              stuck, it is waiting for a person. Saying "3 queued" about them
              would read as a broken push and teach somebody to ignore the line
              that means it. See functions/src/backends/pendingReview.ts.
            */}
            {statuses.heldForReview > 0 ? (
              <p className="text-sm text-ink-300">
                {statuses.heldForReview}{' '}
                {statuses.heldForReview === 1 ? 'student registered' : 'students registered'}{' '}
                themselves at the kiosk and{' '}
                {statuses.heldForReview === 1 ? 'is' : 'are'} waiting for somebody to approve them.{' '}
                <Link to="/review" className="text-brand-400 hover:underline">
                  Review them
                </Link>
                .
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}
    </>
  );
}
