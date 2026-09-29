/**
 * One kiosk's row, shared by the Kiosk page and the Team page: what it says,
 * and the two things the core team may do about it — rename and retire.
 */
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskDevice } from '@/types';

const show = vi.fn();
const renameKioskDevice = vi.fn(async () => {});
const retireKioskDevice = vi.fn(async () => {});

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show }) }));
vi.mock('@/context/authContext', () => ({
  useAuth: () => ({ profile: { id: 'uid-dana' }, can: () => true }),
}));
vi.mock('@/services/kioskDevices', async () => {
  const real = (await vi.importActual('@/services/kioskDevices')) as Record<string, unknown>;
  return {
    ...real,
    renameKioskDevice: (...args: unknown[]) => renameKioskDevice(...(args as [])),
    retireKioskDevice: (...args: unknown[]) => retireKioskDevice(...(args as [])),
  };
});

const { KioskDeviceRow } = await import('@/features/kiosk/KioskDeviceRow');

const NOW = new Date('2026-09-27T17:30:00Z');

function device(overrides: Partial<KioskDevice> = {}): KioskDevice {
  return {
    id: 'kiosk-3f9a1c2e7b4d',
    name: 'Lobby',
    approvedBy: 'uid-sam',
    approvedByName: 'Sam Whitfield',
    pairedAt: new Date('2026-09-01T16:00:00Z'),
    lastSeenAt: new Date(NOW.getTime() - 60_000),
    boundTo: 'Sunday Kids',
    boundChain: 'sunday-kids',
    retiredAt: null,
    retiredBy: null,
    ...overrides,
  };
}

function draw(overrides: Partial<KioskDevice> = {}, showPairedBy = false) {
  render(
    <ul>
      <KioskDeviceRow device={device(overrides)} now={NOW} showPairedBy={showPairedBy} />
    </ul>,
  );
}

afterEach(() => {
  show.mockReset();
  renameKioskDevice.mockReset();
  retireKioskDevice.mockReset();
});

describe('what a row says', () => {
  it('says who paired it only where the list is everybody’s', () => {
    draw({}, true);
    expect(screen.getByText('Paired by Sam Whitfield')).toBeInTheDocument();
  });

  it('keeps who paired it off a person’s own panel', () => {
    draw();
    expect(screen.queryByText(/Paired by/)).toBeNull();
  });

  it('says nothing a retired tablet told Tally, and offers nothing to do', () => {
    draw({ retiredAt: new Date('2026-08-01T12:00:00Z'), waitingCount: 4, charging: false, batteryLevel: 0.3 });
    expect(screen.queryByText(/waiting since/)).toBeNull();
    expect(screen.queryByText(/On battery/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('renaming', () => {
  it('toasts the new name', async () => {
    draw();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('Name');
    await userEvent.clear(field);
    await userEvent.type(field, ' Front   door ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(show).toHaveBeenCalledWith('Renamed to Front door.', { tone: 'success' }));
    expect(renameKioskDevice).toHaveBeenCalledWith('kiosk-3f9a1c2e7b4d', ' Front   door ');
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('takes the name off, and says what the kiosk is called again', async () => {
    draw();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(show).toHaveBeenCalledWith('Name removed.', {
        tone: 'success',
      }),
    );
  });

  it('says so when the rename did not take, and keeps the field open', async () => {
    renameKioskDevice.mockRejectedValueOnce(new Error('permission-denied'));
    draw();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(show).toHaveBeenCalledWith('Couldn’t rename. Try again.', {
        tone: 'error',
      }),
    );
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});

describe('retiring', () => {
  it('asks first for a kiosk recording now, and names it in the toast', async () => {
    draw();
    await userEvent.click(screen.getByRole('button', { name: 'Retire' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/^It’s recording Sunday Kids\./);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, retire' }));

    await waitFor(() => expect(retireKioskDevice).toHaveBeenCalledWith('kiosk-3f9a1c2e7b4d', 'uid-dana'));
    expect(show.mock.calls[0]![0]).toMatch(/^Lobby retired\./);
  });

  it('retires at once a kiosk that can be holding nothing', async () => {
    draw({ boundTo: null, boundChain: null });
    await userEvent.click(screen.getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(retireKioskDevice).toHaveBeenCalled());
  });

  it('says so when the retirement did not take', async () => {
    retireKioskDevice.mockRejectedValueOnce(new Error('offline'));
    draw({ boundTo: null, boundChain: null });
    await userEvent.click(screen.getByRole('button', { name: 'Retire' }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith('Could not retire that kiosk. Try again in a moment.', {
        tone: 'error',
      }),
    );
  });
});
