/**
 * The offer a printer makes when it comes back, through the app's own machine.
 *
 * A roll runs out at 9:05 and is noticed at 9:20, and in between a dozen
 * children walked into rooms with nothing on them. The kiosk is the only thing
 * in the building that knows exactly which dozen — it queued those labels and
 * watched them fail — so this is the one piece of work it can do that nobody
 * else can. What the policy offers is `owed.ts`; what the list looks like is
 * `screens/OwedScreen.test.tsx`. What is pinned here is the wiring between
 * them, and nearly all of it is about *restraint*:
 *
 *  - **nothing prints by itself.** The recovery opens a question, never a
 *    batch. Twelve stickers coming out of a printer somebody has just walked
 *    away from is the failure this whole design is arranged around.
 *  - **the parent's glass stays the parent's.** The front door gets a dot and,
 *    for a few quiet minutes, one line of words; both lead to the same staff
 *    screen the dot has always opened.
 *  - **the kiosk changes the screen under a finger exactly once**, and only on
 *    the screen whose own button the volunteer just pressed.
 *  - **one press settles every row**, so the next person is not asked again
 *    about children somebody has already decided against.
 */
import { act, cleanup, fireEvent, render, screen } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskPrinting, type KioskServices } from '@/kiosk/KioskApp';
import { HOLD_DELAY_MS, HOLD_MS } from '@/kiosk/components/HoldButton';
import { OWED_QUIET_MS, OWED_TICK_MS, type OwedTag } from '@/kiosk/owed';
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

const MIRA: KioskStudent = {
  id: 'student-mira',
  firstName: 'Mira',
  lastName: 'Haddad',
  grade: 2,
  searchName: 'mira haddad',
  hasAllergies: false,
};

const ROSTER = [ADA, NOAH, MIRA];

const CONFIG = { model: 'QL-810W', label: '62x29' };
const READY = { kind: 'ready' as const, config: CONFIG };
const TROUBLE = {
  kind: 'trouble' as const,
  message: { text: 'Out of labels.' },
  advice: { key: 'adviceCheckPrinter' },
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
    labelTemplate: DEFAULT_LABEL_TEMPLATE,
    boundAtMs: now,
    ...overrides,
  };
}

/** The module's listeners, so a test can push a printer state as the real one does. */
const printerListeners: ((state: unknown) => void)[] = [];

/** What the printing module says it still owes. Reassigned per test. */
let owed: OwedTag[] = [];

const printing = {
  warmLabel: vi.fn(),
  printLabel: vi.fn(),
  forgetLabel: vi.fn(),
  setAllergySource: vi.fn(),
  forgetAllergies: vi.fn(),
  forgetGathering: vi.fn(),
  currentState: vi.fn(() => READY as unknown),
  subscribe: vi.fn((listener: (state: unknown) => void) => {
    listener(printing.currentState());
    printerListeners.push(listener);
    return () => {
      printerListeners.splice(printerListeners.indexOf(listener), 1);
    };
  }),
  ready: vi.fn(async () => READY),
  reprintLabel: vi.fn(),
  printedTonight: vi.fn(() => []),
  owedLabels: vi.fn(() => owed),
  printOwedLabels: vi.fn(),
  settleOwed: vi.fn((studentIds: readonly string[]) => {
    owed = owed.filter((tag) => !studentIds.includes(tag.studentId));
  }),
  closePrinter: vi.fn(async () => {}),
  labelPreview: vi.fn(() => ['Ada L', '8th grade']),
  testPrint: vi.fn(),
  labelsForModel: vi.fn(() => [{ identifier: '62x29' }]),
  labelName: vi.fn(() => '62 × 29mm'),
  modelIdentifiers: vi.fn(() => ['QL-810W']),
  configure: vi.fn(async () => {}),
  pairPrinter: vi.fn(async () => null),
  checkPrinter: vi.fn(async () => null),
  printerLog: vi.fn(() => []),
  printerLogText: vi.fn(() => ''),
  describeAge: vi.fn(() => 'just now'),
  describeEntry: vi.fn(() => ''),
} as unknown as KioskPrinting;

let checkedOut = new Set<string>();

const services = {
  restoredSession: vi.fn(async () => ({ uid: 'kiosk_kiosk-test-device', reason: null })),
  reportStanding: vi.fn(async () => 'live' as const),
  unpair: vi.fn(async () => {}),
  loadRoster: vi.fn(async () => ROSTER),
  loadPhoneIndex: vi.fn(async () => ({})),
  loadParticipation: vi.fn(async () => ({
    participated: new Set<string>(),
    recent: new Set<string>(),
  })),
  fetchAttendance: vi.fn(async () => ({
    present: new Set<string>(),
    checkedOut,
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

async function mount(bound: KioskBinding = binding()): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({ version: KIOSK_ROSTER_VERSION, fetchedAtMs: Date.now(), students: ROSTER }),
  );
  render(<KioskApp />);
  await settle();
}

async function tap(text: RegExp | string): Promise<void> {
  const button = screen.getByText(text).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
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
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + HOLD_MS);
  });
  await settle();
}

