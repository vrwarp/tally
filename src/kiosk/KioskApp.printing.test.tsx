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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskPrinting, type KioskServices } from '@/kiosk/KioskApp';
import { HOLD_MS } from '@/kiosk/components/HoldButton';
import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';
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

/** Ada's brother — only her brother in the tests that say so. */
const BYRON: KioskStudent = {
  id: 'student-byron',
  firstName: 'Byron',
  lastName: 'Lovelace',
  grade: 5,
  searchName: 'byron lovelace',
  hasAllergies: false,
};

const ROSTER = [ADA, BYRON];

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
  setAllergySource: vi.fn(),
  forgetAllergies: vi.fn(),
  currentState: vi.fn(() => ({ kind: 'ready' as const, config: { model: 'QL-810W', label: '62x29' } })),
  subscribe: vi.fn(() => () => {}),
  ready: vi.fn(async () => ({ kind: 'ready' as const, config: { model: 'QL-810W', label: '62x29' } })),
  reprintLabel: vi.fn(),
  printedTonight: vi.fn(() => []),
  labelPreview: vi.fn(() => []),
  forgetGathering: vi.fn(),
  testPrint: vi.fn(),
} as unknown as KioskPrinting;

/** Who the register says is already here. Reassigned per test. */
let present = new Set<string>();
let checkedOut = new Set<string>();
let checkInFails: Error | null = null;
/** The family digits, so only the tests about families see one. */
let last4: Record<string, string[]> = {};

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => ROSTER),
  loadPhoneIndex: vi.fn(async () => last4),
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
  performCheckIn: vi.fn(async () => {
    if (checkInFails) throw checkInFails;
  }),
  performCheckOut: vi.fn(async () => {}),
  warmStudentDates: vi.fn(),
  forgetStudentDates: vi.fn(),
  fetchAllergyNote: vi.fn(async () => null),
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
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: ROSTER }),
  );
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
 *
 * A result row is the exception and takes the finger off again: the results
 * list scrolls, so a row waits for `pointerup` to tell a tap from the start of
 * a drag (see screens/SearchScreen.tsx).
 */
async function pickAda(): Promise<void> {
  for (const key of ['A', 'D', 'A']) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  const row = screen.getByText('Ada Lovelace').closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
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
 * A collection is a two-second hold rather than a tap — marking a child
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
  last4 = {};
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

/**
 * A family is where the label rules and a bulk action meet, and where the
 * accounting has to stay exact: the queue holds eight, so a screen that warmed
 * a raster it never printed — or printed one nobody ticked — would be spending
 * the roll and the cache on a child who is not there.
 */
describe('a family checked in together', () => {
  /** Ada and Byron answer to the same two numbers, and nobody else does. */
  function asSiblings(): void {
    last4 = { '0134': [ADA.id, BYRON.id], '7788': [ADA.id, BYRON.id] };
  }

  /** A ticked sibling, unticked — a row in a list that scrolls, so on lift. */
  async function untick(name: string): Promise<void> {
    const row = screen.getByText(name).closest('button')!;
    await act(async () => {
      fireEvent.pointerDown(row);
      fireEvent.pointerUp(row);
    });
    await settle();
  }

  it('warms both labels, and prints one each', async () => {
    asSiblings();
    await mount();
    await pickAda();

    // The sibling arrives ticked, so their label is worth the same head start.
    expect(vi.mocked(printing.warmLabel).mock.calls.map((call) => call[0].id).sort()).toEqual(
      [ADA.id, BYRON.id].sort(),
    );

    await tap(/check in all 2/i);

    expect(vi.mocked(printing.printLabel).mock.calls.map((call) => call[0].id).sort()).toEqual(
      [ADA.id, BYRON.id].sort(),
    );
  });

  it('forgets the label of a sibling who is unticked', async () => {
    asSiblings();
    await mount();
    await pickAda();

    await untick('Byron Lovelace');
    await tap('Check in');

    expect(printing.forgetLabel).toHaveBeenCalledWith(BYRON.id);
    expect(printing.printLabel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(printing.printLabel).mock.calls[0]?.[0].id).toBe(ADA.id);
  });

  it('warms nothing for a family being collected', async () => {
    // Both are here, and this gathering hands children back: two collections,
    // and a collection has never produced a sticker.
    asSiblings();
    present = new Set([ADA.id, BYRON.id]);
    await mount();
    await pickAda();

    expect(printing.warmLabel).not.toHaveBeenCalled();

    await hold(/hold to collect all 2/i);

    expect(printing.printLabel).not.toHaveBeenCalled();
    expect(services.performCheckOut).toHaveBeenCalledTimes(2);
  });
});

/**
 * The printing chunk may not import Firebase — that split is what
 * `check-kiosk-budget.mjs` defends — so the one callable a label needs is handed
 * across rather than reached for. A wire nobody connects is a label that quietly
 * prints `Allergy` instead of the peanut, which is the failure this pins.
 */
describe('the allergy lookup', () => {
  it('hands the printing module a way to read one child’s note', async () => {
    await mount();

    expect(printing.setAllergySource).toHaveBeenCalledWith(services.fetchAllergyNote);
  });

  it('takes it back when the kiosk tears down', async () => {
    await mount();

    cleanup();

    // A module held alive by a dynamic import must not go on holding a callable
    // bound to a session that has gone.
    expect(printing.setAllergySource).toHaveBeenLastCalledWith(null);
  });
});
