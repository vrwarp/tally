/**
 * What the lobby kiosk left for Review: one card per child and gathering, a
 * sentence saying why, and only the answers the server would take.
 */
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskParkedRecord } from '@/services/kioskParkedRecords';
import type { Student, TallyEvent } from '@/types';
import { makeEvent, makeStudent } from '../../../tests/factories';

const show = vi.fn();
const settleParkedKioskRecord = vi.fn();
const recreatePlanningCenterPerson = vi.fn();
const refreshRoster = vi.fn(() => Promise.resolve());
let parked: KioskParkedRecord[] = [];
let refuse = false;
let students: Student[] = [];
let documents: Student[] | 'refused' = [];
let events: TallyEvent[] = [];

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show }) }));
vi.mock('@/context/dataContext', () => ({
  useData: () => ({ students, events, refreshRoster }),
}));
vi.mock('@/services/students', () => ({
  subscribeStudents: (onRows: (rows: Student[]) => void, onError: (error: Error) => void) => {
    if (documents === 'refused') onError(new Error('permission-denied'));
    else onRows(documents);
    return () => {};
  },
}));
vi.mock('@/services/functions', () => ({
  settleParkedKioskRecord: (...args: unknown[]) => settleParkedKioskRecord(...args),
  recreatePlanningCenterPerson: (...args: unknown[]) => recreatePlanningCenterPerson(...args),
}));
vi.mock('@/services/kioskParkedRecords', async () => {
  const real = (await vi.importActual('@/services/kioskParkedRecords')) as Record<string, unknown>;
  return {
    ...real,
    subscribeUnsettledParkedRecords: (
      onRows: (rows: KioskParkedRecord[]) => void,
      onError: (error: Error) => void,
    ) => {
      if (refuse) onError(new Error('permission-denied'));
      else onRows(parked);
      return () => {};
    },
  };
});

const { KioskParkedSection } = await import('@/features/review/KioskParkedSection');

const EVENT = 'sunday-kids-2026-09-27';
const NINE_FORTY_THREE = new Date(2026, 8, 27, 9, 43);
const TEN_FIFTY_TWO = new Date(2026, 8, 27, 10, 52);

function record(overrides: Partial<KioskParkedRecord> = {}): KioskParkedRecord {
  return {
    id: `check-in:${EVENT}:student-noah`,
    kind: 'check-in',
    eventId: EVENT,
    studentId: 'student-noah',
    reason: 'frozen',
    tappedAt: NINE_FORTY_THREE,
    student: { firstName: 'Noah', lastName: 'Parke', grade: 3 },
    gathering: 'Sunday Kids',
    deviceId: 'kiosk-lobby-00000001',
    parkedAt: TEN_FIFTY_TWO,
    ...overrides,
  };
}

const PICKUP = record({
  id: `check-out:${EVENT}:student-noah`,
  kind: 'check-out',
  reason: 'arrival-parked',
  tappedAt: TEN_FIFTY_TWO,
});

/**
 * `kids` is the roster; `docs` is Tally's own documents, which default to the
 * roster's — true of a child whose document holds their name.
 */
function draw(opts: { cards?: KioskParkedRecord[]; kids?: Student[]; docs?: Student[] | 'refused' } = {}) {
  parked = opts.cards ?? [];
  students = opts.kids ?? [];
  documents = opts.docs ?? students;
  events = [makeEvent({ id: EVENT, title: 'Sunday Kids' })];
  return render(
    <MemoryRouter>
      <KioskParkedSection />
    </MemoryRouter>,
  );
}

afterEach(() => {
  show.mockReset();
  settleParkedKioskRecord.mockReset();
  recreatePlanningCenterPerson.mockReset();
  refreshRoster.mockClear();
  refuse = false;
});

const FROZEN_NOAH = makeStudent({ id: 'student-noah', firstName: 'Noah', lastName: 'Park', upstreamRecordMissing: true });
const NOAH_BACK = makeStudent({ id: 'student-noah', firstName: 'Noah', lastName: 'Park' });

