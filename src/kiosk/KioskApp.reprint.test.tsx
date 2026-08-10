/**
 * Reprinting a name tag, through the app's own state machine.
 *
 * The claims worth pinning are the ones the design was argued into, and most of
 * them are negative:
 *
 *  - **the kiosk stays bound.** The whole reason this work happened is that the
 *    only route to a second sticker went out through *Change event?* and the
 *    chooser, so getting one child a label shut the door on the queue standing
 *    at the kiosk, and putting it back was another two-second hold.
 *  - **nothing reaches the register.** No check-in, no check-out, no arrival id.
 *  - **a parent meets the offer inside ten minutes of *this kiosk* checking
 *    their child in, and never otherwise.** A cap of one per child is not a cap
 *    on a person; the window is what makes the reachable set a queue rather than
 *    a roster.
 *  - **the counter is shared.** A staff reprint spends the parent's one.
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

const NOAH: KioskStudent = {
  id: 'student-noah',
  firstName: 'Noah',
  lastName: 'Okonkwo',
  grade: 6,
  searchName: 'noah okonkwo',
  hasAllergies: false,
};

const ROSTER = [ADA, NOAH];

function binding(overrides: Partial<KioskBinding> = {}): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'nursery-today',
    seriesId: null,
    title: 'Sunday Nursery',
    startAtMs: now - 60_000,
    endAtMs: now + 3_600_000,
    checkInClosesAtMs: now + 3_600_000,
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
  forgetGathering: vi.fn(),
  currentState: vi.fn(() => ({ kind: 'ready' as const, config: { model: 'QL-810W', label: '62x29' } })),
  /*
   * Pushes on subscribe, because the real one does (`printing/index.ts`), and a
   * fake that does not is a kiosk that never learns its printer state — which is
   * how a door disabled in every browser stayed green in every unit test. jsdom
   * dispatches `pointerdown` at a disabled button and React runs the handler;
   * a real browser does neither, so the end-to-end suite failed on a control
   * these tests had been happily pressing.
   */
  subscribe: vi.fn((listener: (state: unknown) => void) => {
    listener(printing.currentState());
    return () => {};
  }),
  ready: vi.fn(async () => ({ kind: 'ready' as const, config: { model: 'QL-810W', label: '62x29' } })),
  reprintLabel: vi.fn(),
  printedTonight: vi.fn(() => []),
  labelPreview: vi.fn(() => ['Ada L', '8th grade']),
  testPrint: vi.fn(),
  labelsForModel: vi.fn(() => [{ identifier: '62x29' }]),
  labelName: vi.fn(() => '62 × 29mm'),
  modelIdentifiers: vi.fn(() => ['QL-810W']),
  configure: vi.fn(async () => {}),
  pairPrinter: vi.fn(async () => {}),
  readStatus: vi.fn(async () => null),
  suggestLabels: vi.fn(() => []),
} as unknown as KioskPrinting;

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  loadRoster: vi.fn(async () => ROSTER),
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

async function mount(bound: KioskBinding = binding()): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: ROSTER }),
  );
  render(<KioskApp />);
  await settle();
}

async function type(word: string): Promise<void> {
  for (const key of word.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

/** A row commits on lift — the list scrolls, so it has to tell a tap from a drag. */
async function pickRow(name: string): Promise<void> {
  const row = screen.getByText(name).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
}

async function tap(text: RegExp | string): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(screen.getByText(text).closest('button')!);
  });
  await settle();
}

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

/** The staff gate: Clear, held. */
async function holdClear(): Promise<void> {
  const clear = screen.getByText('Clear', { selector: '[data-key]' });
  await act(async () => {
    fireEvent.pointerDown(clear);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOLD_MS);
  });
  await settle();
}

