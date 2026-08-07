/**
 * The kiosk noticing changes by itself.
 *
 * These are the claims that retired the refresh rituals: a revision moving on
 * the pulse refetches exactly one cache and no other, and every failure
 * leaves the kiosk exactly where it was. The pulse itself is a mocked
 * services call — what is under test is the routing in KioskApp.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, PULSE_POLL_MS, type KioskServices } from '@/kiosk/KioskApp';
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

/** Registered at the welcome desk moments ago — the pulse's whole point. */
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


function revs(overrides: Partial<MockPulse> = {}): MockPulse {
  return {
    roster: 1,
    phones: 1,
    participation: 1,
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
    // The stored copy carries a stray `registration` number — a bundle from
    // before the QR flow was retired wrote it — and it is simply ignored.
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

