/**
 * Importing a gathering's history from Planning Center Check-Ins.
 *
 * The church ran its door kiosk for years before Tally: Footprints alone is a
 * hundred-odd Friday nights of check-ins. This modal brings one of those
 * events across whole — every night anybody attended becomes a Tally
 * gathering in one recurrence chain, everyone who attended joins the roster,
 * and every check-in becomes an attendance record. From then on the gathering
 * is an ordinary Tally event: the chain keeps projecting future nights, the
 * predictive roster reads the imported history, and the dashboard's trends
 * reach back to the kiosk era.
 *
 * The Check-Ins API is read-only, so this is structurally incapable of
 * changing anything upstream — worth saying in the UI, because "import" tools
 * that write back are common enough to make a leader hesitate.
 *
 * Re-importing is supported and safe: it tops the chain up with nights since
 * the last run and never overwrites anything a leader has edited in Tally.
 */
import { useEffect, useState } from 'react';
import { PlanningCenterErrorDetails } from '@/components/PlanningCenterErrorDetails';
import { Badge, Button, ErrorBanner, Modal, SkeletonRows } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { pcoErrorReport } from '@/lib/pcoErrors';
import { importCheckInsEvent, listCheckInsEvents } from '@/services/functions';
import {
  BACKEND_LABELS,
  type BackendId,
  type CheckInsEventSummary,
  type CheckInsImportSummary,
  type PcoErrorReport,
} from '@/types';
import { useLocale, useTranslations } from 'use-intl';

export interface ImportCheckInsModalProps {
  open: boolean;
  onClose: () => void;
}

/** One importable event, remembering which backend offered it. */
type SourcedEvent = CheckInsEventSummary & { backendId: BackendId };

/** "Jan 2024" — the era a leader recognises an event's history by. */
function formatSince(locale: string, iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  // The reader's language, not the browser's — `Intl`'s default is the device's
  // and this app's is a setting.
  return date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}

function EventRow({
  event,
  importing,
  disabled,
  showSource,
  onImport,
}: {
  event: SourcedEvent;
  importing: boolean;
  disabled: boolean;
  /** Label the row with its backend — only once there is more than one. */
  showSource: boolean;
  onImport: (event: SourcedEvent) => void;
}) {
  const t = useTranslations('Import');
  const locale = useLocale();
  const since = formatSince(locale, event.firstGatheringAt);
  const facts = [
    t('gatheringCount', { count: event.gatheringCount }),
    t('checkInCount', { count: event.checkInCount }),
    ...(since ? [t('since', { when: since })] : []),
  ].join(' · ');

  return (
    <li
      className="flex items-center justify-between gap-3 rounded-xl bg-ink-900 px-3 py-2 ring-1 ring-ink-800"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink-100">{event.name}</span>
          {showSource ? <Badge tone="neutral">{BACKEND_LABELS[event.backendId]}</Badge> : null}
          {event.alreadyImported ? <Badge tone="success">{t('imported')}</Badge> : null}
        </span>
        <span className="block text-xs text-ink-500">
          {event.frequency && event.frequency !== 'None'
            ? t('withFrequency', { frequency: event.frequency, facts })
            : facts}
        </span>
      </span>

      <Button
        size="sm"
        variant={event.alreadyImported ? 'secondary' : 'primary'}
        loading={importing}
        disabled={disabled && !importing}
        onClick={() => onImport(event)}
      >
        {event.alreadyImported ? t('reImport') : t('import')}
      </Button>
    </li>
  );
}

