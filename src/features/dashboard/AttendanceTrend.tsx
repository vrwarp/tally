/**
 * Head-count trend for the recent gatherings.
 *
 * Eight bars drawn by hand: no chart library is installed and none is warranted
 * for a strip whose whole job is to answer "are we growing or shrinking?".
 *
 * The strip used to carry its own series tabs. It no longer does: the whole
 * insights screen is split by gathering now, and a second set of tabs inside
 * one card meant the bars could be showing Sunday while every list above them
 * showed Friday. The caller passes the gathering, and the strip charts it.
 */
import { useMemo } from 'react';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { computeAttendanceTrend } from '@/features/dashboard/insights';
import { formatShortDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { EventAttendanceSnapshot } from '@/types';

/** Tallest bar, in px. Fixed pixels rather than percentages so the bar heights
 *  do not depend on a flex container resolving its own height first. */
const MAX_BAR_PX = 88;
const MIN_BAR_PX = 4;

export interface AttendanceTrendProps {
  snapshots: readonly EventAttendanceSnapshot[];
  /** One chain of repeats, or null for every gathering at once. */
  gatheringKey?: string | null;
  /** Named in the description, so the card says which nights it is drawing. */
  gatheringTitle?: string | null;
  limit?: number;
}

export function AttendanceTrend({
  snapshots,
  gatheringKey = null,
  gatheringTitle = null,
  limit = 8,
}: AttendanceTrendProps) {
  const points = useMemo(
    () => computeAttendanceTrend(snapshots, { gatheringKey, limit }),
    [snapshots, gatheringKey, limit],
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
        description={
          gatheringTitle
            ? `${gatheringTitle} — head count per night, oldest to newest.`
            : 'Head count per gathering, oldest to newest. Every gathering, mixed.'
        }
      />

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
