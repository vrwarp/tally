/**
 * The end of the evening, on a screen nobody is standing at.
 *
 * A kiosk is bound to one gathering and hands itself back when that gathering
 * is over — `max(endAt, checkInClosesAt)`, the same window `bindingIsLive`
 * draws and `binding.test.ts` pins. This file is about the *other* half of that
 * sentence, which is the half that failed in a lobby:
 *
 *  - **the clock may not be latched open.** The expiry refuses to unbind a
 *    kiosk somebody is using, and it read "somebody is using it" off what is on
 *    screen — a query typed, a confirm open. A parent who taps a name and walks
 *    away leaves that state behind them, so an abandoned tap held the binding
 *    for as long as the page lived: the gathering ended, the week turned, and
 *    the tablet was still on Sunday's nursery with a child's name on it. The
 *    touch clock is the backstop, and the point of it is that it is a backstop —
 *    a parent actually standing there is never hurried off.
 *  - **the two doors out put down the same things.** Leaving by hand and
 *    running out of evening are the same act, and the automatic one used to
 *    forget the register while keeping the allergy notes and the list of who
 *    had a name tag printed — on a device that then sat in a lobby all week.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskPrinting, type KioskServices } from '@/kiosk/KioskApp';
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

/** Past the 60-second tick, and short of the touch backstop. */
const ONE_TICK_MS = 70_000;
/** Past the backstop — see ABANDONED_MS in KioskApp. */
const ABANDONED_MS = 2 * 60_000;

const CHOOSER = /which gathering is this kiosk for/i;
const SEARCH = /^type a name$/i;

/** A gathering that is over half a minute from now, and nothing else notable. */
function binding(overrides: Partial<KioskBinding> = {}): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'nursery-today',
    seriesId: null,
    title: 'Sunday Nursery',
    startAtMs: now - 3_600_000,
    endAtMs: now + 30_000,
    checkInClosesAtMs: now + 30_000,
    labelTemplate: null,
    boundAtMs: now - 3_600_000,
    ...overrides,
  };
}

const printing = {
  warmLabel: vi.fn(),
  printLabel: vi.fn(),
  forgetLabel: vi.fn(),
  setAllergySource: vi.fn(),
  forgetAllergies: vi.fn(),
  forgetGathering: vi.fn(),
  currentState: vi.fn(() => ({ kind: 'idle' as const })),
  ready: vi.fn(async () => ({ kind: 'idle' as const })),
  subscribe: vi.fn((listener: (state: unknown) => void) => {
    listener(printing.currentState());
    return () => {};
  }),
  printedTonight: vi.fn(() => []),
  closePrinter: vi.fn(async () => {}),
  labelPreview: vi.fn(() => []),
} as unknown as KioskPrinting;

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  listEvents: vi.fn(async () => []),
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
  performCheckIn: vi.fn(async () => {}),
  performCheckOut: vi.fn(async () => {}),
  warmStudentDates: vi.fn(),
  forgetStudentDates: vi.fn(),
  fetchAllergyNote: vi.fn(async () => null),
  enqueueCheckIn: vi.fn(),
  enqueueCheckOut: vi.fn(),
} as unknown as KioskServices;

vi.mock('@/kiosk/services', () => services);
vi.mock('@/kiosk/printing', () => printing);

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Boot the kiosk straight into a bound, ready screen — with a printer, because
 * the printing module is what holds the evening's allergy notes and label log
 * and this file is partly about those being put down.
 */
async function mount(bound: KioskBinding = binding()): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify({ model: 'QL-810W', label: '62x29' }));
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: [ADA] }),
  );
  render(<KioskApp />);
  await settle();
}

