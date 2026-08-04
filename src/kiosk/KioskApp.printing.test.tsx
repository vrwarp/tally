/**
 * Which taps print, and — the part worth pinning — which do not.
 *
 * A check-out prints nothing. Handing a child back does not produce an artifact;
 * the sticker went on at the door two hours ago. Neither does tapping a child who
 * is already checked in, which is the runaway reprint loop: a parent who does not
 * see a label appear taps again, and again. A second copy is a staff action on the
 * printer screen, deliberately out of a parent's reach.
 *
 * None of that is visible in the UI, which is exactly why it is tested here. The
 * pickup flow will be edited again, and the failure mode is silent — a printer
 * quietly producing a label per collection, and a roll gone by the end of the
 * service.
 *
 * The other claim is the one the whole design rests on: printing cannot break a
 * check-in. The tick is painted before the write and before the label, and a
 * printer that throws must leave that untouched.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskPrinting, type KioskServices } from '@/kiosk/KioskApp';
import { HOLD_MS } from '@/kiosk/components/HoldButton';
import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';
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
    labelTemplate: DEFAULT_LABEL_TEMPLATE,
    boundAtMs: now,
    ...overrides,
  };
}

const printing = {
  warmLabel: vi.fn(),
  printLabel: vi.fn(),
  forgetLabel: vi.fn(),
  currentState: vi.fn(() => ({ kind: 'ready' as const, config: { model: 'QL-810W', label: '62x29' } })),
  subscribe: vi.fn(() => () => {}),
  ready: vi.fn(async () => ({ kind: 'ready' as const, config: { model: 'QL-810W', label: '62x29' } })),
  canReprint: vi.fn(() => false),
  reprintLast: vi.fn(),
  testPrint: vi.fn(),
} as unknown as KioskPrinting;

/** Who the register says is already here. Reassigned per test. */
let present = new Set<string>();
let checkedOut = new Set<string>();
let checkInFails: Error | null = null;

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => [ADA]),
  loadPhoneIndex: vi.fn(async () => ({})),
  fetchAttendance: vi.fn(async () => ({ present, checkedOut })),
  replayQueue: vi.fn(async () => 0),
  performCheckIn: vi.fn(async () => {
    if (checkInFails) throw checkInFails;
  }),
  performCheckOut: vi.fn(async () => {}),
  warmStudentDates: vi.fn(),
  forgetStudentDates: vi.fn(),
  enqueueCheckIn: vi.fn(),
  enqueueCheckOut: vi.fn(),
} as unknown as KioskServices;

vi.mock('@/kiosk/services', () => services);
vi.mock('@/kiosk/printing', () => printing);

/**
 * `KioskApp` decides whether to load the printing module from localStorage
 * before importing it, so the fake is only reached when this key is set.
 */
function configurePrinter(): void {
  localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify({ model: 'QL-810W', label: '62x29' }));
}

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
  localStorage.setItem(KIOSK_KEYS.roster, JSON.stringify({ fetchedAtMs: Date.now(), students: [ADA] }));
  render(<KioskApp />);
  await settle();
}

/**
 * Search for Ada and open the confirm screen.
 *
 * `fireEvent.pointerDown` rather than a click throughout: the kiosk listens on
 * `pointerdown` because it fires on glass contact, and the keyboard delegates a
 * single listener on its container — so the event has to be a real bubbling one
 * on the key itself. jsdom has no `PointerEvent` constructor, which is what
 * `fireEvent` is for.
 */
async function pickAda(): Promise<void> {
  for (const key of ['A', 'D', 'A']) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await act(async () => {
    fireEvent.pointerDown(screen.getByText('Ada Lovelace').closest('button')!);
  });
  await settle();
}

/** Tap a button by its visible text, the way the kiosk expects to be tapped. */
async function tap(text: RegExp | string): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(screen.getByText(text).closest('button')!);
  });
  await settle();
}

