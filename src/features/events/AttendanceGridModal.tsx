/**
 * The one export that asks a question first.
 *
 * Three of the four exports are a button and a toast, because the rows are
 * already on screen and there is nothing to decide. This one is not: a grid has
 * to be *of* something, and neither the gathering nor how far back to go has a
 * safe default. So it follows `ImportCheckInsModal`'s shape — a modal, a couple
 * of choices, and a count of what the press will read before it is pressed.
 *
 * One gathering at a time, deliberately. Friday and Sunday are different crowds
 * — the whole app is built on that — and a matrix spanning both would have a
 * column per night of each, most of them blank for most rows. It is also what
 * makes the date headers unique: an occurrence id is a chain plus a calendar
 * day, so within one chain no two nights share a date.
 *
 * The window caps at twelve months because that is what the calendar holds:
 * `DataProvider` streams a year of event documents, so anything longer would
 * need paging the past and a wait nobody asked for. Past roughly two hundred
 * nights this should become a callable — see the plan — but nothing here is
 * anywhere near that.
 */
import { useMemo, useState } from 'react';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import { Modal, SelectField, Spinner } from '@/components/ui';
import {
  buildAttendanceGrid,
  buildAttendanceGridCsv,
} from '@/features/dashboard/attendanceGridCsv';
import { seenAt } from '@/features/dashboard/insights';
import { useData } from '@/context/dataContext';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { exportFilename } from '@/lib/csv';
import { gatheringOptions } from '@/lib/gatherings';
import { chainKey } from '@/lib/materialize';
import type { TallyEvent } from '@/types';

/** Presets rather than a date picker: these are the three questions asked. */
const WINDOWS = [
  { value: '8', label: 'Last 8 nights', nights: 8 },
  { value: '90', label: 'Last 3 months', days: 90 },
  { value: '365', label: 'Last 12 months', days: 365 },
] as const;

export interface AttendanceGridModalProps {
  open: boolean;
  onClose: () => void;
}

export function AttendanceGridModal({ open, onClose }: AttendanceGridModalProps) {
  const { events, series, students, canWork, rosterBackends } = useData();

  const gatherings = useMemo(
    // A gathering this reader is not on cannot be exported and must not be
    // offered: every one of its registers would come back refused.
    () => gatheringOptions(events, series).filter((option) => canWork({
      id: option.key,
      seriesId: null,
      recurrenceRootId: option.key,
    })),
    [events, series, canWork],
  );

  const [chain, setChain] = useState<string>('');
  const [window, setWindow] = useState<string>('90');

  const selected = chain || gatherings[0]?.key || '';
  const gathering = gatherings.find((option) => option.key === selected) ?? null;
  const preset = WINDOWS.find((entry) => entry.value === window) ?? WINDOWS[1];

  const nights = useMemo(() => {
    if (!selected) return [];
    const now = new Date();
    const chainEvents = events
      .filter(
        (event) =>
          event.mode === 'recurring' &&
          chainKey(event) === selected &&
          // A projected occurrence names a document that does not exist: its
          // register reads back empty, which would be a phantom "nobody came".
          event.materialized &&
          event.startAt <= now,
      )
      .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

    if ('nights' in preset) return chainEvents.slice(0, preset.nights);
    const cutoff = new Date(now.getTime() - preset.days * 86_400_000);
    return chainEvents.filter((event) => event.startAt >= cutoff);
  }, [events, selected, preset]);

  // Only read while the modal is up: an unopened dialog must not spend a
  // session's worth of register reads on a question nobody asked.
  const { snapshots, denied, loading } = useEventSnapshots(open ? nights : EMPTY);

  const grid = useMemo(() => {
    if (!gathering) return null;
    // The students this chain has actually seen, not every active student — a
    // twelve-child Sunday School would otherwise get eighty-five rows of zeros
    // across fifty-two columns.
    const roster = seenAt(
      {
        key: gathering.key,
        title: gathering.title,
        snapshots,
        lastHeldAt: gathering.lastStartAt,
      },
      students,
    );
    return buildAttendanceGrid({ snapshots, students: roster, denied });
  }, [gathering, snapshots, students, denied]);

  const rowCount = grid?.rows.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attendance grid"
      description="One gathering, students down and nights across — for a spreadsheet."
      footer={
        <ExportCsvButton
          variant="primary"
          build={() => ({
            filename: exportFilename({
              kind: 'attendance',
              scope: gathering?.title ?? null,
              at: new Date(),
            }),
            contents: buildAttendanceGridCsv(grid!, { backends: rosterBackends }),
          })}
          count={grid && grid.nights.length > 0 ? rowCount : 0}
          noun="students"
          label="Download CSV"
          blockedReason={loading ? 'Still reading the registers.' : null}
        />
      }
    >
      <div className="flex flex-col gap-3">
        {gatherings.length === 0 ? (
          <p className="text-sm text-ink-400">
            There are no recurring gatherings you are on to build a grid from.
          </p>
        ) : (
          <>
            <SelectField
              label="Gathering"
              value={selected}
              onChange={(changed) => setChain(changed.target.value)}
            >
              {gatherings.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.title}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="How far back"
              value={window}
              onChange={(changed) => setWindow(changed.target.value)}
            >
              {WINDOWS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </SelectField>

            {loading ? (
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <Spinner /> Reading {nights.length} {nights.length === 1 ? 'night' : 'nights'}…
              </p>
            ) : (
              <div className="flex flex-col gap-1 text-sm text-ink-400">
                <p>
                  <span className="tabular-nums text-ink-100">{grid?.nights.length ?? 0}</span>{' '}
                  {grid?.nights.length === 1 ? 'night' : 'nights'} ×{' '}
                  <span className="tabular-nums text-ink-100">{rowCount}</span>{' '}
                  {rowCount === 1 ? 'student' : 'students'}.
                </p>
                {/*
                  Said out loud rather than left to a shorter file. A grid that
                  is quietly missing three columns reads as a quieter term than
                  it was.
                */}
                {grid && grid.presumedCancelled > 0 ? (
                  <p className="text-ink-500">
                    {grid.presumedCancelled}{' '}
                    {grid.presumedCancelled === 1 ? 'night had' : 'nights had'} nobody checked in
                    and {grid.presumedCancelled === 1 ? 'is' : 'are'} left out, the way every other
                    screen treats them.
                  </p>
                ) : null}
                {grid && grid.denied > 0 ? (
                  <p className="text-warn-400">
                    {grid.denied} {grid.denied === 1 ? 'night is' : 'nights are'} not yours to read,
                    so {grid.denied === 1 ? 'it has' : 'they have'} no column here — rather than a
                    column of zeros saying nobody came.
                  </p>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Stable, so a closed modal does not hand the hook a fresh array each render. */
const EMPTY: TallyEvent[] = [];
