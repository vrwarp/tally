/**
 * The kiosk noticing changes by itself.
 *
 * These are the claims that retired the "I've registered" ritual: a revision
 * moving on the pulse refetches exactly one cache, a registration for this
 * gathering puts the search screen up while the family is still walking back,
 * and every failure leaves the kiosk exactly where it was. The pulse itself is
 * a mocked services call — what is under test is the routing in KioskApp.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, PULSE_POLL_MS, type KioskServices } from '@/kiosk/KioskApp';
// Warms the dynamic-import graph so the QR screen resolves within a turn.
import '@/kiosk/registration';
import { KIOSK_KEYS } from '@/kiosk/storage';
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

/** Registered while the kiosk was showing its QR — the pulse's whole point. */
const GRACE: KioskStudent = {
  id: 'student-grace',
  firstName: 'Grace',
  lastName: 'Hopper',
  grade: 6,
  searchName: 'grace hopper',
  hasAllergies: false,
};

interface MockPulse {
  roster: number;
  phones: number;
  participation: number;
  registration: { rev: number; eventId: string | null };
}

/** What the sentinel currently says. Reassigned per test. */
let pulse: MockPulse | null = null;
/** What a roster refetch answers with. */
let refetchedRoster: KioskStudent[] = [ADA, GRACE];
/** The gathering's scope. Empty means unscoped, like a chain with no history. */
let participation: { participated: Set<string>; recent: Set<string> } = {
  participated: new Set<string>(),
  recent: new Set<string>(),
};
/** The last-4 map hydrate loads. */
let last4: Record<string, string[]> = {};

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
  loadRoster: vi.fn(async () => [ADA]),
  loadPhoneIndex: vi.fn(async () => last4),
  loadParticipation: vi.fn(async () => participation),
  fetchPulse: vi.fn(async () => pulse),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async (onUpdate: (students: KioskStudent[]) => void) => {
    onUpdate(refetchedRoster);
  }),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
  fetchAttendance: vi.fn(async () => ({
    present: new Set<string>(),
    checkedOut: new Set<string>(),
    arrivals: new Map<string, string>(),
  })),
  replayQueue: vi.fn(async () => 0),
  refreshDirectory: vi.fn(async () => {}),
  mintRegistrationCode: vi.fn(async () => ({ code: 'ABC234', rotateAfterMs: 600_000 })),
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
    JSON.stringify({ fetchedAtMs: Date.now(), students: [ADA] }),
  );
  render(<KioskApp />);
  await settle();
}

async function poll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PULSE_POLL_MS);
  });
  await settle();
}

async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

async function tap(text: RegExp | string): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(screen.getByText(text).closest('button')!);
  });
  await settle();
}

