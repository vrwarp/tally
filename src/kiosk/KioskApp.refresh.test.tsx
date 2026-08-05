/**
 * What the kiosk offers a family it cannot find.
 *
 * The roster on the glass is a cache — hours old by design, so that a lobby
 * screen paints before Firebase has parsed — and the commonest reason a name is
 * missing from it is that somebody added the child while the family queued. So
 * an empty result is not the end of the conversation: it offers one forced read
 * of the church, and only then says to see a leader.
 *
 * Pinned here because the whole feature is invisible until it is needed, and
 * every part of it is one line from being useless: an offer that never appears,
 * a sweep that fires on every keystroke that matches nobody, a "still no match"
 * left standing for the next family, or a network failure that reads as an
 * answer.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { KIOSK_KEYS } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

const ADA: KioskStudent = {
  id: 'student-ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  grade: 8,
  searchName: 'ada lovelace',
};

/** Registered at the welcome desk while her family queued — not in the cache. */
const GRACE: KioskStudent = {
  id: 'student-grace',
  firstName: 'Grace',
  lastName: 'Hopper',
  grade: 6,
  searchName: 'grace hopper',
};

const OFFER = /just registered\?/i;

function binding(): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'nursery-today',
    seriesId: null,
    title: 'Sunday Nursery',
    startAtMs: now - 60_000,
    endAtMs: now + 3_600_000,
    checkInClosesAtMs: now + 3_600_000,
    requiresCheckOut: false,
    labelTemplate: null,
    boundAtMs: now,
  };
}

type OnRoster = (students: KioskStudent[]) => void;
type OnPhoneIndex = (last4: Record<string, string[]>) => void;

/** What a forced read answers with. Reassigned per test. */
let refreshDirectory: (onRoster: OnRoster, onPhoneIndex: OnPhoneIndex) => Promise<void>;

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => [ADA]),
  loadPhoneIndex: vi.fn(async () => ({})),
  fetchAttendance: vi.fn(async () => ({ present: new Set<string>(), checkedOut: new Set<string>() })),
  replayQueue: vi.fn(async () => 0),
  refreshDirectory: vi.fn((onRoster: OnRoster, onPhoneIndex: OnPhoneIndex) =>
    refreshDirectory(onRoster, onPhoneIndex),
  ),
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

/** Boot the kiosk straight into a bound, ready screen holding only Ada. */
async function mount(): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(binding()));
  localStorage.setItem(KIOSK_KEYS.roster, JSON.stringify({ fetchedAtMs: Date.now(), students: [ADA] }));
  render(<KioskApp />);
  await settle();
}

/** Types on the kiosk's own keyboard, which listens on glass contact. */
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  refreshDirectory = async (onRoster, onPhoneIndex) => {
    onRoster([ADA, GRACE]);
    onPhoneIndex({});
  };
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('looking again for somebody the cached roster does not hold', () => {
  it('finds a family the cache was too old to know about', async () => {
    await mount();
    await type('grace');

    expect(screen.getByText(/No match/)).toBeTruthy();
    await tap(OFFER);

    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);
    // The search re-runs against the fresh roster on its own — a parent who
    // asked for this must not have to retype the name they just typed.
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('says so while the read is in flight, and does not start a second one', async () => {
    let land = () => {};
    refreshDirectory = (onRoster) =>
      new Promise((resolve) => {
        land = () => {
          onRoster([ADA, GRACE]);
          resolve();
        };
      });

    await mount();
    await type('grace');
    await tap(OFFER);

    // A sweep of the whole church is not instant, and a screen that says
    // nothing about it is a screen a parent taps again.
    expect(screen.getByText(/Checking…/)).toBeTruthy();
    await tap(/Checking…/);
    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);

    // Nor does walking away from it start a second one. A read in flight is the
    // one thing a cleared buffer does not reset — the cooldown has not been
    // stamped yet, so there would be nothing else to stop the next tap.
    await tap('Clear');
    await type('grace');
    expect(screen.getByText(/Checking…/)).toBeTruthy();
    await tap(/Checking…/);
    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);

    await act(async () => {
      land();
    });
    await settle();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('offers a retry when the network refuses, rather than reporting an answer', async () => {
    refreshDirectory = async () => {
      throw new Error('offline');
    };

    await mount();
    await type('grace');
    await tap(OFFER);

    expect(screen.getByText(/Couldn.t reach the network/)).toBeTruthy();
    // Emphatically not "still no match": nobody looked.
    expect(screen.queryByText(/Still no match/)).toBeNull();

    refreshDirectory = async (onRoster) => onRoster([ADA, GRACE]);
    await tap(/Try again/);
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('shows the half of the answer that landed', async () => {
    // The phone index rebuild is still going, or gave up; the roster read did
    // not. A name search does not care, and a family whose name has arrived
    // should not wait behind a sweep of the church's phone numbers.
    refreshDirectory = async (onRoster) => {
      onRoster([ADA, GRACE]);
    };

    await mount();
    await type('grace');
    await tap(OFFER);

    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('says it looked, when it looked and found nothing', async () => {
    refreshDirectory = async (onRoster) => onRoster([ADA]);

    await mount();
    await type('grace');
    await tap(OFFER);

    expect(screen.getByText(/Still no match/)).toBeTruthy();
    // The offer is spent: tapping it again would sweep the church for the same
    // answer, and the screen would look identical either way.
    expect(screen.queryByText(OFFER)).toBeNull();
  });

  it('answers the next family from the read it just did, without sweeping again', async () => {
    refreshDirectory = async (onRoster) => onRoster([ADA]);

    await mount();
    await type('grace');
    await tap(OFFER);
    await tap('Clear');

    // A new person at the kiosk, and a fresh offer — the state describes one
    // search, not the device.
    await type('noah');
    expect(screen.getByText(OFFER)).toBeTruthy();

    await tap(OFFER);
    // Answered from the sweep a minute ago rather than a second one: a queue of
    // latecomers is one clump, and it must not be one sweep each.
    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Still no match/)).toBeTruthy();
  });

  it('stays out of the way of a search that is still being typed', async () => {
    await mount();

    // Two digits of a phone number match nobody by construction — offering a
    // read of the church here would fire on the way to every phone search.
    await type('12');
    expect(screen.queryByText(OFFER)).toBeNull();

    await tap('Clear');
    await type('ada');
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.queryByText(OFFER)).toBeNull();
  });
});