/** Push a printer state the way the module does. `cause` is what a press sets. */
async function push(state: unknown): Promise<void> {
  await act(async () => {
    for (const listener of [...printerListeners]) listener(state);
  });
  await settle();
}

/** A printer that broke, and then came back — by itself unless `byPress`. */
async function recover(byPress = false): Promise<void> {
  await push(TROUBLE);
  await push(byPress ? { ...READY, cause: 'press' } : READY);
}

/** Nobody touches the glass for long enough that the kiosk believes it. */
async function goQuiet(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(OWED_QUIET_MS + 100);
  });
  await settle();
}

/**
 * Walk to the offer the way staff do: the gate, the printer screen, the batch.
 *
 * The front door's notice leads to the same printer screen — that is asserted
 * on its own below — but it only exists while the glass is quiet, so the cases
 * about the list itself take the route that is always there.
 */
async function openOffer(): Promise<void> {
  await holdClear();
  await tap(/Label printer/i);
  await tap(/^Print \d+ name tags?$/);
}

function tag(student: KioskStudent, minutesAgo: number): OwedTag {
  return { studentId: student.id, atMs: Date.now() - minutesAgo * 60_000 };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  printerListeners.length = 0;
  owed = [];
  checkedOut = new Set();
  localStorage.clear();
  localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify(CONFIG));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('what the parent’s glass shows', () => {
  it('lights the printer mark while name tags are waiting on a decision', async () => {
    /* The mark means "the printer needs a person", and a decision nobody has
       made is a person it needs — so it is lit by a working printer too. */
    owed = [tag(ADA, 3)];
    await mount();
    await recover();

    expect(screen.getByLabelText(/printer/i)).toBeInTheDocument();
  });

  it('puts it out once the tags have been answered for', async () => {
    owed = [tag(ADA, 3)];
    await mount();
    await recover();

    await openOffer();
    await tap(/^Print 1 name tag$/);
    await tap(/^Done$/);

    expect(screen.queryByLabelText(/printer/i)).not.toBeInTheDocument();
  });

  it('says it in words for a moment, on glass nobody is touching', async () => {
    /* The volunteer who has just reloaded the roll is a metre away looking at
       the printer, not at the tablet. One line, then it goes. */
    owed = [tag(ADA, 3), tag(NOAH, 5)];
    await mount();
    await recover();
    await goQuiet();

    expect(screen.getByText(/2 name tags are waiting/)).toBeInTheDocument();
  });

  it('does not put it there while somebody is using the kiosk', async () => {
    // `calm` is a fact about the screen; a parent correcting a typo is a fact
    // about the lobby, and this notice must never arrive under their hand.
    owed = [tag(ADA, 3)];
    await mount();
    await recover();

    await act(async () => {
      fireEvent.pointerDown(screen.getByText('A', { selector: '[data-key]' }));
      await vi.advanceTimersByTimeAsync(OWED_QUIET_MS - 100);
    });
    await settle();

    expect(screen.queryByText(/name tag is waiting/)).not.toBeInTheDocument();
  });

  it('never prints anything from the parent’s screen', async () => {
    /* The notice is not a second door: its tap is the dot's own, so the offer
       stays two screens away from a stray press in a queue. */
    owed = [tag(ADA, 3)];
    await mount();
    await recover();
    await goQuiet();

    await tap(/1 name tag is waiting/);

    expect(printing.printOwedLabels).not.toHaveBeenCalled();
    /* The dot's own screen, which *says* what is waiting and keeps the batch
       one deliberate press further on. The offer's own title carries no full
       stop; this line does, which is how these two are told apart. */
    expect(screen.getByText('1 name tag did not print.')).toBeInTheDocument();
    expect(screen.queryByText(/did not print$/)).not.toBeInTheDocument();
  });
});

describe('the staff menu', () => {
  it('leads with the tags that are waiting', async () => {
    owed = [tag(ADA, 3), tag(NOAH, 4), tag(MIRA, 6)];
    await mount();
    await recover();
    await holdClear();

    expect(screen.getByText('3 waiting')).toBeInTheDocument();
  });

  it('still opens under a hold while tags are owed', async () => {
    // The gate is the one way in for staff, and a kiosk that swallowed the
    // hold because it had something to say would be a kiosk staff cannot use.
    owed = [tag(ADA, 3)];
    await mount();
    await recover();
    await goQuiet();
    await holdClear();

    expect(screen.getByText(/Reprint a name tag/i)).toBeInTheDocument();
  });
});

