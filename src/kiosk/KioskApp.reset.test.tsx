/**
 * Where the kiosk lands once a tap is done.
 *
 * Home, with the search cleared — not back on the query the check-in came from.
 * A parent with three children retypes their four digits; the alternative is a
 * screen that keeps a family's name up while the next family walks to it, and a
 * kiosk that sits all morning showing whoever last touched it.
 *
 * Pinned here because it is invisible in the diff that would break it: the
 * success overlay closing is one `setOverlay(null)` away from leaving the buffer
 * behind, and nothing else on screen would look wrong.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { KIOSK_KEYS, KIOSK_ROSTER_VERSION } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

const ADA: KioskStudent = {
  id: 'student-ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  grade: 8,
  searchName: 'ada lovelace',
  hasAllergies: false,
};

/* The empty search readout. Two lines since the prompt became a heading —
   the instruction is what identifies the screen, so match that half. */
const PLACEHOLDER = /^type a name$/i;

function binding(overrides: Partial<KioskBinding> = {}): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'nursery-today',
    seriesId: null,
    title: 'Sunday Nursery',
    startAtMs: now - 60_000,
    endAtMs: now + 3_600_000,
    checkInClosesAtMs: now + 3_600_000,
    requiresCheckOut: true,
    labelTemplate: null,
    boundAtMs: now,
    ...overrides,
  };
}

/** Who the register says is already here. Reassigned per test. */
let present = new Set<string>();
let checkedOut = new Set<string>();

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => [ADA]),
  loadPhoneIndex: vi.fn(async () => ({})),
  loadParticipation: vi.fn(async () => ({
    participated: new Set<string>(),
    recent: new Set<string>(),
  })),
  fetchAttendance: vi.fn(async () => ({ present, checkedOut, arrivals: new Map<string, string>() })),
  fetchPulse: vi.fn(async () => null),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async () => {}),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
  replayQueue: vi.fn(async () => 0),
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

/** Boot the kiosk straight into a bound, ready screen. */
async function mount(bound: KioskBinding = binding()): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: [ADA] }),
  );
  render(<KioskApp />);
  await settle();
}

/**
 * Types on the kiosk's own keyboard.
 *
 * `fireEvent.pointerDown` rather than a click: the keyboard delegates a single
 * listener on its container and listens on glass contact, so the event has to be
 * a real bubbling one on the key itself.
 */
async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

/**
 * Pick Ada out of the results.
 *
 * A row commits on `pointerup`, to tell a tap from the start of a drag down a
 * list that scrolls (see components/tapGuard.ts). So does every button on the
 * kiosk now; the keys are what is left of pressing on contact. Contact alone
 * leaves the kiosk on the search screen.
 */
async function pickAda(): Promise<void> {
  const row = screen.getByText('Ada Lovelace').closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
}

async function tap(text: RegExp | string): Promise<void> {
  // Down *and* up, because every button on the kiosk waits for the lift now —
  // a press alone is a gesture the control has not decided about yet (see
  // components/tapGuard.ts).
  const button = screen.getByText(text).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
  });
  await settle();
}

/** Dismiss the success screen the way a parent does — a tap anywhere on it. */
async function tapSuccess(): Promise<void> {
  const anywhere = screen.getByText(/tap anywhere to carry on/i);
  await act(async () => {
    fireEvent.pointerDown(anywhere);
    fireEvent.pointerUp(anywhere);
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  present = new Set();
  checkedOut = new Set();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('returning home after a tap', () => {
  it('clears the search when a check-in is dismissed', async () => {
    await mount();
    await type('ada');
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();

    await pickAda();
    await tap('Check in');
    await tapSuccess();

    // The search screen, with nothing typed into it.
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('clears the search when the success screen times out on its own', async () => {
    await mount();
    await type('ada');
    await pickAda();
    await tap('Check in');

    // Nobody taps; the kiosk returns itself, and has to return home too — this
    // is the common case in a lobby, not the tap.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
  });

  it('clears the search after a check-out too', async () => {
    present = new Set([ADA.id]);
    await mount();
    await type('ada');
    await pickAda();

    await tap(/check out/i);
    await tapSuccess();

    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
  });

  it('keeps the search when a parent backs out of the confirm screen', async () => {
    // The other half of the rule, and the reason this is not "clear the buffer
    // whenever the overlay closes": backing out is a parent who picked the
    // wrong Noah, and retyping at them would be the opposite of helpful.
    await mount();
    await type('ada');
    await pickAda();

    await tap(/Back/);

    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });
});
