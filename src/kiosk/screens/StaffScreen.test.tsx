/**
 * The staff menu's one slot about the tablet's records: a statement while
 * everything is in Tally, a door with a reason on it while anything waits.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { describe, expect, it, vi } from 'vitest';
import type { CheckInsSummary } from '@/kiosk/checkInsLine';
import { StaffScreen } from '@/kiosk/screens/StaffScreen';

const NINE_FORTY_ONE = new Date(2026, 8, 27, 9, 41).getTime();

function renderMenu(checkIns: Partial<CheckInsSummary> = {}) {
  const onCheckIns = vi.fn();
  render(
    <StaffScreen
      title="Sunday Kids"
      window="9:00 – 10:30"
      printer="ready"
      backdrop={false}
      onReprint={() => {}}
      onPrinter={() => {}}
      onChangeEvent={() => {}}
      onHideBackdrop={() => {}}
      pins={[]}
      onLanguages={() => {}}
      checkIns={{ count: 0, held: 0, problem: null, oldestAtMs: null, ...checkIns }}
      onCheckIns={onCheckIns}
      onStay={() => {}}
    />,
  );
  return onCheckIns;
}

describe('the check-ins slot on the staff menu', () => {
  it('says everything is in Tally as a statement, not a door', () => {
    renderMenu();
    const line = screen.getByText('All check-ins are in Tally');
    expect(line.closest('button')).toBeNull();
    expect(screen.queryByText('Check-ins')).toBeNull();
  });

  it('becomes a door with the count once something waits, and opens the list', async () => {
    const onCheckIns = renderMenu({ count: 12, oldestAtMs: NINE_FORTY_ONE });
    expect(screen.queryByText('All check-ins are in Tally')).toBeNull();
    expect(screen.getByText('12 waiting')).toBeTruthy();

    const door = screen.getByText('Check-ins').closest('button')!;
    await act(async () => {
      fireEvent.pointerDown(door);
      fireEvent.pointerUp(door);
    });
    expect(onCheckIns).toHaveBeenCalledTimes(1);
  });

  it('says nothing more while the first attempt is still out', () => {
    renderMenu({ count: 1, oldestAtMs: NINE_FORTY_ONE });
    expect(screen.queryByText(/internet|office|reload/i)).toBeNull();
  });

  it('words the reason from what the last attempt hit', () => {
    renderMenu({ count: 12, problem: 'network', oldestAtMs: NINE_FORTY_ONE });
    expect(screen.getByText(/^No internet since 9:41/)).toBeTruthy();
  });

  it('sends a server problem to the office rather than letting it wait politely', () => {
    renderMenu({ count: 3, problem: 'server', oldestAtMs: NINE_FORTY_ONE });
    expect(screen.getByText(/Tally won’t take them — tell the office/)).toBeTruthy();
  });

  it('puts the one urgent instruction first when a record is held only in the page', () => {
    renderMenu({ count: 3, held: 2, problem: 'network', oldestAtMs: NINE_FORTY_ONE });
    expect(
      screen.getByText(/2 aren’t saved yet — don’t reload or restart/),
    ).toBeTruthy();
    expect(screen.queryByText(/No internet/)).toBeNull();
  });
});