describe('the hand-off, which is the only screen the kiosk changes by itself', () => {
  it('opens the offer when the volunteer’s own press brings the printer back', async () => {
    /* `cause: 'press'` is the browser's chooser or **Look again**, both of
       them presses on the printer screen — so the volunteer is looking at the
       glass and the modal they opened guarantees their finger is off it. */
    owed = [tag(ADA, 3)];
    await mount();
    await push(TROUBLE);
    await holdClear();
    await tap(/Label printer/i);
    await push({ ...READY, cause: 'press' });

    expect(screen.getByText(/1 name tag did not print$/)).toBeInTheDocument();
  });

  it('does not open it for a printer that came back on its own', async () => {
    // Nobody is standing there, so there is nobody for the question.
    owed = [tag(ADA, 3)];
    await mount();
    await recover();

    expect(screen.queryByText(/1 name tag did not print$/)).not.toBeInTheDocument();
  });

  it('does it once per recovery, not once per render', async () => {
    owed = [tag(ADA, 3)];
    await mount();
    await push(TROUBLE);
    await holdClear();
    await tap(/Label printer/i);
    await push({ ...READY, cause: 'press' });
    await tap('← Back');

    // A second render carrying the same arrival is the same arrival.
    await push({ ...READY, cause: 'press' });

    expect(screen.queryByText(/1 name tag did not print$/)).not.toBeInTheDocument();
  });

  it('never takes a staff screen that is not the printer screen', async () => {
    /* A `ready` landing on the reprint confirm would put *Print 4 name tags*
       under a thumb descending on *Print name tag*, which is the one thing
       this hand-off must never do. */
    owed = [tag(ADA, 3)];
    await mount();
    await push(TROUBLE);
    await holdClear();
    await tap(/Reprint a name tag/i);
    await push({ ...READY, cause: 'press' });

    expect(screen.queryByText(/1 name tag did not print$/)).not.toBeInTheDocument();
  });
});

describe('the press that answers the whole list', () => {
  it('prints the ticked rows with the time each child arrived', async () => {
    /* `{{time}}` on a nursery sticker is what the room reads for how long a
       child has been here, so the moment travels with the tag rather than
       being taken from the clock when it reaches the tape. */
    const arrived = Date.now() - 4 * 60_000;
    owed = [{ studentId: ADA.id, atMs: arrived }];
    await mount();
    await recover();
    await openOffer();
    await tap(/^Print 1 name tag$/);

    expect(printing.printOwedLabels).toHaveBeenCalledTimes(1);
    const tags = vi.mocked(printing.printOwedLabels).mock.calls[0][3];
    expect(tags).toEqual([{ student: expect.objectContaining({ id: ADA.id }), atMs: arrived }]);
  });

  it('settles the rows nobody ticked as well as the ones they did', async () => {
    /* A volunteer who printed three of nine and walked away had settled
       nothing: the dot stayed lit and the next person was asked again about
       children somebody had already decided against. */
    owed = [tag(ADA, 3), tag(NOAH, Math.ceil(OWED_TICK_MS / 60_000) + 5)];
    await mount();
    await recover();
    await openOffer();

    // Ada is inside the ten minutes and ticked; Noah is behind it and is not.
    await tap(/^Print 1 name tag$/);

    expect(vi.mocked(printing.printOwedLabels).mock.calls[0][3]).toHaveLength(1);
    expect(vi.mocked(printing.settleOwed).mock.calls[0][0]).toEqual(
      expect.arrayContaining([ADA.id, NOAH.id]),
    );
  });

  it('prints nothing at all when the volunteer unticks the list', async () => {
    // Skipping is an answer, and the screen has to accept it as one or the
    // only way off it is Back, which settles nothing.
    owed = [tag(ADA, 3)];
    await mount();
    await recover();
    await openOffer();
    await tap('Ada Lovelace');
    await tap(/^Skip 1 name tag$/);

    expect(printing.printOwedLabels).not.toHaveBeenCalled();
    expect(vi.mocked(printing.settleOwed).mock.calls[0][0]).toEqual([ADA.id]);
  });

  it('never offers a child the register has handed back', async () => {
    // A sticker for a child in a car is litter with their name on it.
    owed = [tag(ADA, 3), tag(NOAH, 4)];
    checkedOut = new Set([NOAH.id]);
    await mount();
    await recover();
    await openOffer();

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Noah Okonkwo')).not.toBeInTheDocument();
  });
});
