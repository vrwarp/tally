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
import { useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';

const WRITE_BACK_LABEL = {
  off: 'a32WriteOff',
  create: 'a32WriteCreate',
  full: 'a32WriteFull',
} as const satisfies Record<PcoWriteBackMode, string>;

export function BackendsSection() {
  const time = useTimeFormats();
  const t = useTranslations('Backends');
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
        cause instanceof Error ? cause.message : t('a32AskFailed'),
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
  }, [t]);

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
      show(t('a32Refreshed'), { tone: 'success' });
    } catch {
      show(t('a32RefreshFailed'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const afterSave = async () => {
    await Promise.all([check(true), refreshRoster(true)]);
    show(t('a32Saved'), { tone: 'success' });
  };

  const pickDefault = async (backendId: BackendId) => {
    if (!user || picking || backendId === statuses?.defaultPushBackend) return;
    setPicking(true);
    try {
      await saveDefaultPushBackend(backendId, user.uid);
      await check();
      show(t('defaultChanged', { backend: BACKEND_LABELS[backendId] }), { tone: 'success' });
    } catch {
      show(t('defaultChangeFailed'), { tone: 'error' });
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
          title={t('a32Title')}
          description={t('a32Description')}
          action={
            <div className="flex items-center gap-2">
              {/* Nothing to refresh until something is connected. */}
              {a32?.configured ? (
                <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={busy}>
                  {t('refresh')}
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setEditing(true)} disabled={!a32}>
                {t('change')}
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
                {t('a32Checking')}
              </span>
              <div aria-hidden="true">
                <SkeletonRows count={2} />
              </div>
            </>
          ) : a32 && settings ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {!a32.configured ? (
                  <Badge tone="warn">{t('notSetUp')}</Badge>
                ) : !a32.enabled ? (
                  <Badge tone="neutral">{t('switchedOff')}</Badge>
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
                      {t('headingRoster')}
                    </dt>
                    <dd className="text-ink-300">
                      {t('a32RosterNote')}
                      {a32.unresolved > 0 ? (
                        <span className="block text-warn-400">
                          {t('a32Unresolved', { count: a32.unresolved })}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                      {t('headingWriteBack')}
                    </dt>
                    <dd className="text-ink-300">{t(WRITE_BACK_LABEL[settings.writeBack])}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-ink-300">
                  {t('a32NothingConnected')}
                </p>
              )}

              <p className="text-xs text-ink-500">
                {settings.managedInApp && stored?.updatedAt
                  ? t('changedHere', { when: time.relative(stored.updatedAt) })
                  : t('fromDeploy')}
                {profile?.role === 'admin'
                  ? t('tokenNote')
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
            title={t('headingNewStudents')}
            description={t('newStudentsDescription')}
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
                {t('queuedGoingTo', {
                  count: statuses.queued,
                  backend: BACKEND_LABELS[statuses.defaultPushBackend],
                })}
              </p>
            ) : (
              <p className="text-sm text-ink-500">
                {t('notMoved')}
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
                {t('heldForReview', { count: statuses.heldForReview })}{' '}
                <Link to="/review" className="text-brand-400 hover:underline">
                  {t('reviewThem')}
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
