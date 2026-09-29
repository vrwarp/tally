/**
 * The register's line about a lobby kiosk gone quiet on this gathering's day —
 * and its silence everywhere else.
 */
import { render, screen } from '@/test/rtl';
import { describe, expect, it, vi } from 'vitest';
import type { KioskPresence } from '@/services/kioskPresence';
import { makeEvent } from '../../../tests/factories';

let kiosks: KioskPresence[] = [];
const asked: string[] = [];

vi.mock('@/services/kioskPresence', () => ({
  subscribeKioskPresence: (chain: string, onRows: (rows: KioskPresence[]) => void) => {
    asked.push(chain);
    onRows(kiosks);
    return () => {};
  },
}));

const { QuietKiosks } = await import('@/features/checkin/QuietKiosks');

// Sunday Kids, Sept 27: check-in 9:00–10:30.
const SUNDAY = makeEvent({
  id: 'sunday-kids-2026-09-27',
  seriesId: 'sunday-kids',
  startAt: new Date(2026, 8, 27, 9, 30),
  endAt: new Date(2026, 8, 27, 11, 0),
  checkInOpensAt: new Date(2026, 8, 27, 9, 0),
  checkInClosesAt: new Date(2026, 8, 27, 10, 30),
});
const NINE_FORTY_ONE = new Date(2026, 8, 27, 9, 41);
const TEN_FIFTEEN = new Date(2026, 8, 27, 10, 15);

function draw(rows: KioskPresence[], now = TEN_FIFTEEN) {
  kiosks = rows;
  render(<QuietKiosks event={SUNDAY} now={now} />);
}

describe('QuietKiosks', () => {
  it('reads the kiosks set to this gathering’s chain', () => {
    draw([]);
    expect(asked.at(-1)).toBe('sunday-kids');
  });

  it('names a kiosk gone quiet on the day, and says where its check-ins are', () => {
    draw([{ deviceId: 'kiosk-lobby-00000001', name: 'Lobby', lastSeenAt: NINE_FORTY_ONE }]);
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent(/^Lobby hasn’t been heard from since 9:41/);
    expect(line).toHaveTextContent(/aren’t on this list yet — a child wearing today’s name tag was checked in\.$/);
  });

  it('calls a kiosk nobody named the lobby kiosk', () => {
    draw([{ deviceId: 'kiosk-lobby-00000001', name: null, lastSeenAt: NINE_FORTY_ONE }]);
    expect(screen.getByRole('status')).toHaveTextContent(/^The lobby kiosk hasn’t been heard from since 9:41/);
  });

  it('says the day, not just the time, when read on another day', () => {
    draw([{ deviceId: 'kiosk-lobby-00000001', name: 'Lobby', lastSeenAt: NINE_FORTY_ONE }], new Date(2026, 8, 28, 9, 0));
    expect(screen.getByRole('status')).not.toHaveTextContent(/9:41/);
  });

  it('draws nothing while every kiosk is reporting, or for one quiet since another week', () => {
    draw([
      { deviceId: 'kiosk-lobby-00000001', name: 'Lobby', lastSeenAt: new Date(TEN_FIFTEEN.getTime() - 60_000) },
      { deviceId: 'kiosk-nursery-000002', name: 'Nursery', lastSeenAt: new Date(2026, 8, 20, 9, 41) },
      { deviceId: 'kiosk-never-00000004', name: null, lastSeenAt: null },
    ]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says each kiosk that has gone quiet', () => {
    draw([
      { deviceId: 'kiosk-lobby-00000001', name: 'Lobby', lastSeenAt: NINE_FORTY_ONE },
      { deviceId: 'kiosk-nursery-000002', name: 'Nursery door', lastSeenAt: NINE_FORTY_ONE },
    ]);
    expect(screen.getByText(/^Lobby hasn’t/)).toBeInTheDocument();
    expect(screen.getByText(/^Nursery door hasn’t/)).toBeInTheDocument();
  });
});
