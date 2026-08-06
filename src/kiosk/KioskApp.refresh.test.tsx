/**
 * What the kiosk does for a family it cannot find — by itself.
 *
 * The roster on the glass is a cache, and the commonest reason a name is
 * missing is that somebody added the child moments ago. The pulse covers every
 * path that touches Tally; what remains is the family added straight into the
 * church's backend, and for them the kiosk runs the old church-wide sweep
 * *silently* the moment a finished search comes up empty — four digits are
 * finished by construction, a name is finished when the typing stops.
 *
 * Pinned here because the whole feature is invisible until it is needed, and
 * every part of it is one line from being harmful instead: a sweep that fires
 * per keystroke, a "Still no match" left standing for the next family, a
 * network failure that reads as an answer, or a second sweep for a queue of
 * latecomers the cooldown should have collapsed into one.
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
  hasAllergies: false,
};

/** Registered at the welcome desk while her family queued — not in the cache. */
const GRACE: KioskStudent = {
  id: 'student-grace',
  firstName: 'Grace',
  lastName: 'Hopper',
  grade: 6,
  searchName: 'grace hopper',
  hasAllergies: false,
};

/**
 * How long a name has to sit still before its empty result is believed.
 * Mirrors NO_MATCH_SWEEP_DEBOUNCE_MS in KioskApp.
 */
const SWEEP_QUIET_MS = 2_000;

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
  loadParticipation: vi.fn(async () => ({
    participated: new Set<string>(),
    recent: new Set<string>(),
  })),
  fetchAttendance: vi.fn(async () => ({
    present: new Set<string>(),
    checkedOut: new Set<string>(),
    arrivals: new Map<string, string>(),
  })),
  fetchPulse: vi.fn(async () => null),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async () => {}),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
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

describe('the silent sweep for somebody the cached roster does not hold', () => {
  /** Lets a finished name query's quiet period elapse. */
  async function quiet(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_QUIET_MS);
    });
    await settle();
  }

  it('finds a family the cache was too old to know about, with no button anywhere', async () => {
    await mount();
    await type('grace');

    expect(screen.getByText(/No match/)).toBeTruthy();
    await quiet();

    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);
    // The search re-runs against the fresh roster on its own — the parent
    // typed a name, and the name is the whole of what was asked of them.
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('sweeps at once for four digits, which are finished by construction', async () => {
    refreshDirectory = async (onRoster, onPhoneIndex) => {
      onRoster([ADA, GRACE]);
      onPhoneIndex({ '9911': ['student-grace'] });
    };

    await mount();
    await type('9911');
    await settle();

    // No quiet period: nobody types a fifth digit.
    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('runs one sweep however the search is reworded while it is in flight', async () => {
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
    await quiet();
    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);

    // Retyping while the read is in flight must not start a second one — the
    // cooldown has not been stamped yet, so the in-flight state is the only
    // thing standing between a queue of parents and a sweep each.
    await tap('Clear');
    await type('grace');
    await quiet();
    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);

    await act(async () => {
      land();
    });
    await settle();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('says the network refused, rather than reporting an answer', async () => {
    refreshDirectory = async () => {
      throw new Error('offline');
    };

    await mount();
    await type('grace');
    await quiet();

    expect(screen.getByText(/Couldn.t reach the network/)).toBeTruthy();
    // Emphatically not "still no match": nobody looked.
    expect(screen.queryByText(/Still no match/)).toBeNull();
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
    await quiet();

    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('says it looked, when it looked and found nothing', async () => {
    refreshDirectory = async (onRoster) => onRoster([ADA]);

    await mount();
    await type('grace');
    await quiet();

    // "Still" is the sweep's one visible trace: the church has been asked,
    // and the honest next doors are the register and a leader.
    expect(screen.getByText(/Still no match/)).toBeTruthy();
  });

  it('answers the next family from the sweep it just ran, without sweeping again', async () => {
    refreshDirectory = async (onRoster) => onRoster([ADA]);

    await mount();
    await type('grace');
    await quiet();
    await tap('Clear');

    await type('noah');
    await quiet();
    // Answered from the sweep a minute ago rather than a second one: a queue
    // of latecomers is one clump, and it must not be one sweep each.
    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Still no match/)).toBeTruthy();
  });

  it('never fires for a search that is still being typed', async () => {
    await mount();

    // Two digits of a phone number match nobody by construction — a sweep
    // here would fire on the way to every phone search in the building.
    await type('12');
    await quiet();
    expect(services.refreshDirectory).not.toHaveBeenCalled();

    // A name still being typed gets its quiet period back with each key.
    await tap('Clear');
    await type('gra');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_QUIET_MS - 500);
    });
    await type('xx');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_QUIET_MS - 500);
    });
    expect(services.refreshDirectory).not.toHaveBeenCalled();

    // And never for a name the kiosk already answers.
    await tap('Clear');
    await type('ada');
    await quiet();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(services.refreshDirectory).not.toHaveBeenCalled();
  });
});