/** Types on the kiosk's own keyboard — a real bubbling press, as the glass gets. */
async function type(word: string): Promise<void> {
  for (const key of word.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

/** A row commits on lift: the list scrolls, so it tells a tap from a drag. */
async function pickAda(): Promise<void> {
  const row = screen.getByText('Ada Lovelace').closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the binding expiring', () => {
  it('hands an idle kiosk back to the chooser once the gathering is over', async () => {
    await mount();
    expect(screen.getByText(SEARCH)).toBeTruthy();

    await wait(ONE_TICK_MS);

    expect(screen.getByText(CHOOSER)).toBeTruthy();
    // And on disk, so the reboot after it lands on the chooser too rather than
    // on a gathering that finished last week.
    expect(localStorage.getItem(KIOSK_KEYS.binding)).toBeNull();
  });

  it('stays put while the gathering is still running', async () => {
    await mount(binding({ endAtMs: Date.now() + 3_600_000, checkInClosesAtMs: Date.now() + 3_600_000 }));

    await wait(ONE_TICK_MS);

    expect(screen.getByText(SEARCH)).toBeTruthy();
  });

  it('runs on to the end of the pickup window, not the end of the event', async () => {
    // The nursery case the window exists for: the evening is over and the
    // parents are in the doorway. Ending at `endAt` would unbind mid-queue.
    const now = Date.now();
    await mount(binding({ endAtMs: now + 30_000, checkInClosesAtMs: now + 3_600_000 }));

    await wait(ONE_TICK_MS);

    expect(screen.getByText(SEARCH)).toBeTruthy();
  });

  it('puts down the evening with it — the notes and the label log included', async () => {
    await mount();
    await wait(ONE_TICK_MS);

    // The same teardown the staff gate's *Leave* does. It is the same act.
    expect(printing.forgetGathering).toHaveBeenCalled();
  });
});

/**
 * The tablet that was put away mid-evening and picked up next week.
 *
 * Two different journeys wear the same clothes, and only one of them was ever
 * covered. A kiosk *reloaded* has always read the clock on the way in and
 * landed on the chooser. A kiosk **resumed** — an installed app switched away
 * from, a screen locked with the browser behind it — comes back to the same
 * page it left, with the same binding in the same React state, and on a
 * platform that froze its timers while it was away. Nothing re-read the clock
 * on the way back in, so the first thing the volunteer opening the app saw was
 * a gathering that finished days ago.
 */
describe('a kiosk coming back', () => {
  const DAYS_AGO = 3 * 86_400_000;

  /** A gathering that finished long before the app was opened again. */
  const lastWeek = () =>
    binding({
      startAtMs: Date.now() - DAYS_AGO,
      endAtMs: Date.now() - DAYS_AGO + 3_600_000,
      checkInClosesAtMs: Date.now() - DAYS_AGO + 3_600_000,
      boundAtMs: Date.now() - DAYS_AGO,
    });

  it('boots to the chooser and takes the dead binding off the disk with it', async () => {
    await mount(lastWeek());

    expect(screen.getByText(CHOOSER)).toBeTruthy();
    /*
     * Cleared at boot rather than at the first tick. The screen was already
     * right; what was wrong was that a tablet opened and closed inside that
     * minute carried last week's gathering to the next boot, and the one after.
     */
    expect(localStorage.getItem(KIOSK_KEYS.binding)).toBeNull();
  });

  it('lets go the moment it is looked at again, without waiting for the clock', async () => {
    // Live at mount, over by the time anybody comes back — the app put away
    // mid-evening. The page stays up; only the platform's clock moves on.
    await mount();
    expect(screen.getByText(SEARCH)).toBeTruthy();

    // Away. A frozen page gets no ticks, which is why the interval is not the
    // whole answer: this advances the clock without running one.
    vi.setSystemTime(Date.now() + DAYS_AGO);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();

    expect(screen.getByText(CHOOSER)).toBeTruthy();
    expect(localStorage.getItem(KIOSK_KEYS.binding)).toBeNull();
  });

  it('leaves a gathering that is still running alone', async () => {
    // The other half: an app switched away from for a moment during the
    // evening, or a screen locked between two families.
    await mount(binding({ endAtMs: Date.now() + 3_600_000, checkInClosesAtMs: Date.now() + 3_600_000 }));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();

    expect(screen.getByText(SEARCH)).toBeTruthy();
  });
});

describe('the four o’clock reload', () => {
  /*
   * The reload is what drops the WebUSB handle, and until now it dropped it
   * with the page — the next page's claim racing the browser's teardown of the
   * last one. What is pinned is the order: the printer is let go of on purpose,
   * and the reload waits for that.
   */
  it('lets go of the printer before reloading', async () => {
    vi.setSystemTime(new Date(2026, 8, 6, 4, 5, 0));
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...location, reload },
    });
    try {
      // Nothing bound, and nobody at the glass for long enough.
      await mount(
        binding({
          startAtMs: Date.now() - 2 * 86_400_000,
          endAtMs: Date.now() - 86_400_000,
          checkInClosesAtMs: Date.now() - 86_400_000,
        }),
      );
      expect(screen.getByText(CHOOSER)).toBeTruthy();

      await wait(ABANDONED_MS + ONE_TICK_MS);

      const closed = vi.mocked(printing.closePrinter).mock;
      expect(closed.calls).toEqual([['reload']]);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(closed.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);

      // The tick after it does not start a second one.
      await wait(ONE_TICK_MS);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
  });
});

describe('a kiosk somebody walked away from', () => {
  it('does not unbind under a parent who is still typing', async () => {
    await mount();
    await type('ad');

    // The gathering ends while they are mid-word. The tick after that must not
    // take the screen away from the person at it.
    await wait(ONE_TICK_MS);

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('unbinds anyway once the glass has been quiet long enough', async () => {
    await mount();
    await type('ad');
    await wait(ONE_TICK_MS);
    expect(screen.queryByText(CHOOSER)).toBeNull();

    // Nobody comes back. The typed query is not a person, and holding the
    // binding open for it is how a lobby tablet spent a week on Sunday.
    await wait(ABANDONED_MS);

    expect(screen.getByText(CHOOSER)).toBeTruthy();
    expect(localStorage.getItem(KIOSK_KEYS.binding)).toBeNull();
  });

  it('unbinds from an abandoned confirm screen, with a child named on it', async () => {
    await mount();
    await type('ada');
    await pickAda();
    expect(screen.getByText(/check in/i)).toBeTruthy();

    await wait(ONE_TICK_MS + ABANDONED_MS);

    expect(screen.getByText(CHOOSER)).toBeTruthy();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('starts the quiet again on every touch, so a slow reader keeps the screen', async () => {
    await mount();
    await type('ad');

    // Half the backstop, a keystroke, half again: never two minutes of quiet,
    // so the kiosk is still theirs.
    await wait(ABANDONED_MS / 2);
    await type('a');
    await wait(ABANDONED_MS / 2);

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });
});
