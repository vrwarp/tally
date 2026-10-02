/**
 * The attendance trend's words, in a language other than English.
 *
 * The bars are numbers, and the card's title and empty state were translated;
 * the footer under the bars, the hover text on each bar and the headings of
 * the table a screen reader reads instead were English sentences assembled
 * with hand-rolled plurals.
 */
import { render, screen } from '@/test/rtl';
import { describe, expect, it } from 'vitest';
import { AttendanceTrend } from '@/features/dashboard/AttendanceTrend';
import type { EventAttendanceSnapshot } from '@/types';
import { makeEvent } from '../../../tests/factories';

function night(id: string, startAt: Date, present: string[]): EventAttendanceSnapshot {
  return {
    event: makeEvent({
      id,
      title: id.startsWith('sunday') ? 'Sunday School' : 'Friday Fellowship',
      mode: 'recurring',
      seriesId: id.split('-')[0]!,
      startAt,
      endAt: new Date(startAt.getTime() + 2 * 3_600_000),
    }),
    presentStudentIds: new Set(present),
    checkedOutStudentIds: new Set(),
    held: true,
  };
}

/** A Friday on its own, then a Sunday with two gatherings that add up. */
const SNAPSHOTS = [
  night('friday-6', new Date(2026, 1, 6, 19, 0), ['a', 'b']),
  night('sunday-8', new Date(2026, 1, 8, 9, 30), ['c']),
  night('friday-8', new Date(2026, 1, 8, 19, 0), ['a', 'b', 'd']),
];

describe('AttendanceTrend, in another language', () => {
  it('sums the chart up in the reader’s language', () => {
    const { container } = render(<AttendanceTrend snapshots={SNAPSHOTS} />, { locale: 'zh-Hant' });

    expect(container.textContent).not.toMatch(/days? · peak/);
    expect(screen.getByText(/^2 天 · 最高 4 · 平均 3$/)).toBeInTheDocument();
  });

  it('heads the screen-reader table in the reader’s language', () => {
    render(<AttendanceTrend snapshots={SNAPSHOTS} />, { locale: 'zh-Hant' });

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '聚會',
      '日期',
      '出席',
    ]);
  });

  it('describes a bar in the reader’s language, a day of two gatherings included', () => {
    const { container } = render(<AttendanceTrend snapshots={SNAPSHOTS} />, { locale: 'zh-Hant' });

    const titles = [...container.querySelectorAll('[title]')].map((bar) => bar.getAttribute('title'));
    expect(titles.join(' ')).not.toMatch(/across/);
    expect(titles.some((title) => title?.includes('共 2 次聚會'))).toBe(true);
  });
});