/**
 * Press and hold, for the controls that need it.
 *
 * A collection is a three-second hold rather than a tap — marking a child
 * collected is a claim that somebody took them out of the building — so this has
 * to run the clock, not just touch the glass.
 */
async function hold(text: RegExp | string): Promise<void> {
  const button = screen.getByText(text).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(button);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOLD_MS);
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  present = new Set();
  checkedOut = new Set();
  checkInFails = null;
  configurePrinter();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('printing from the kiosk flow', () => {
  it('prints one label when a child is checked in', async () => {
    await mount();
    await pickAda();

    await tap('Check in');

    expect(printing.printLabel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(printing.printLabel).mock.calls[0]?.[0].id).toBe(ADA.id);
  });

  it('warms the label when the confirm screen opens, before anything is tapped', async () => {
    await mount();
    await pickAda();

    // The whole reason a label is moving by the time the tick paints.
    expect(printing.warmLabel).toHaveBeenCalledTimes(1);
    expect(printing.printLabel).not.toHaveBeenCalled();
  });

  it('does not print when a child is collected', async () => {
    // Ada is already here, and this gathering hands children back, so the tap
    // is a check-out.
    present = new Set([ADA.id]);
    await mount();
    await pickAda();

    expect(printing.warmLabel).not.toHaveBeenCalled();

    await hold(/collect/i);

    expect(printing.printLabel).not.toHaveBeenCalled();
    expect(services.performCheckOut).toHaveBeenCalledTimes(1);
  });

  it('does not print for a child who is already checked in', async () => {
    // Present, on a gathering that does not track check-out: the intent is
    // `done`, and tapping it again must not be a way to get another sticker.
    present = new Set([ADA.id]);
    await mount(binding({ requiresCheckOut: false }));
    await pickAda();

    expect(printing.warmLabel).not.toHaveBeenCalled();
    expect(printing.printLabel).not.toHaveBeenCalled();
  });

  it('does not print for a child who has already been collected', async () => {
    present = new Set([ADA.id]);
    checkedOut = new Set([ADA.id]);
    await mount();
    await pickAda();

    expect(printing.warmLabel).not.toHaveBeenCalled();
    expect(printing.printLabel).not.toHaveBeenCalled();
  });

  it('forgets the warm label when the parent backs out of the confirm screen', async () => {
    await mount();
    await pickAda();

    await tap(/Back/);

    expect(printing.forgetLabel).toHaveBeenCalledWith(ADA.id);
    expect(printing.printLabel).not.toHaveBeenCalled();
  });

  it('still checks in when the label cannot be printed', async () => {
    // printLabel is documented never to throw, but the tick must not depend on
    // that being true.
    vi.mocked(printing.printLabel).mockImplementationOnce(() => {
      throw new Error('cover open');
    });

    await mount();
    await pickAda();

    await tap('Check in');

    expect(screen.getByText(/checked in/i)).toBeTruthy();
    expect(services.performCheckIn).toHaveBeenCalledTimes(1);
  });

  it('says nothing to a parent about the printer', async () => {
    vi.mocked(printing.currentState).mockReturnValue({
      kind: 'trouble',
      message: 'No media when printing',
      advice: 'Check the roll.',
    });

    await mount();

    // The message belongs on the staff screen. A parent gets a dot in the
    // corner at most, and never the words.
    expect(screen.queryByText(/No media/)).toBeNull();
    expect(screen.queryByText(/Check the roll/)).toBeNull();
  });
});

describe('a gathering with no label template', () => {
  it('prints nothing, and does not even warm', async () => {
    await mount(binding({ labelTemplate: null }));
    await pickAda();

    await tap('Check in');

    expect(printing.warmLabel).not.toHaveBeenCalled();
    expect(printing.printLabel).not.toHaveBeenCalled();
    expect(services.performCheckIn).toHaveBeenCalledTimes(1);
  });
});
