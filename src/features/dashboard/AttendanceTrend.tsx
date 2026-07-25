/**
 * Head-count trend for the recent gatherings.
 *
 * Eight bars drawn by hand: no chart library is installed and none is warranted
 * for a strip whose whole job is to answer "are we growing or shrinking?".
 * Friday and Sunday are separate questions, so the tabs never mix them.
 *
 * The counts are printed above the bars and repeated in a visually-hidden
 * table, which leaves the bars responsible for the shape alone — no gridlines,
 * no y-axis, nothing a leader would have to squint at on a phone.
 */
import { useMemo, useState } from 'react';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { computeAttendanceTrend } from '@/features/dashboard/insights';
import { formatShortDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { EventAttendanceSnapshot, EventSeries } from '@/types';

const ALL_SERIES = 'all';
/** Tallest bar, in px. Fixed pixels rather than percentages so the bar heights
 *  do not depend on a flex container resolving its own height first. */
const MAX_BAR_PX = 88;
const MIN_BAR_PX = 4;

export interface AttendanceTrendProps {
  snapshots: readonly EventAttendanceSnapshot[];
  /** Offered as tabs; series with no history in `snapshots` are dropped. */
  series: readonly EventSeries[];
  limit?: number;
}

export function AttendanceTrend({ snapshots, series, limit = 8 }: AttendanceTrendProps) {
  const [selected, setSelected] = useState<string>(ALL_SERIES);

  const tabs = useMemo(() => {
    const withHistory = new Set(
      snapshots
        .map((snapshot) => snapshot.event.seriesId)
        .filter((id): id is string => id !== null),
    );
    return series.filter((entry) => withHistory.has(entry.id));
  }, [series, snapshots]);

  // A tab can vanish when the window scrolls past a dormant series; fall back
  // rather than render an empty chart for a series that is no longer offered.
  const active = tabs.some((tab) => tab.id === selected) ? selected : ALL_SERIES;

  const points = useMemo(
    () =>
      computeAttendanceTrend(snapshots, {
        seriesId: active === ALL_SERIES ? null : active,
        limit,
      }),
    [snapshots, active, limit],
  );

  const peak = points.reduce((max, point) => Math.max(max, point.count), 0);
  const average =
    points.length > 0
      ? Math.round(points.reduce((sum, point) => sum + point.count, 0) / points.length)
      : 0;

  return (
    <Card>
      <CardHeader
        title="Attendance trend"
        description="Head count per gathering, oldest to newest."
      />

      {tabs.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3 scroll-touch">
          <TrendTab
            label="All"
            active={active === ALL_SERIES}
            onSelect={() => setSelected(ALL_SERIES)}
          />
          {tabs.map((tab) => (
            <TrendTab
              key={tab.id}
              label={tab.title}
              active={active === tab.id}
              onSelect={() => setSelected(tab.id)}
            />
          ))}
        </div>
      ) : null}

      {points.length === 0 ? (
        <EmptyState
          title="No gatherings to chart yet."
          description="Once a couple of nights have been checked in, the trend fills in here."
        />
      ) : (
        <div className="px-3 pb-3 pt-3">
          <div className="flex items-end gap-1.5" aria-hidden="true">
            {points.map((point, index) => (
              <div
                key={point.eventId}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${point.title} · ${formatShortDate(point.date)}: ${point.count}`}
              >
                <span className="text-[10px] font-semibold tabular-nums text-ink-400">
                  {point.count}
                </span>
                <div
                  style={{
                    height: `${
                      peak > 0
                        ? Math.max(MIN_BAR_PX, Math.round((point.count / peak) * MAX_BAR_PX))
                        : MIN_BAR_PX
                    }px`,
                  }}
                  className={cn(
                    'w-full rounded-t-md',
                    // The newest gathering is the one being reacted to; the rest
                    // are context.
                    index === points.length - 1 ? 'bg-brand-400' : 'bg-brand-500/35',
                  )}
                />
                <span className="w-full truncate text-center text-[10px] text-ink-600">
                  {formatShortDate(point.date)}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 border-t border-ink-800 pt-2 text-xs text-ink-500">
            {points.length} {points.length === 1 ? 'gathering' : 'gatherings'} · peak {peak} ·
            average {average}
          </p>

          <table className="sr-only">
            <caption>Head count per gathering, oldest first.</caption>
            <thead>
              <tr>
                <th scope="col">Gathering</th>
                <th scope="col">Date</th>
                <th scope="col">Present</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.eventId}>
                  <th scope="row">{point.title}</th>
                  <td>{formatShortDate(point.date)}</td>
                  <td>{point.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TrendTab({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold ring-1 transition-colors',
        active
          ? 'bg-brand-500/15 text-brand-300 ring-brand-500/30'
          : 'bg-ink-900 text-ink-400 ring-ink-800 hover:text-ink-200',
      )}
    >
      {label}
    </button>
  );
}
