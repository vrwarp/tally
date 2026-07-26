/**
 * What the thresholds mean *for the actual ministry*, right now.
 *
 * "MIA after 3 misses" is an abstraction; "that flags 10 of your 43 students,
 * and dropping it to 2 would flag 19" is a decision someone can make. Both
 * numbers are derived from data the app already has on the client — the same
 * pure functions the dashboard and the check-in screen use — so this costs a
 * recompute, not a query.
 */
import { useMemo } from 'react';
import { useData } from '@/context/dataContext';
import { useEventSnapshots } from '@/hooks/useEventSnapshots';
import { useNow } from '@/hooks/useNow';
import { buildRoster } from '@/features/roster/predictiveRoster';
import { computeMia } from '@/features/dashboard/insights';
import { cn } from '@/lib/utils';
import type { AppSettings, TallyEvent } from '@/types';

/** Enough history for the widest window a threshold can ask for. */
const HISTORY_EVENTS = 14;

export interface ThresholdPreviewProps {
  /** The *draft* settings, so the numbers move as the fields do. */
  draft: Pick<AppSettings, 'predictiveMinAttended' | 'predictiveOfLastN' | 'miaConsecutiveMisses'>;
  /** The values currently saved, for an at-a-glance "this would change things". */
  saved: Pick<AppSettings, 'predictiveMinAttended' | 'predictiveOfLastN' | 'miaConsecutiveMisses'>;
  /** False while the draft is out of range — numbers from it would be nonsense. */
  valid: boolean;
}

export function ThresholdPreview({ draft, saved, valid }: ThresholdPreviewProps) {
  const { students, events, series, settings } = useData();
  const now = useNow(60_000);

  const history = useMemo(
    () =>
      events
        .filter(
          (event) =>
            event.mode === 'recurring' &&
            event.status !== 'cancelled' &&
            event.checkInClosesAt < now,
        )
        .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
        .slice(0, HISTORY_EVENTS),
    [events, now],
  );

  const { snapshots, loading } = useEventSnapshots(history);

  const withDraft = (overrides: Partial<AppSettings>): AppSettings => ({
    ...settings,
    ...draft,
    ...overrides,
  });

  /** How many students the Recent block would hold, per series. */
  const predicted = useMemo(() => {
    if (snapshots.length === 0) return [];

    return series
      .filter((entry) => entry.active)
      .map((entry) => {
        // A synthetic event standing in for "the next one of these", so the
        // preview describes the roster a counselor will actually meet.
        const next: TallyEvent = {
          id: `preview-${entry.id}`,
          title: entry.title,
          mode: 'recurring',
          seriesId: entry.id,
          // Irrelevant to the preview: prediction reads the series' history,
          // not the pattern that will schedule the next one.
          recurrence: null,
          recurrenceRootId: null,
          startAt: now,
          endAt: now,
          checkInOpensAt: now,
          checkInClosesAt: now,
          location: null,
          notes: null,
          requiresRsvp: false,
          requiresWaiver: false,
          requiresPayment: false,
          feeCents: null,
          defaultGroupingMode: entry.defaultGroupingMode,
          status: 'scheduled',
          createdAt: now,
          updatedAt: now,
          createdBy: '',
        };

        const view = buildRoster({
          event: next,
          students,
          attendance: [],
          rsvps: [],
          history: snapshots,
          settings: withDraft({}),
        });

        return { id: entry.id, title: entry.title, recent: view.recent.length, eligible: view.counts.eligible };
      })
      .filter((entry) => entry.eligible > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, students, snapshots, now, draft.predictiveMinAttended, draft.predictiveOfLastN]);

  const miaNow = useMemo(
    () => computeMia(students, snapshots, withDraft({})).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, snapshots, draft.miaConsecutiveMisses],
  );

  const miaSaved = useMemo(
    () => computeMia(students, snapshots, { ...settings, ...saved }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, snapshots, saved.miaConsecutiveMisses],
  );

  // Showing the *saved* counts while the draft is unusable would look like the
  // draft's counts, and quietly claim a broken setting is fine.
  if (!valid) {
    return (
      <p className="text-xs text-ink-500">
        Fix the values above and this will show what they would do to your roster.
      </p>
    );
  }

  if (loading && snapshots.length === 0) {
    return (
      <p className="text-xs text-ink-500">Working out what these thresholds mean right now…</p>
    );
  }

  if (snapshots.length === 0) {
    return (
      <p className="text-xs text-ink-500">
        Once a few gatherings have happened, this will show how many students each threshold picks
        out.
      </p>
    );
  }

  const changed = miaNow !== miaSaved;

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-ink-950 px-3 py-2.5 ring-1 ring-ink-800">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        With your ministry as it stands today
      </p>

      {predicted.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-ink-300">
          {predicted.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-3">
              <span className="truncate">{entry.title}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold text-ink-100">{entry.recent}</span>
                <span className="text-ink-500"> of {entry.eligible} predicted</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="flex items-baseline justify-between gap-3 border-t border-ink-800 pt-2 text-sm text-ink-300">
        <span>Flagged as missing in action</span>
        <span className="shrink-0 tabular-nums">
          <span className={cn('font-semibold', changed ? 'text-warn-400' : 'text-ink-100')}>
            {miaNow}
          </span>
          {changed ? (
            // The delta is the point: a leader is choosing how many phone calls
            // they are signing themselves up for this week.
            <span className="text-ink-500"> · was {miaSaved}</span>
          ) : (
            <span className="text-ink-500"> students</span>
          )}
        </span>
      </p>
    </div>
  );
}
