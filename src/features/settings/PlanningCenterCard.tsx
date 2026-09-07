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
import type { PcoStatus, PcoWriteBackMode } from '@/types';
import { useTranslations } from 'use-intl';

const WRITE_BACK_LABEL = {
  off: 'pcoWriteOff',
  create: 'pcoWriteCreate',
  full: 'pcoWriteFull',
} as const satisfies Record<PcoWriteBackMode, string>;

export function PlanningCenterCard() {
  const t = useTranslations('Backends');
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
      setError(cause instanceof Error ? cause.message : t('pcoAskFailed'));
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
  }, [t]);

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
      show(t('pcoRefreshed'), { tone: 'success' });
    } catch {
      show(t('pcoRefreshFailed'), { tone: 'error' });
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
    show(t('pcoSaved'), { tone: 'success' });
  };

  return (
    <Card>
      <CardHeader
        title={t('pcoTitle')}
        description={t('pcoDescription')}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refresh()} loading={busy}>
              {t('refresh')}
            </Button>
            <Button size="sm" onClick={() => setEditing(true)} disabled={!status}>
              {t('change')}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 px-4 py-3">
        {error ? <ErrorBanner message={error} /> : null}

        {loading && !status ? (
          <>
            {/*
             * Three pulsing bars are furniture, not content, so the skeleton
             * says nothing — which left a screen reader with silence between
             * the card's description and the facts arriving. This card names
             * what it is waiting for, because "loading" is not the answer to
             * "is Planning Center working".
             *
             * The skeleton is hidden here rather than asked to stay quiet: it
             * is a shared component whose own announcement is not this card's
             * to rely on, and one loading region must not have two voices.
             */}
            <span role="status" className="sr-only">
              {t('pcoChecking')}
            </span>
            <div aria-hidden="true">
              <SkeletonRows count={3} />
            </div>
          </>
        ) : status ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {!status.configured ? (
                <Badge tone="warn">{t('notSetUp')}</Badge>
              ) : status.reachable ? (
                <Badge tone="success">{t('connected')}</Badge>
              ) : (
                <Badge tone="danger">{t('unreachable')}</Badge>
              )}

              {status.peopleVisible !== null ? (
                <span className="text-sm text-ink-300">
                  <span className="font-semibold tabular-nums text-ink-100">
                    {status.peopleVisible}
                  </span>{' '}
                  {t('studentsVisible', { count: status.peopleVisible })}
                </span>
              ) : null}

              {status.baseUrlOverridden ? (
                // Requests are going somewhere other than Planning Center's own
                // API — a proxy, a cache, a test rig. Which of those it is, only
                // the person who set it knows, so the badge states the fact and
                // the address rather than guessing at the intent. It must never
                // be a silent state on a screen that otherwise says "Connected".
                <Badge tone="warn" title={t('requestsGoTo', { url: status.settings.baseUrl })}>
                  {t('customApiAddress')}
                </Badge>
              ) : null}
            </div>

            {status.problem ? (
              <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
                {status.problem}
              </p>
            ) : null}

            {rosterOffline ? (
              <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
                {t('pcoRosterOffline')}
              </p>
            ) : null}

            {/*
             * Three facts, laid out by how much width this card actually has.
             *
             * Stacked they were three full-measure lines — and in a page frame
             * that widens to `max-w-7xl` that measure was the whole card. The
             * width belongs to columns instead, but only where a column is
             * still readable: `auto-fit` takes another one each time 15rem is
             * free and otherwise leaves the list stacked, so this reads as two
             * or three columns of fact on a wide laptop and as one column on a
             * phone, without a breakpoint guessing at either.
             */}
            <dl className="grid gap-2 text-sm lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] lg:gap-x-6">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{t('headingRoster')}</dt>
                <dd className="text-ink-300">
                  {t('pcoRosterNote')}
                  {status.unresolved > 0 ? (
                    <span className="block text-warn-400">
                      {t('pcoUnresolved', { count: status.unresolved })}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  {t('headingWriteBack')}
                </dt>
                <dd className="text-ink-300">
                  {t(WRITE_BACK_LABEL[status.settings.writeBack])}
                  {/*
                   * Sits under the mode rather than under Roster so the two are
                   * read together: a queue and an "off" beside each other say
                   * plainly that nothing is draining it.
                   */}
                  {status.queued > 0 ? (
                    <span
                      className={
                        status.settings.writeBack === 'off'
                          ? 'block text-warn-400'
                          : 'block text-ink-500'
                      }
                    >
                      {status.settings.writeBack === 'off'
                        ? t('pcoQueuedWriteOff', { count: status.queued })
                        : t('pcoQueued', { count: status.queued })}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  {t('headingFreshness')}
                </dt>
                <dd className="text-ink-300">
                  {status.settings.cacheTtlSeconds === 0
                    ? t('pcoCacheOff')
                    : t('pcoCacheOn', { count: status.settings.cacheTtlSeconds })}
                  {rosterFetchedAt ? (
                    <span className="block text-ink-500">
                      {t('lastReadHere', { when: formatRelative(rosterFetchedAt) })}
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-ink-500">
              {status.settings.managedInApp && stored?.updatedAt
                ? t('changedHere', { when: formatRelative(stored.updatedAt) })
                : t('fromDeploy')}
              {profile?.role === 'admin'
                ? t('secretManagerNote')
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