describe('KioskParkedSection', () => {
  it('draws nothing while nothing waits', () => {
    const { container } = draw();
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when the list could not be read', () => {
    refuse = true;
    draw();
    expect(screen.getByText('Couldn’t load kiosk records.')).toBeInTheDocument();
  });

  it('says why a frozen child’s arrival waits, where to put it right, and offers only Let it go', () => {
    draw({ cards: [record()], kids: [FROZEN_NOAH] });
    expect(screen.getByText('From the lobby kiosk')).toBeInTheDocument();
    expect(
      screen.getByText('Missing from the church’s database, so this can’t be recorded yet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix on their page' })).toHaveAttribute(
      'href',
      '/students/student-noah',
    );
    expect(screen.queryByRole('button', { name: /^Record/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Let it go' })).toBeInTheDocument();
  });

  it('records a frozen child’s arrival once their record is back', async () => {
    settleParkedKioskRecord.mockResolvedValue({ data: { status: 'settled' } });
    draw({ cards: [record()], kids: [NOAH_BACK] });

    expect(screen.getByText('Back in the church’s database. Ready to record.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Record the 9:43 .* arrival$/ }));
    await waitFor(() =>
      expect(settleParkedKioskRecord).toHaveBeenCalledWith({ id: `check-in:${EVENT}:student-noah`, decision: 'record' }),
    );
    expect(show).toHaveBeenCalledWith('Recorded.', { tone: 'success' });
  });

  it('makes one card of an arrival and the pickup parked with it', async () => {
    settleParkedKioskRecord.mockResolvedValue({ data: { status: 'settled' } });
    draw({ cards: [PICKUP, record()], kids: [NOAH_BACK] });

    expect(screen.getAllByRole('button', { name: 'Let it go' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /^Record the 9:43 .* arrival and pickup$/ }));
    // Asked of the arrival: the server settles the pickup with it.
    await waitFor(() =>
      expect(settleParkedKioskRecord).toHaveBeenCalledWith({ id: `check-in:${EVENT}:student-noah`, decision: 'record' }),
    );
  });

  it('lets go of a record whose gathering was deleted, and says so with a name on it', async () => {
    settleParkedKioskRecord.mockResolvedValue({ data: { status: 'settled' } });
    draw({ cards: [record({ reason: 'gathering-deleted' })], kids: [NOAH_BACK] });

    expect(screen.getByText(/^Its gathering was deleted\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Record/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Let it go' }));
    await waitFor(() =>
      expect(settleParkedKioskRecord).toHaveBeenCalledWith({ id: `check-in:${EVENT}:student-noah`, decision: 'let-go' }),
    );
    expect(show).toHaveBeenCalledWith('Let go.', { tone: 'success' });
  });

  it('says a pickup with no arrival has nothing to close', () => {
    draw({ cards: [record({ id: 'out', kind: 'check-out', reason: 'no-arrival', tappedAt: TEN_FIFTY_TWO })], kids: [NOAH_BACK] });
    expect(screen.getByText('No arrival on the register for this pickup to close. It may have been removed.')).toBeInTheDocument();
  });

  it('says a pickup waited for an arrival that was let go', () => {
    draw({ cards: [PICKUP], kids: [NOAH_BACK] });
    expect(screen.getByText('Its arrival was let go, so this pickup has nothing to close.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Record/ })).toBeNull();
  });

  it('says a record could not be read', () => {
    draw({ cards: [record({ id: 'unreadable:x', reason: 'unreadable', eventId: '', studentId: '', student: null, tappedAt: null })] });
    expect(screen.getByText('Tally couldn’t read this record.')).toBeInTheDocument();
    expect(screen.getByText('A child')).toBeInTheDocument();
  });

  it('calls a child the roster does not have by the names the kiosk knew', () => {
    draw({ cards: [record({ reason: 'gathering-deleted' })] });
    expect(screen.getByText('Noah Parke')).toBeInTheDocument();
  });

  it('says what the server answered when it would not settle', async () => {
    const answers = [
      ['still-frozen', 'Still missing from the church’s database.'],
      ['cannot-record', 'Nothing left to record it onto. You can let it go.'],
      ['already-settled', 'Already decided.'],
      ['not-found', 'That record is gone.'],
    ] as const;
    for (const [status, said] of answers) {
      settleParkedKioskRecord.mockResolvedValueOnce({ data: { status } });
      const { unmount } = draw({ cards: [record()], kids: [NOAH_BACK] });
      await userEvent.click(screen.getByRole('button', { name: /^Record/ }));
      await waitFor(() => expect(show).toHaveBeenLastCalledWith(said, { tone: 'error' }));
      unmount();
    }
  });

  /*
   * A Planning Center child deleted upstream: the roster has no row for them
   * (Tally never stored the name), so there is no page to link — the card
   * puts them back itself, under the name the kiosk kept.
   */
  const GONE = makeStudent({ id: 'pco_4100022', firstName: '', lastName: '', upstreamRecordMissing: true });
  const GONE_CARD = record({ id: `check-in:${EVENT}:pco_4100022`, studentId: 'pco_4100022' });

  it('puts back a child the roster no longer shows, under the name the kiosk kept', async () => {
    recreatePlanningCenterPerson.mockResolvedValue({
      data: { status: 'recreated', message: 'Planning Center has a record for them again. Check-ins are unfrozen.' },
    });
    draw({ cards: [GONE_CARD], docs: [GONE] });

    expect(screen.getByText('Missing from the church’s database, so this can’t be recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Record/ })).toBeNull();
    expect(
      screen.getByText('Uses the name the kiosk kept, or links a match already there.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Re-create in Planning Center' }));
    await waitFor(() =>
      expect(recreatePlanningCenterPerson).toHaveBeenCalledWith({
        studentId: 'pco_4100022',
        firstName: 'Noah',
        lastName: 'Parke',
        grade: 3,
      }),
    );
    expect(show).toHaveBeenCalledWith('Planning Center has a record for them again. Check-ins are unfrozen.', {
      tone: 'success',
    });
    expect(refreshRoster).toHaveBeenCalledWith(true);
  });

  it('sends no grade the kiosk did not know', async () => {
    recreatePlanningCenterPerson.mockResolvedValue({ data: { status: 'relinked', message: 'Linked.' } });
    draw({
      cards: [record({ ...GONE_CARD, student: { firstName: 'Noah', lastName: 'Parke', grade: null } })],
      docs: [GONE],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Re-create in Planning Center' }));
    await waitFor(() =>
      expect(recreatePlanningCenterPerson).toHaveBeenCalledWith({
        studentId: 'pco_4100022',
        firstName: 'Noah',
        lastName: 'Parke',
      }),
    );
    expect(show).toHaveBeenCalledWith('Linked.', { tone: 'success' });
  });

  it('says what the server said when it would not put them back, and asks the roster nothing', async () => {
    const off = 'Creating people in Planning Center from Tally is switched off.';
    recreatePlanningCenterPerson.mockResolvedValue({ data: { status: 'disabled', message: off } });
    draw({ cards: [GONE_CARD], docs: [GONE] });
    await userEvent.click(screen.getByRole('button', { name: 'Re-create in Planning Center' }));
    await waitFor(() => expect(show).toHaveBeenCalledWith(off, { tone: 'info' }));
    expect(refreshRoster).not.toHaveBeenCalled();
  });

  it('says so when putting them back fails', async () => {
    recreatePlanningCenterPerson.mockRejectedValue(new Error(''));
    draw({ cards: [GONE_CARD], docs: [GONE] });
    await userEvent.click(screen.getByRole('button', { name: 'Re-create in Planning Center' }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith('Couldn’t re-create Noah Parke.', { tone: 'error' }),
    );
  });

  it('offers Record once the re-creation leads to a child whose record is back', () => {
    const moved = makeStudent({
      id: 'pco_4100022',
      firstName: '',
      lastName: '',
      status: 'inactive',
      upstreamRecordMissing: true,
      recreatedAsStudentId: 'pco_4100099',
    });
    const back = makeStudent({ id: 'pco_4100099', firstName: 'Noah', lastName: 'Park' });
    draw({ cards: [GONE_CARD], kids: [back], docs: [moved, back] });

    expect(screen.getByText('Back in the church’s database. Ready to record.')).toBeInTheDocument();
    expect(screen.getByText('Noah Park')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Record the 9:43 .* arrival$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Re-create/ })).toBeNull();
  });

  it('walks the roster while its own read of the documents is refused', () => {
    draw({ cards: [record()], kids: [NOAH_BACK], docs: 'refused' });
    expect(screen.getByRole('button', { name: /^Record the 9:43 .* arrival$/ })).toBeInTheDocument();
  });

  it('offers no way back without a name to put back under', () => {
    draw({
      cards: [record({ ...GONE_CARD, id: `check-out:${EVENT}:pco_4100022`, kind: 'check-out', student: null })],
      docs: [GONE],
    });
    expect(screen.getByText('A child')).toBeInTheDocument();
    expect(screen.getByText('Missing from the church’s database, so this can’t be recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Re-create/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Let it go' })).toBeInTheDocument();
  });

  it('says so when the call fails', async () => {
    settleParkedKioskRecord.mockRejectedValue(new Error('offline'));
    draw({ cards: [record()], kids: [NOAH_BACK] });
    await userEvent.click(screen.getByRole('button', { name: 'Let it go' }));
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.any(String), { tone: 'error' }));
  });
});
