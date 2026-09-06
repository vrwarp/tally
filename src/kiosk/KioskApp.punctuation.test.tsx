/**
 * A mark on a digit buffer is a miss, not a query.
 *
 * The keyboard's ’ and - sit in the bottom-right corner, directly under ⌫, and
 * a correction that lands 8px low used to append a hyphen to the four digits a
 * parent had just typed. "7788-" is not a phone query: it fell through to the
 * name matcher, which matches nobody, so the family's own rows vanished and
 * the register door — the one that makes a duplicate — filled the screen. The
 * kiosk refuses the mark the way it refuses a fifth digit.
 *
 * The apostrophe's own bug is pinned beside it: the key showed a typographer's
 * ’ and typed it, and the wizard's name filter accepts only the straight mark,
 * so O'Brien registered as Obrien. The key types the straight mark now, on
 * every screen.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { KIOSK_KEYS } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

function student(id: string, firstName: string, lastName: string): KioskStudent {
  return {
    id,
    firstName,
    lastName,
    grade: 6,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
    hasAllergies: false,
  };
}

const NOAH = student('s-noah', 'Noah', 'Adeyemi');
const ROSTER = [NOAH];
const LAST4: Record<string, string[]> = { '7788': ['s-noah'] };

function binding(): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'friday-today',
    seriesId: null,
    predictsFrom: 'friday-fellowship',
    title: 'Friday Fellowship',
    startAtMs: now - 60_000,
    endAtMs: now + 3_600_000,
    checkInClosesAtMs: now + 3_600_000,
    requiresCheckOut: false,
    labelTemplate: null,
    boundAtMs: now,
  };
}

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => ROSTER),
  loadPhoneIndex: vi.fn(async () => LAST4),
  loadParticipation: vi.fn(async () => ({
    participated: new Set(['s-noah']),
    recent: new Set(['s-noah']),
  })),
  fetchPulse: vi.fn(async () => null),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async () => {}),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
  fetchAttendance: vi.fn(async () => ({
    present: new Set<string>(),
    checkedOut: new Set<string>(),
    arrivals: new Map<string, string>(),
  })),
  replayQueue: vi.fn(async () => 0),
  refreshDirectory: vi.fn(async () => {}),
  performCheckIn: vi.fn(async () => {}),
  performCheckOut: vi.fn(async () => {}),
  warmStudentDates: vi.fn(),
  forgetStudentDates: vi.fn(),
  enqueueCheckIn: vi.fn(),
  enqueueCheckOut: vi.fn(),
} as unknown as KioskServices;

vi.mock('@/kiosk/services', () => services);

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(binding()));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ fetchedAtMs: Date.now(), students: ROSTER }),
  );
  localStorage.setItem(
    KIOSK_KEYS.phoneIndex,
    JSON.stringify({ fetchedAtMs: Date.now(), builtAtMs: Date.now(), last4: LAST4 }),
  );
  render(<KioskApp />);
  await settle();
}

/** A press on a key, addressed by its `data-key` — the marks have no direct text. */
async function press(name: string): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(document.querySelector(`[data-key="${name}"]`)!);
  });
  await settle();
}

async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) await press(key);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('a mark on a digit buffer', () => {
  it('is refused, so a low miss off ⌫ does not empty the family’s screen', async () => {
    await mount();
    await type('7788');
    expect(screen.getByText('Noah Adeyemi')).toBeTruthy();

    await press('-');
    await press("'");

    // The readout still says 7788, and the phone query still stands.
    expect(screen.getByText('7788')).toBeTruthy();
    expect(screen.queryByText('7788-')).toBeNull();
    expect(screen.getByText('Noah Adeyemi')).toBeTruthy();
  });

  it('is still typed into a name, where it belongs', async () => {
    await mount();
    await type('O');
    await press("'");
    await type('B');

    // The straight mark — the one every buffer accepts — not the curly one the
    // key wears.
    expect(screen.getByText("O'B")).toBeTruthy();
  });
});
