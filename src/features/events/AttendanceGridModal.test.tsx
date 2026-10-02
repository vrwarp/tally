/**
 * The attendance grid's two status lines, in a language other than English.
 *
 * Both were assembled from English fragments with hand-rolled plurals —
 * "Reading 2 gatherings…" and "2 gatherings × 1 student." — beside a title,
 * a description and a download button that were already translated.
 */
import { render, screen } from '@/test/rtl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceGridModal } from '@/features/events/AttendanceGridModal';
import { invalidateSnapshotCache } from '@/hooks/useEventSnapshots';
import { makeEvent, makeStudent } from '../../../tests/factories';

const fetchAttendanceByEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/attendance', () => ({ fetchAttendanceByEvent }));
// The download button toasts; nothing here presses it.
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));

const ada = makeStudent({ id: 'ada', firstName: 'Ada', lastName: 'Byron' });
const nights = [7, 14].map((day) =>
  makeEvent({
    id: `friday-2026-01-${day}`,
    title: 'Friday Fellowship',
    mode: 'recurring',
    seriesId: 'friday',
    materialized: true,
    startAt: new Date(2026, 0, day, 19, 0),
    endAt: new Date(2026, 0, day, 21, 0),
  }),
);

vi.mock('@/context/dataContext', () => ({
  useData: () => ({
    events: nights,
    series: [],
    students: [ada],
    canWork: () => true,
    rosterBackends: [],
  }),
}));

beforeEach(() => {
  invalidateSnapshotCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 0, 20, 12, 0));
});

describe('AttendanceGridModal, in another language', () => {
  it('says what it is reading in the reader’s language', () => {
    fetchAttendanceByEvent.mockReturnValue(new Promise(() => {}));

    render(<AttendanceGridModal open onClose={() => {}} />, { locale: 'zh-Hant' });

    expect(screen.queryByText(/Reading \d+ gatherings/)).not.toBeInTheDocument();
    expect(screen.getByText('正在讀取 2 次聚會…')).toBeInTheDocument();
  });

  it('gives the grid’s size in the reader’s language', async () => {
    fetchAttendanceByEvent.mockResolvedValue({
      byEvent: new Map(
        nights.map((night) => [night.id, { present: new Set(['ada']), checkedOut: new Set() }]),
      ),
      denied: new Set(),
    });

    const { container } = render(<AttendanceGridModal open onClose={() => {}} />, {
      locale: 'zh-Hant',
    });

    await screen.findByText(/名學生/);
    expect(container.textContent).not.toMatch(/gatherings? ×/);
    expect(screen.getByText(/名學生/).closest('p')).toHaveTextContent('2 次聚會 × 1 名學生。');
  });
});
