/**
 * The record under the analysis: every gathering a student came to, however long ago.
 *
 * What matters here is the contract with the person reading it — that it costs
 * nothing until asked for, that pressing again reaches further back, and that
 * it never implies an absence it has not established.
 */
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EarlierAttendance } from '@/features/students/EarlierAttendance';
import { makeEvent } from '../../../tests/factories';
import type { AttendanceRecord } from '@/types';

const fetchStudentHistory = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({
  USE_EMULATORS: false,
  firebaseApp: {},
  db: {},
  auth: {},
  popupRedirectResolver: vi.fn(),
}));
vi.mock('@/services/attendance', () => ({ fetchStudentHistory }));

function entry(id: string, title: string, startAt: string) {
  return {
    record: {
      id: 'pco_140203716',
      studentId: 'pco_140203716',
      eventId: id,
      seriesId: null,
      checkedInAt: new Date(startAt),
      checkedInBy: 'planning-center',
      method: 'import',
      isFirstEver: false,
    } as AttendanceRecord,
    event: makeEvent({ id, title, startAt: new Date(startAt) }),
  };
}

describe('EarlierAttendance', () => {
  it('reads nothing until somebody asks', () => {
    render(<EarlierAttendance studentId="pco_140203716" />);

    // A page of reads on every profile open, for a question most opens do not
    // ask, is the trade this laziness exists to refuse.
    expect(fetchStudentHistory).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /show every gathering/i })).toBeInTheDocument();
  });

  it('lists the gatherings they came to, oldest history and all', async () => {
    fetchStudentHistory.mockResolvedValue({
      entries: [
        entry('pco-checkins-698430-2026-03-20', 'Footprints', '2026-03-21T02:30:00Z'),
        entry('pco-checkins-698430-2024-02-02', 'Footprints', '2024-02-03T03:30:00Z'),
      ],
      cursor: null,
      hasMore: false,
    });

    render(<EarlierAttendance studentId="pco_140203716" />);
    await userEvent.click(screen.getByRole('button', { name: /show every gathering/i }));

    await waitFor(() => expect(screen.getAllByText('Footprints')).toHaveLength(2));
    // Reaching two years back is the entire point — this is history the
    // screens above cannot see, because the loaded calendar stops months ago.
    expect(screen.getByText(/Feb 2024|2\/3\/2024|Feb 3/)).toBeInTheDocument();
    expect(screen.getByText(/that is everything on record/i)).toBeInTheDocument();
  });

  it('pages further back on request', async () => {
    fetchStudentHistory
      .mockResolvedValueOnce({
        entries: [entry('e1', 'Footprints', '2026-03-21T02:30:00Z')],
        cursor: { id: 'cursor' },
        hasMore: true,
      })
      .mockResolvedValueOnce({
        entries: [entry('e2', 'Footprints', '2024-02-03T03:30:00Z')],
        cursor: null,
        hasMore: false,
      });

    render(<EarlierAttendance studentId="pco_140203716" />);
    await userEvent.click(screen.getByRole('button', { name: /show every gathering/i }));
    await screen.findByRole('button', { name: /show more/i });
    await userEvent.click(screen.getByRole('button', { name: /show more/i }));

    // Accumulated, not replaced: the list a leader is reading must not lose
    // its top when they ask for more of its bottom.
    await waitFor(() => expect(screen.getAllByText('Footprints')).toHaveLength(2));
    expect(fetchStudentHistory).toHaveBeenLastCalledWith('pco_140203716', { id: 'cursor' });
  });

  it('says it only shows gatherings they were present at', () => {
    render(<EarlierAttendance studentId="pco_140203716" />);

    // A sparse list must not read as a patchy attender. An absence is a fact
    // about the gathering's calendar, and this list has not established one.
    expect(screen.getByText(/nothing is claimed about the ones in between/i)).toBeInTheDocument();
  });

  /*
   * A merged student is one child under two document ids, and merging does not
   * re-key the attendance — that would be a write per gathering against records
   * already reported on. So the read is what puts the two halves back
   * together; without it, merging a family's duplicate makes half a child's
   * history disappear from the only screen that shows all of it.
   */
  it('unions the history of a row merged into this one', async () => {
    fetchStudentHistory.mockImplementation(async (id: string) => ({
      entries:
        id === 'pco_140203716'
          ? [entry('kept', 'Footprints', '2026-03-21T02:30:00Z')]
          : [entry('folded', 'Anchor', '2025-01-08T02:30:00Z')],
      cursor: null,
      hasMore: false,
    }));

    render(<EarlierAttendance studentId="pco_140203716" alsoStudentIds={['tally-dupe']} />);
    await userEvent.click(screen.getByRole('button', { name: /show every gathering/i }));

    expect(await screen.findByText('Footprints')).toBeInTheDocument();
    expect(screen.getByText('Anchor')).toBeInTheDocument();
    expect(fetchStudentHistory).toHaveBeenCalledWith('tally-dupe', null);
    // Newest first across both streams, not one stream after the other.
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Footprints');
  });

  it('keeps a record whose gathering is gone rather than dropping the row', async () => {
    fetchStudentHistory.mockResolvedValue({
      entries: [{ ...entry('deleted', 'Footprints', '2025-05-02T02:30:00Z'), event: null }],
      cursor: null,
      hasMore: false,
    });

    render(<EarlierAttendance studentId="pco_140203716" />);
    await userEvent.click(screen.getByRole('button', { name: /show every gathering/i }));

    expect(await screen.findByText(/no longer on record/i)).toBeInTheDocument();
  });
});