/** Check Ada in as a parent would, and land back on an empty search screen. */
async function checkInAda(): Promise<void> {
  await type('ada');
  await pickRow('Ada Lovelace');
  await tap(/^Check in$/);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  configurePrinter();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('the staff reprint flow', () => {
  it('prints one name tag for a named child, and leaves the register alone', async () => {
    await mount();
    await holdClear();
    await tap(/Reprint a name tag/i);
    await type('ada');
    await pickRow('Ada Lovelace');

    // The confirm, not a print: a volunteer is usually here checking a
    // suspicion, and the preview answers it before the tape moves.
    expect(screen.getByText(/Staff · reprint a name tag/i)).toBeTruthy();
    await tap(/Print name tag/i);

    expect(printing.reprintLabel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(printing.reprintLabel).mock.calls[0]?.[0]).toMatchObject({ id: ADA.id });

    expect(services.performCheckIn).not.toHaveBeenCalled();
    expect(services.performCheckOut).not.toHaveBeenCalled();
    expect(services.enqueueCheckIn).not.toHaveBeenCalled();
  });

  it('never takes the kiosk off the gathering to do it', async () => {
    await mount();
    await holdClear();
    await tap(/Reprint a name tag/i);
    await type('ada');
    await pickRow('Ada Lovelace');
    await tap(/Print name tag/i);
    await tap(/Done — back to check-in/i);

    // Bound the whole way through, and back on the screen a parent uses.
    expect(localStorage.getItem(KIOSK_KEYS.binding)).not.toBeNull();
    expect(screen.getByText('Sunday Nursery')).toBeTruthy();
    expect(screen.queryByText(/Staff · reprint a name tag/i)).toBeNull();
  });

  /*
   * The gating bug the end-to-end suite found, pinned where it is cheap to run.
   *
   * A kiosk whose printer is configured but not currently claimed — a browser
   * restarted, a device replugged without a connect event landing — reports
   * `unpaired`, and the queue's `send` reopens for exactly that case rather than
   * failing. Refusing the door on that state told a volunteer to go away from a
   * kiosk that would have printed.
   */
  it('opens the reprint door on a printer that is configured but not claimed', async () => {
    vi.mocked(printing.currentState).mockReturnValue({ kind: 'unpaired' });
    await mount();
    await holdClear();

    const door = screen.getByText(/Reprint a name tag/i).closest('button')!;
    expect(door).not.toBeDisabled();
    // And it says what it knows, because this is staff glass — one word beside
    // the printer's own door, and the sentence itself on the screen behind it.
    expect(screen.getByText(/^Trouble$/i)).toBeTruthy();

    await tap(/Reprint a name tag/i);
    expect(screen.getByText(/Staff · reprint a name tag/i)).toBeTruthy();
    expect(screen.getByText(/Printer needs attention/i)).toBeTruthy();
  });

  /*
   * The other direction: nothing to print to, so no door — and a sentence
   * rather than a dead one. A disabled slab at the top of the stack answers a
   * press with nothing at all, which on a lobby tablet is indistinguishable
   * from a device that has frozen.
   */
  it('puts a statement where the reprint door goes when nothing would print', async () => {
    await mount(binding({ labelTemplate: undefined }));
    await holdClear();

    expect(screen.queryByText(/Reprint a name tag/i)).toBeNull();
    expect(screen.getByText(/No printer on this kiosk/i)).toBeTruthy();
  });

  it('hands the kiosk back on its own when the volunteer walks away', async () => {
    await mount();
    await holdClear();
    await tap(/Reprint a name tag/i);
    expect(screen.getByText(/Staff · reprint a name tag/i)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(46_000);
    });
    await settle();

    expect(screen.queryByText(/Staff · reprint a name tag/i)).toBeNull();
    expect(screen.getByText('Sunday Nursery')).toBeTruthy();
  });

  it('spends the parent’s one copy when staff print first', async () => {
    await mount();
    await checkInAda();

    await holdClear();
    await tap(/Reprint a name tag/i);
    await type('ada');
    await pickRow('Ada Lovelace');
    await tap(/Print name tag/i);
    await tap(/Done — back to check-in/i);

    await type('ada');
    await pickRow('Ada Lovelace');

    // Inside the window, but the one label has gone — so the screen points at a
    // person rather than offering a second.
    expect(screen.queryByText(/Hold to print a name tag/i)).toBeNull();
    expect(screen.getByText(/check-in desk/i)).toBeTruthy();
  });
});

