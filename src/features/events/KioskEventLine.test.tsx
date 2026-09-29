/**
 * The event page's one line about the lobby kiosk: quiet on this gathering's
 * day, late afterwards, and what it parked.
 */
import { render, screen } from '@/test/rtl';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { KioskParkedRecord } from '@/services/kioskParkedRecords';
import type { AttendanceRecord, KioskDevice } from '@/types';
import { makeAttendance, makeEvent } from '../../../tests/factories';

let devices: KioskDevice[] = [];
let parked: KioskParkedRecord[] = [];

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/kioskDevices', async () => {
  const real = (await vi.importActual('@/services/kioskDevices')) as Record<string, unknown>;
  return {
    ...real,
    subscribeKioskDevices: (onRows: (rows: KioskDevice[]) => void) => {
      onRows(devices);
      return () => {};
    },
  };
});
vi.mock('@/services/kioskParkedRecords', async () => {
  const real = (await vi.importActual('@/services/kioskParkedRecords')) as Record<string, unknown>;
  return {
    ...real,
    subscribeUnsettledParkedRecords: (onRows: (rows: KioskParkedRecord[]) => void) => {
      onRows(parked);
      return () => {};
    },
  };
});

const { KioskEventLine } = await import('@/features/events/KioskEventLine');

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
const LOBBY_UID = 'kiosk_kiosk-lobby-00000001';

function kiosk(overrides: Partial<KioskDevice> = {}): KioskDevice {
  return {
    id: 'kiosk-lobby-00000001',
    name: 'Lobby',
    approvedBy: 'uid-sam',
    approvedByName: 'Sam Whitfield',
    pairedAt: new Date(2026, 8, 1),
    lastSeenAt: NINE_FORTY_ONE,
    boundTo: 'Sunday Kids',
    boundChain: 'sunday-kids',
    retiredAt: null,
    retiredBy: null,
    ...overrides,
  };
}

function draw(opts: { kiosks?: KioskDevice[]; cards?: KioskParkedRecord[]; attendance?: AttendanceRecord[]; now?: Date }) {
  devices = opts.kiosks ?? [];
  parked = opts.cards ?? [];
  return render(
    <MemoryRouter>
      <KioskEventLine event={SUNDAY} attendance={opts.attendance ?? []} now={opts.now ?? TEN_FIFTEEN} />
    </MemoryRouter>,
  );
}

describe('KioskEventLine', () => {
  it('says a kiosk set to this gathering went quiet, and that its check-ins are still on the tablet', () => {
    draw({ kiosks: [kiosk()] });
    expect(
      screen.getByText(
        'Lobby was last heard from at 9:41 AM while set to this gathering. Check-ins and pickups made there after that are still on the tablet.',
        { normalizer: (text) => text.replace(/\s+/g, ' ') },
      ),
    ).toBeInTheDocument();
  });

  it('calls a kiosk nobody named the lobby kiosk', () => {
    draw({ kiosks: [kiosk({ name: null })] });
    expect(screen.getByText(/^The lobby kiosk was last heard from/)).toBeInTheDocument();
  });

  it('says nothing about a kiosk reporting, set elsewhere, retired, or quiet since another week', () => {
    draw({
      kiosks: [
        kiosk({ id: 'a', lastSeenAt: new Date(TEN_FIFTEEN.getTime() - 60_000) }),
        kiosk({ id: 'b', boundChain: 'wednesday-night' }),
        kiosk({ id: 'c', retiredAt: TEN_FIFTEEN }),
        kiosk({ id: 'd', lastSeenAt: new Date(2026, 8, 20, 9, 41) }),
      ],
    });
    expect(screen.queryByText(/last heard from/)).toBeNull();
  });

  it('says afterwards how many arrived late, and when the last one did', () => {
    draw({
      kiosks: [kiosk({ lastSeenAt: new Date(2026, 8, 28, 9, 2), waitingCount: 0 })],
      attendance: [
        makeAttendance({ studentId: 'a', checkedInBy: LOBBY_UID, checkedInAt: NINE_FORTY_ONE, recordedAt: new Date(2026, 8, 28, 9, 2) }),
        makeAttendance({ studentId: 'b', checkedInBy: LOBBY_UID, checkedInAt: NINE_FORTY_ONE, recordedAt: new Date(2026, 8, 28, 9, 1) }),
      ],
      now: new Date(2026, 8, 28, 10, 0),
    });
    expect(screen.getByText(/^2 check-ins from Lobby arrived late — all in Tally since/)).toBeInTheDocument();
  });

  it('says "so far" while the kiosk is still sending', () => {
    draw({
      kiosks: [kiosk({ lastSeenAt: new Date(2026, 8, 28, 9, 2), waitingCount: 30 })],
      attendance: [
        makeAttendance({ studentId: 'a', checkedInBy: LOBBY_UID, checkedInAt: NINE_FORTY_ONE, recordedAt: new Date(2026, 8, 28, 9, 2) }),
      ],
      now: new Date(2026, 8, 28, 9, 3),
    });
    expect(screen.getByText('1 check-in from Lobby arrived late so far. It’s still sending the rest.')).toBeInTheDocument();
  });

  it('keeps the late line back while a kiosk is still quiet — the quiet line is the truer one', () => {
    draw({
      kiosks: [kiosk()],
      attendance: [
        makeAttendance({ studentId: 'a', checkedInBy: LOBBY_UID, checkedInAt: NINE_FORTY_ONE, recordedAt: TEN_FIFTEEN }),
      ],
    });
    expect(screen.queryByText(/arrived late/)).toBeNull();
  });

  it('names the late records of a kiosk it has no row for as the lobby kiosk', () => {
    draw({
      attendance: [
        makeAttendance({ studentId: 'a', checkedInBy: LOBBY_UID, checkedInAt: NINE_FORTY_ONE, recordedAt: TEN_FIFTEEN }),
      ],
    });
    expect(screen.getByText(/^1 check-in from the lobby kiosk arrived late/)).toBeInTheDocument();
  });

  it('points at Review for what the kiosk parked from this gathering, and not another', () => {
    const record = {
      id: 'check-in:sunday-kids-2026-09-27:noah',
      kind: 'check-in' as const,
      eventId: SUNDAY.id,
      studentId: 'noah',
      reason: 'frozen' as const,
      tappedAt: NINE_FORTY_ONE,
      student: null,
      gathering: 'Sunday Kids',
      deviceId: 'kiosk-lobby-00000001',
      parkedAt: TEN_FIFTEEN,
    };
    draw({ cards: [record, { ...record, id: 'other', eventId: 'friday' }] });
    expect(screen.getByText(/^1 record from the kiosk needs a decision\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Review' })).toHaveAttribute('href', '/review');
  });

  it('draws nothing at all when there is nothing to say', () => {
    const { container } = draw({});
    expect(container).toBeEmptyDOMElement();
  });
});