function revs(overrides: Partial<MockPulse> = {}): MockPulse {
  return {
    roster: 1,
    phones: 1,
    participation: 1,
    registration: { rev: 1, eventId: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  pulse = null;
  refetchedRoster = [ADA, GRACE];
  participation = { participated: new Set<string>(), recent: new Set<string>() };
  last4 = {};
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the poll', () => {
  it('seeds on first sight and refetches nothing', async () => {
    pulse = revs();
    await mount();
    await poll();

    // Hydrate just loaded everything; the first sighting only records revs.
    expect(services.refetchRoster).not.toHaveBeenCalled();
    expect(services.refetchPhoneIndex).not.toHaveBeenCalled();
    expect(services.refetchParticipation).not.toHaveBeenCalled();
    expect(services.rememberPulse).toHaveBeenCalled();
  });

  it('refetches the roster when its revision moves, and the child is findable with no button', async () => {
    pulse = revs();
    await mount();
    await poll();

    pulse = revs({ roster: 2 });
    await poll();

    expect(services.refetchRoster).toHaveBeenCalledTimes(1);
    // The refetch delivered Grace; the very next search finds her.
    await type('grace');
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('routes each channel to its own refetch and no other', async () => {
    pulse = revs();
    await mount();
    await poll();

    pulse = revs({ phones: 2 });
    await poll();
    expect(services.refetchPhoneIndex).toHaveBeenCalledTimes(1);
    expect(services.refetchRoster).not.toHaveBeenCalled();

    pulse = revs({ phones: 2, participation: 2 });
    await poll();
    expect(services.refetchParticipation).toHaveBeenCalledTimes(1);
    // The chain handed over is the binding's prediction chain.
    expect(services.refetchParticipation).toHaveBeenCalledWith(
      'friday-fellowship',
      expect.any(Function),
    );
  });

  it('catches up across a reboot from the revs on disk', async () => {
    // The kiosk saw rev 1 before it was powered off; the world moved to 2.
    localStorage.setItem(
      KIOSK_KEYS.pulse,
      JSON.stringify({ roster: 1, phones: 1, participation: 1, registration: 1 }),
    );
    pulse = revs({ roster: 2 });
    await mount();
    // The bound effect polls once immediately — no interval needed.
    await settle();

    expect(services.refetchRoster).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all on a null pulse', async () => {
    pulse = revs();
    await mount();
    await poll();

    pulse = null;
    await poll();
    pulse = revs({ roster: 9 });
    await poll();

    // The null tick neither refetched nor corrupted the seen revs: the change
    // to 9 is still detected afterwards.
    expect(services.refetchRoster).toHaveBeenCalledTimes(1);
  });
});

describe('the QR auto-advance', () => {
  async function openQr(): Promise<void> {
    await tap(/First time here\? Register your child/i);
    await settle();
    expect(await screen.findByText(/I've registered/i)).toBeTruthy();
  }

  it('returns to search with the digits line when a registration for this gathering lands', async () => {
    pulse = revs();
    await mount();
    await poll();
    await openQr();

    pulse = revs({ registration: { rev: 2, eventId: 'friday-today' } });
    await poll();

    // Off the QR screen, onto search, saying what to do next.
    expect(screen.queryByText(/I've registered/i)).toBeNull();
    expect(screen.getByText(/type the last 4 digits/i)).toBeTruthy();
  });

  it('stays put for a registration against some other gathering', async () => {
    pulse = revs();
    await mount();
    await poll();
    await openQr();

    pulse = revs({ registration: { rev: 2, eventId: 'sunday-nursery' } });
    await poll();

    expect(screen.getByText(/I've registered/i)).toBeTruthy();
  });

  it('widens the search for the family it advanced, and narrows after them', async () => {
    /*
     * The regression the e2e caught: a scope is built from attendance, and a
     * child registered half a minute ago has none — so the advance must widen
     * this one search, or "type the last 4 digits" would be a promise the
     * scoped pool immediately breaks.
     */
    participation = { participated: new Set([ADA.id]), recent: new Set<string>() };
    last4 = { '8822': [GRACE.id] };
    pulse = revs();
    await mount();
    await poll();
    await openQr();

    // The real bump moves roster, phones and registration together.
    pulse = revs({ roster: 2, phones: 2, registration: { rev: 2, eventId: 'friday-today' } });
    await poll();

    await type('8822');
    expect(screen.getByText('Grace Hopper')).toBeTruthy();

    // One family's worth of widening: cleared, the next search is scoped
    // again and the same digits stop answering.
    await act(async () => {
      fireEvent.pointerDown(screen.getByText('Clear', { selector: '[data-key]' }));
    });
    await settle();
    await type('8822');
    expect(screen.queryByText('Grace Hopper')).toBeNull();
  });

  it('does not yank the search screen when no QR is showing', async () => {
    pulse = revs();
    await mount();
    await poll();
    await type('ada');

    pulse = revs({ registration: { rev: 2, eventId: 'friday-today' } });
    await poll();

    // The signal is consumed silently; the family mid-search keeps their rows.
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });
});
