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

/**
 * The placeholder chart's bars, in the order it draws them.
 *
 * One of them is `MAX_BAR_PX`, which is not decoration: the tallest real bar is
 * always exactly that — every bar is scaled against the peak — so a placeholder
 * containing one is exactly as tall as the chart it stands in for. The rest
 * only have to look like a head count that moves around.
 */
const PLACEHOLDER_BARS = [40, 62, 30, MAX_BAR_PX, 52, 36, 68, 44] as const;

export interface AttendanceTrendProps {
  snapshots: readonly EventAttendanceSnapshot[];
  /** One chain of repeats, or null for every gathering at once. */
  gatheringKey?: string | null;
  /** Named in the description, so the card says which nights it is drawing. */
  gatheringTitle?: string | null;
  limit?: number;
  /**
   * True while the registers are still streaming in — `snapshots` is not yet
   * an answer. The card keeps its header over a chart-sized pulse block, in
   * place, so the history landing paints bars rather than moving the column.
   */
  loading?: boolean;
  /** Lets the dashboard order this card differently on a phone. */
  className?: string;
}

export function AttendanceTrend({
  snapshots,
  gatheringKey = null,
  gatheringTitle = null,
  limit = 8,
  loading = false,
  className,
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
    <Card className={className}>
      <CardHeader
        title="Attendance trend"
        description={
          gatheringTitle
            ? `${gatheringTitle} — head count per gathering, oldest to newest.`
            : 'Head count per day, oldest to newest. Every gathering that met, added up.'
        }
      />

      {loading ? (
        /*
         * The chart's own markup with the ink taken out of it.
         *
         * Same wrappers, same type, same paddings — and a bar at the full
         * `MAX_BAR_PX`, which is what the tallest real bar is by construction —
         * so the placeholder is exactly as tall as the chart that replaces it
         * rather than as tall as somebody guessed. A block of a hand-measured
         * height was ten pixels short, which is ten pixels of everything below
         * this card moving the moment the registers answered.
         *
         * `text-transparent` over real characters rather than empty spans: an
         * empty span has no line box, and the two lines of small type around
         * the bars are a fifth of this card's height.
         */
        <div aria-hidden="true" className="px-3 pb-3 pt-3">
          <div className="flex items-end gap-1.5">
            {Array.from({ length: limit }, (_, index) => (
              <div
                key={index}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[10px] font-semibold tabular-nums text-transparent">0</span>
                <div
                  style={{ height: `${PLACEHOLDER_BARS[index % PLACEHOLDER_BARS.length]}px` }}
                  className="w-full animate-pulse rounded-t-md bg-ink-800/60"
                />
                <span className="w-full truncate text-center text-[10px] text-transparent">—</span>
              </div>
            ))}
          </div>

          <p className="mt-3 border-t border-ink-800 pt-2 text-xs text-transparent">
            counting the recent gatherings
          </p>
        </div>
      ) : points.length === 0 ? (
        <EmptyState
          title="No gatherings to chart yet."
          description="Once a couple of gatherings have been checked in, the trend fills in here."
        />
      ) : (
        <div className="px-3 pb-3 pt-3">
          <div className="flex items-end gap-1.5" aria-hidden="true">
            {points.map((point, index) => (
              <div
                key={point.id}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${point.title} · ${formatShortDate(point.date)}: ${point.count}${
                  point.eventIds.length > 1 ? ` across ${point.eventIds.length} gatherings` : ''
                }`}
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
            {points.length} {points.length === 1 ? 'day' : 'days'} · peak {peak} · average {average}
          </p>

          <table className="sr-only">
            <caption>Head count per day, oldest first.</caption>
            <thead>
              <tr>
                <th scope="col">Gathering</th>
                <th scope="col">Date</th>
                <th scope="col">Present</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.id}>
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