function Summary({ summary }: { summary: CheckInsImportSummary }) {
  const t = useTranslations('Import');
  const { gatherings, students, checkIns } = summary;

  const skippedParts = [
    ...(checkIns.skippedVolunteers > 0
      ? [t('skippedVolunteers', { count: checkIns.skippedVolunteers })]
      : []),
    ...(checkIns.skippedOneTimeGuests > 0
      ? [t('skippedGuests', { count: checkIns.skippedOneTimeGuests })]
      : []),
    ...(checkIns.duplicatesCollapsed > 0
      ? [t('duplicatesCollapsed', { count: checkIns.duplicatesCollapsed })]
      : []),
    ...(checkIns.kept > 0
      ? [t('keptRows', { count: checkIns.kept })]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-present-500/10 p-4 ring-1 ring-present-500/25">
      <p className="text-sm font-semibold text-present-400">
        {t('summaryTitle', { name: summary.eventName })}
      </p>
      <ul className="flex flex-col gap-1 text-sm text-ink-200">
        <li>
          {t('summaryGatherings', { count: gatherings.created + gatherings.existing })}
          {gatherings.created > 0 && gatherings.existing > 0
            ? t('summaryGatheringsNew', { count: gatherings.created })
            : ''}
          {gatherings.skippedEmpty > 0
            ? t('summaryGatheringsSkipped', { count: gatherings.skippedEmpty })
            : ''}
        </li>
        <li>
          {t('summaryStudents', { count: students.found })}
          {students.added > 0
            ? t('summaryStudentsAdded', { count: students.added })
            : t('summaryStudentsAllPresent')}
        </li>
        <li>{t('summaryCheckIns', { count: checkIns.written })}</li>
      </ul>
      {skippedParts.length > 0 ? (
        <p className="text-xs text-ink-400">{skippedParts.join(' · ')}</p>
      ) : null}
      {summary.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-warn-400">
          {summary.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ImportCheckInsModal({ open, onClose }: ImportCheckInsModalProps) {
  const t = useTranslations('Import');
  const tCommon = useTranslations('Common');
  const locale = useLocale();
  const { show } = useToast();
  const { refreshRoster, rosterBackends } = useData();

  /*
   * Which backends to offer history from. The roster's own per-backend report
   * lists the enabled ones; before it exists — cold start, older server — the
   * one source there has ever been is Planning Center. A backend that turns
   * out to have no history to offer answers with a refusal that is handled
   * per source below, so over-asking is safe.
   */
  const sources: BackendId[] =
    rosterBackends.length > 0 ? rosterBackends.map((entry) => entry.backendId) : ['pco'];
  const multiSource = sources.length >= 2;
  // A string, so the listing effect can re-run when the set of backends
  // genuinely changes — a roster read landing just after the modal opened —
  // without re-listing on every roster tick.
  const sourcesKey = sources.join('|');

  const [events, setEvents] = useState<SourcedEvent[] | null>(null);
  const [error, setError] = useState<PcoErrorReport | null>(null);
  /** Sources whose list could not be read while another's could. */
  const [listDown, setListDown] = useState<string[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CheckInsImportSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setEvents(null);
    setError(null);
    setListDown([]);
    setImportingId(null);
    setSummary(null);

    let cancelled = false;
    void Promise.all(
      sources.map(async (backendId) => {
        try {
          const response = await listCheckInsEvents({ backendId });
          return { backendId, events: response.data.events, cause: null };
        } catch (cause) {
          return { backendId, events: null, cause };
        }
      }),
    ).then((settled) => {
      if (cancelled) return;
      const answered = settled.filter((entry) => entry.events !== null);
      if (answered.length === 0) {
        setEvents([]);
        setError(pcoErrorReport(settled[0]?.cause, t('readFailed')));
        return;
      }
      setEvents(
        answered.flatMap((entry) =>
          entry.events!.map((event) => ({ ...event, backendId: entry.backendId })),
        ),
      );
      setListDown(
        settled
          .filter((entry) => entry.events === null)
          .map((entry) => BACKEND_LABELS[entry.backendId]),
      );
    });

    return () => {
      cancelled = true;
    };
    // `sources` itself changes identity every render; the key only changes
    // when the set of backends does, which is exactly when re-listing is due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourcesKey]);

  const runImport = async (event: SourcedEvent) => {
    setImportingId(`${event.backendId}:${event.id}`);
    setError(null);
    setSummary(null);
    try {
      const { data } = await importCheckInsEvent({
        pcoEventId: event.id,
        backendId: event.backendId,
      });
      setSummary(data);
      setEvents(
        (current) =>
          current?.map((candidate) =>
            candidate.id === event.id && candidate.backendId === event.backendId
              ? { ...candidate, alreadyImported: true }
              : candidate,
          ) ?? current,
      );
      show(t('importedToast', { name: data.eventName }), { tone: 'success' });
      // The import may have added students; the roster's cache key is the
      // membership, so the next read must not reuse an answer from before it.
      await refreshRoster(true);
    } catch (cause) {
      setError(pcoErrorReport(cause, t('importFailed', { name: event.name })));
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={multiSource ? t('titleMulti') : t('titlePco')}
      description={
        multiSource
          ? t('descriptionMulti')
          : t('descriptionPco')
      }
      footer={
        <Button variant="secondary" onClick={onClose} disabled={importingId !== null}>
          {tCommon('done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <ErrorBanner
            message={error.message}
            details={<PlanningCenterErrorDetails report={error} />}
          />
        ) : null}

        {listDown.length > 0 ? (
          <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
            {t('listDown', {
              backends: new Intl.ListFormat(locale, { type: 'conjunction' }).format(listDown),
            })}
          </p>
        ) : null}

        {summary ? <Summary summary={summary} /> : null}

        {events === null ? (
          <SkeletonRows count={3} />
        ) : events.length === 0 && !error ? (
          <p className="px-1 text-sm text-ink-400">
            {multiSource
              ? t('emptyMulti')
              : t('emptyPco')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((event) => (
              <EventRow
                key={`${event.backendId}:${event.id}`}
                event={event}
                importing={importingId === `${event.backendId}:${event.id}`}
                disabled={importingId !== null}
                showSource={multiSource}
                onImport={(target) => void runImport(target)}
              />
            ))}
          </ul>
        )}

        {importingId !== null ? (
          <p className="px-1 text-xs text-ink-500">
            {t('working')}
          </p>
        ) : (
          <p className="px-1 text-xs text-ink-500">
            {t('safeToRepeat')}
          </p>
        )}
      </div>
    </Modal>
  );
}
