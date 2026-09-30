/**
 * The list behind the staff row — what is still on this tablet, in words a
 * volunteer can read down a phone to the office.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { describe, expect, it, vi } from 'vitest';
import type { KioskRecord } from '@/kiosk/journal';
import { CheckInsScreen } from '@/kiosk/screens/CheckInsScreen';

const NINE_FORTY_ONE = new Date(2026, 8, 27, 9, 41).getTime();

function record(overrides: Partial<KioskRecord> = {}): KioskRecord {
  return {
    v: 1,
    id: `record-${Math.random().toString(16).slice(2, 12)}`,
    kind: 'check-in',
    eventId: 'sunday-kids',
    studentId: 'student-ada',
    tappedAtMs: NINE_FORTY_ONE,
    arrivalId: 'arrival-1',
    student: { firstName: 'Ada', lastName: 'Lovelace', grade: 3, searchName: 'ada lovelace' },
    gathering: 'Sunday Kids',
    attempts: 2,
    lastProblem: 'network',
    ...overrides,
  };
}

function renderScreen(props: Partial<Parameters<typeof CheckInsScreen>[0]> = {}) {
  const handlers = { onTryNow: vi.fn(), onDone: vi.fn() };
  render(
    <CheckInsScreen
      records={[]}
      nameOf={() => null}
      isHeld={() => false}
      sending={null}
      line={null}
      returnsTo="staff"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

async function press(text: RegExp): Promise<void> {
  const button = screen.getByText(text).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
  });
}

describe('the Check-ins screen', () => {
  it('says the one sentence that matters before the list: these send themselves', () => {
    renderScreen({ records: [record()] });
    expect(screen.getByText('These send themselves.')).toBeTruthy();
  });

  it('lists each record with its child, gathering, time and what its last attempt ran into', () => {
    renderScreen({
      records: [
        record(),
        record({
          id: 'record-pickup',
          kind: 'check-out',
          studentId: 'student-byron',
          student: undefined,
          arrivalId: undefined,
          tappedAtMs: NINE_FORTY_ONE + 60 * 60_000,
          lastProblem: 'arrival',
        }),
      ],
      nameOf: (id) => (id === 'student-byron' ? 'Byron Park' : null),
    });

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    // The pickup carries no name, so the roster supplies it.
    expect(screen.getByText('Byron Park')).toBeTruthy();
    expect(screen.getAllByText('Sunday Kids')).toHaveLength(2);
    expect(screen.getByText(/Check-in · /)).toBeTruthy();
    expect(screen.getByText(/Check-out · /)).toBeTruthy();
    expect(screen.getByText('No internet')).toBeTruthy();
    expect(screen.getByText('Waiting for their check-in')).toBeTruthy();
  });

  it('says so of a record that exists only in this page, and of one not yet tried', () => {
    const held = record({ id: 'record-held' });
    renderScreen({
      records: [held, record({ id: 'record-new', studentId: 'student-cleo', attempts: 0, lastProblem: undefined })],
      isHeld: (id) => id === held.id,
    });
    expect(screen.getByText('Not saved yet')).toBeTruthy();
    expect(screen.getByText('Not sent yet')).toBeTruthy();
  });

  it('marks a time carried over from the old queue as approximate', () => {
    renderScreen({ records: [record({ approximate: true })] });
    expect(screen.getByText(/Check-in · about /)).toBeTruthy();
  });

  it('names a pickup it cannot find on the roster without inventing anybody', () => {
    renderScreen({
      records: [record({ kind: 'check-out', student: undefined, arrivalId: undefined })],
    });
    expect(screen.getByText('A child')).toBeTruthy();
  });

  it('shows a pass under way, and otherwise what the staff row says', () => {
    renderScreen({
      records: [record()],
      sending: { total: 12, left: 7 },
      line: 'Waiting for the internet since 9:41.',
    });
    expect(screen.getByText('Sending 12 … 7 left')).toBeTruthy();
    expect(screen.queryByText(/Waiting for the internet/)).toBeNull();
  });

  it('tries at once on Try now, and goes back where it came from', async () => {
    const handlers = renderScreen({ records: [record()] });
    await press(/Try now/);
    expect(handlers.onTryNow).toHaveBeenCalledTimes(1);
    await press(/Back/);
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it('says the all-clear, and offers nothing to try, once the list is empty', () => {
    renderScreen({ returnsTo: 'check-in' });
    expect(screen.getByText('All check-ins are in Tally')).toBeTruthy();
    expect(screen.queryByText(/Try now/)).toBeNull();
    expect(screen.getByText(/Done — back to check-in/)).toBeTruthy();
  });
});