describe('the parent’s ten minutes', () => {
  it('offers a name tag to a parent whose child just checked in here', async () => {
    await mount();
    await checkInAda();

    await type('ada');
    await pickRow('Ada Lovelace');

    expect(screen.getByText(/Already checked in/i)).toBeTruthy();
    expect(screen.getByText(/Hold to print a name tag/i)).toBeTruthy();
  });

  it('prints on the hold, and not on a tap', async () => {
    await mount();
    await checkInAda();
    await type('ada');
    await pickRow('Ada Lovelace');

    const button = screen.getByText(/Hold to print a name tag/i).closest('button')!;
    await act(async () => {
      fireEvent.pointerDown(button);
      fireEvent.pointerUp(button);
    });
    await settle();
    expect(printing.reprintLabel).not.toHaveBeenCalled();

    await hold(/Hold to print a name tag/i);

    expect(printing.reprintLabel).toHaveBeenCalledTimes(1);
    // The receipt is the whole of the completion signal: `haptic()` is
    // `navigator.vibrate`, which the iPads these kiosks are do not implement.
    expect(screen.getByText(/Name tag sent for Ada/i)).toBeTruthy();
    expect(screen.queryByText(/Hold to print a name tag/i)).toBeNull();
  });

  it('takes the offer away once the ten minutes are up', async () => {
    await mount();
    await checkInAda();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 60_000);
    });
    await settle();

    await type('ada');
    await pickRow('Ada Lovelace');

    expect(screen.getByText(/Already checked in/i)).toBeTruthy();
    expect(screen.queryByText(/Hold to print a name tag/i)).toBeNull();
    // What is left is the one line this screen is allowed to add — where a name
    // tag comes from, which is the whole of the discoverability fix.
    expect(screen.getByText(/check-in desk/i)).toBeTruthy();
  });

  /*
   * The refusal the design rests on. Everybody else on the register is outside
   * the window, so a stranger working down the roster meets a statement on every
   * screen — the reachable set is the queue somebody is standing in.
   */
  it('never offers it for a child this kiosk did not check in', async () => {
    await mount();
    await checkInAda();

    await type('noah');
    await pickRow('Noah Okonkwo');

    expect(screen.queryByText(/Hold to print a name tag/i)).toBeNull();
  });

  it('offers nothing on a gathering that prints no labels', async () => {
    await mount(binding({ labelTemplate: undefined }));
    await checkInAda();

    await type('ada');
    await pickRow('Ada Lovelace');

    expect(screen.getByText(/Already checked in/i)).toBeTruthy();
    expect(screen.queryByText(/Hold to print a name tag/i)).toBeNull();
    // Not even the line about the desk: a parent is never told about a printer,
    // and this gathering has nothing to tell them about.
    expect(screen.queryByText(/check-in desk/i)).toBeNull();
  });
});

/*
 * The trap the end-to-end critique found, pinned where it is cheap to run.
 *
 * The printing module is fetched on `phase === 'printer' || hasConfiguredPrinter()`,
 * and the staff screen opens the printer as an *overlay* — the kiosk stays bound —
 * which met neither clause on a kiosk that has never had a printer. The screen
 * then sat on `Loading…` with nothing on it to press, and the gate's inactivity
 * clock re-arms on every pointer event, so tapping the dead-looking tablet is
 * exactly what held it there.
 */
describe('the printer screen, opened from the staff gate', () => {
  it('fetches the printing module on a kiosk that has never had one', async () => {
    localStorage.removeItem(KIOSK_KEYS.printer);
    await mount();
    await holdClear();

    // No printer, so the reprint door is a sentence — and the printer door is
    // still a door, because setting one up for the first time is what it is for.
    expect(screen.getByText(/No printer on this kiosk/i)).toBeTruthy();
    await tap(/Label printer/i);

    // The screen resolves rather than sitting on a spinner nothing will end.
    await settle();
    expect(screen.queryByText(/^Loading…$/)).toBeNull();
    expect(screen.getByText(/Label printer/i)).toBeTruthy();
  });
});
