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
