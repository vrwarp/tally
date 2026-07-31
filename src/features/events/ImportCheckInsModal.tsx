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
import type { CheckInsEventSummary, CheckInsImportSummary, PcoErrorReport } from '@/types';

export interface ImportCheckInsModalProps {
  open: boolean;
  onClose: () => void;
}

/** "Jan 2024" — the era a leader recognises an event's history by. */
function formatSince(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function EventRow({
  event,
  importing,
  disabled,
  onImport,
}: {
  event: CheckInsEventSummary;
  importing: boolean;
  disabled: boolean;
  onImport: (event: CheckInsEventSummary) => void;
}) {
  const since = formatSince(event.firstGatheringAt);
  const facts = [
    `${event.gatheringCount} ${event.gatheringCount === 1 ? 'gathering' : 'gatherings'}`,
    `${event.checkInCount.toLocaleString()} check-ins`,
    ...(since ? [`since ${since}`] : []),
  ].join(' · ');

  return (
    <li
      className="flex items-center justify-between gap-3 rounded-xl bg-ink-900 px-3 py-2 ring-1 ring-ink-800"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink-100">{event.name}</span>
          {event.alreadyImported ? <Badge tone="success">Imported</Badge> : null}
        </span>
        <span className="block text-xs text-ink-500">
          {event.frequency && event.frequency !== 'None' ? `${event.frequency} · ` : ''}
          {facts}
        </span>
      </span>

      <Button
        size="sm"
        variant={event.alreadyImported ? 'secondary' : 'primary'}
        loading={importing}
        disabled={disabled && !importing}
        onClick={() => onImport(event)}
      >
        {event.alreadyImported ? 'Re-import' : 'Import'}
      </Button>
    </li>
  );
}

function Summary({ summary }: { summary: CheckInsImportSummary }) {
  const { gatherings, students, checkIns } = summary;

  const skippedParts = [
    ...(checkIns.skippedVolunteers > 0
      ? [`${checkIns.skippedVolunteers} volunteer check-ins skipped (leaders, not students)`]
      : []),
    ...(checkIns.skippedOneTimeGuests > 0
      ? [
          `${checkIns.skippedOneTimeGuests} one-time ${
            checkIns.skippedOneTimeGuests === 1 ? 'guest' : 'guests'
          } skipped (no Planning Center person behind the name)`,
        ]
      : []),
    ...(checkIns.duplicatesCollapsed > 0
      ? [
          `${checkIns.duplicatesCollapsed} duplicate ${
            checkIns.duplicatesCollapsed === 1 ? 'check-in' : 'check-ins'
          } collapsed`,
        ]
      : []),
    ...(checkIns.kept > 0
      ? [`${checkIns.kept} ${checkIns.kept === 1 ? 'row' : 'rows'} kept as Tally recorded them`]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-present-500/10 p-4 ring-1 ring-present-500/25">
      <p className="text-sm font-semibold text-present-400">
        {summary.eventName} is in Tally
      </p>
      <ul className="flex flex-col gap-1 text-sm text-ink-200">
        <li>
          {gatherings.created + gatherings.existing} gatherings
          {gatherings.created > 0 && gatherings.existing > 0
            ? ` (${gatherings.created} new)`
            : ''}
          {gatherings.skippedEmpty > 0
            ? ` — ${gatherings.skippedEmpty} empty ${
                gatherings.skippedEmpty === 1 ? 'week' : 'weeks'
              } skipped`
            : ''}
        </li>
        <li>
          {students.found} students on the roster
          {students.added > 0 ? ` (${students.added} added)` : ' (all were already on it)'}
        </li>
        <li>{checkIns.written.toLocaleString()} check-ins imported</li>
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
  const { show } = useToast();
  const { refreshRoster } = useData();

  const [events, setEvents] = useState<CheckInsEventSummary[] | null>(null);
  const [error, setError] = useState<PcoErrorReport | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CheckInsImportSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setEvents(null);
    setError(null);
    setImportingId(null);
    setSummary(null);

    let cancelled = false;
    listCheckInsEvents()
      .then((response) => {
        if (!cancelled) setEvents(response.data.events);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setEvents([]);
        setError(pcoErrorReport(cause, 'Could not read your Check-Ins events.'));
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const runImport = async (event: CheckInsEventSummary) => {
    setImportingId(event.id);
    setError(null);
    setSummary(null);
    try {
      const { data } = await importCheckInsEvent({ pcoEventId: event.id });
      setSummary(data);
      setEvents(
        (current) =>
          current?.map((candidate) =>
            candidate.id === event.id ? { ...candidate, alreadyImported: true } : candidate,
          ) ?? current,
      );
      show(`${data.eventName} imported`, { tone: 'success' });
      // The import may have added students; the roster's cache key is the
      // membership, so the next read must not reuse an answer from before it.
      await refreshRoster(true);
    } catch (cause) {
      setError(pcoErrorReport(cause, `Could not import ${event.name}.`));
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import from Planning Center"
      description="Bring a Check-Ins event's whole history into Tally: every night it met, everyone who attended, and every check-in. Planning Center is only read — nothing there changes."
      footer={
        <Button variant="secondary" onClick={onClose} disabled={importingId !== null}>
          Done
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

        {summary ? <Summary summary={summary} /> : null}

        {events === null ? (
          <SkeletonRows count={3} />
        ) : events.length === 0 && !error ? (
          <p className="px-1 text-sm text-ink-400">
            Planning Center has no live Check-Ins events. Archived ones are not offered.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                importing={importingId === event.id}
                disabled={importingId !== null}
                onImport={(target) => void runImport(target)}
              />
            ))}
          </ul>
        )}

        {importingId !== null ? (
          <p className="px-1 text-xs text-ink-500">
            Reading Planning Center and writing the history… a long-running gathering can take a
            minute or two. Keep this open until it finishes.
          </p>
        ) : (
          <p className="px-1 text-xs text-ink-500">
            Importing is safe to repeat: a re-import picks up nights since the last one and never
            overwrites anything edited in Tally. Volunteers are not imported — Tally's attendance
            is a record of students.
          </p>
        )}
      </div>
    </Modal>
  );
}
