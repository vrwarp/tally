/**
 * What happens to the kiosk when a family registers itself.
 *
 * The wizard's own rules are pinned in registration/steps.test.ts. What is
 * tested here is everything that happens *around* it — the part a family and
 * the counselor behind them actually see, and the part no screen shows:
 *
 *   - the two doors onto the wizard, one of them the old dead end;
 *   - a sticker per child, on the same terms a tap's label prints on;
 *   - the family becoming searchable — by name and by their four digits —
 *     without waiting for the six-hourly roster refresh;
 *   - a kiosk mid-wizard not counting as idle, so the binding cannot expire
 *     under a parent halfway through typing their children in.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskPrinting, type KioskServices } from '@/kiosk/KioskApp';
/*
 * Imported for its side effect on the module cache, and not used directly.
 *
 * `KioskApp` reaches the wizard through `import('./registration')`, which is
 * the whole point of the chunk — but a dynamic import of a module the runner
 * has never seen takes longer to resolve than a test is willing to wait, and
 * the screen sits on "Loading…". Naming it statically here warms the graph so
 * the dynamic import lands within a turn. The real module is deliberately not
 * mocked: what these tests are about is the wizard driving the real kiosk.
 */
import '@/kiosk/registration';
import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';
import { KIOSK_KEYS } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';
import type { RegisterFamilyRequest, RegisterFamilyResult } from '@/types';

const ADA: KioskStudent = {
  id: 'student-ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  grade: 8,
  searchName: 'ada lovelace',
  hasAllergies: false,
};

/** A gathering that has already ended, for the expiry test. */
function binding(overrides: Partial<KioskBinding> = {}): KioskBinding {
  const now = Date.now();
  return {
    eventId: 'friday-today',
    seriesId: 'friday-fellowship',
    title: 'Friday Fellowship',
    startAtMs: now - 60_000,
    endAtMs: now + 3_600_000,
    checkInClosesAtMs: now + 3_600_000,
    requiresCheckOut: false,
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
  reprintLabel: vi.fn(),
  printedTonight: vi.fn(() => []),
  closePrinter: vi.fn(async () => {}),
  labelPreview: vi.fn(() => []),
  forgetGathering: vi.fn(),
  testPrint: vi.fn(),
  // Handed the allergy callable by KioskApp once both chunks have landed —
  // `services.ts` is the only module allowed to import Firebase, so the
  // printing chunk is given the reader rather than reaching for one.
  setAllergySource: vi.fn(),
  // The other half of that: the one note the callable above cannot answer, so
  // it is handed over instead of asked for. See printing/allergy.ts.
  rememberAllergyNote: vi.fn(),
} as unknown as KioskPrinting;

/** What the callable answers. Reassigned per test. */
let answer: RegisterFamilyResult = {
  status: 'created',
  children: [
    {
      studentId: 'new-robin',
      firstName: 'Robin',
      lastName: 'Fields',
      grade: 4,
      searchName: 'robin fields',
    },
    {
      studentId: 'new-sam',
      firstName: 'Sam',
      lastName: 'Fields',
      grade: 2,
      searchName: 'sam fields',
    },
  ],
  last4: '3344',
  checkedIn: true,
};
let sent: RegisterFamilyRequest[] = [];
let registerFails = false;
/** What the callable rejects with, when it does. */
let registerError: { code?: string } = { code: 'functions/internal' };
/**
 * Holds the callable open so a test can stand on the saving screen.
 *
 * Set before the commit; `releaseRegister()` answers it. Everything about the
 * saving screen — the bar, the early sticker, the controls that go while the
 * call is in the air — is a claim about the window between the press and the
 * response, and that window is otherwise a microtask wide.
 */
let registerHangs = false;
let releaseRegister: () => void = () => {};
/**
 * The four-digit index the kiosk searches, seeded per test.
 *
 * It has to come through the loader rather than through localStorage: the
 * stored copy is only the first paint, and the load that follows it a tick
 * later replaces whatever was there.
 */
let phoneIndex: Record<string, string[]> = {};
/** What a forced refresh finds — a family who registered on their own phone. */
let refreshedStudents: KioskStudent[] = [];
let refreshedLast4: Record<string, string[]> = {};

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  // Only reached if a test lets the kiosk fall back to the chooser, which is
  // the failure these tests are about — so it answers rather than throwing.
  listEvents: vi.fn(async () => []),
  loadRoster: vi.fn(async () => [ADA]),
  loadPhoneIndex: vi.fn(async () => phoneIndex),
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
  enqueueCheckIn: vi.fn(),
  enqueueCheckOut: vi.fn(),
  // Passed through to the printing chunk on mount; never called here, because
  // nothing a family registers a second ago has an allergy note on file.
  fetchAllergyNote: vi.fn(async () => null),
  registerFamily: vi.fn(async (request: RegisterFamilyRequest) => {
    sent.push(request);
    if (registerHangs) {
      await new Promise<void>((resolve) => {
        releaseRegister = resolve;
      });
    }
    if (registerFails) throw registerError;
    return answer;
  }),
  refreshDirectory: vi.fn(
    async (
      onRoster: (students: KioskStudent[]) => void,
      onPhoneIndex: (last4: Record<string, string[]>) => void,
    ) => {
      onRoster([ADA, ...refreshedStudents]);
      onPhoneIndex(refreshedLast4);
    },
  ),
  // The real one merges into localStorage and hands back the students; the
  // shape is all `KioskApp` uses.
  applyRegistration: vi.fn((result: { children: readonly { studentId: string; firstName: string; lastName: string; grade: number | null; searchName: string }[] }) =>
    result.children.map((child) => ({
      id: child.studentId,
      firstName: child.firstName,
      lastName: child.lastName,
      grade: child.grade,
      searchName: child.searchName,
    })),
  ),
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
  localStorage.setItem(KIOSK_KEYS.roster, JSON.stringify({ fetchedAtMs: Date.now(), students: [ADA] }));
  render(<KioskApp />);
  await settle();
}

function configurePrinter(): void {
  localStorage.setItem(KIOSK_KEYS.printer, JSON.stringify({ model: 'QL-810W', label: '62x29' }));
}

async function tap(text: RegExp | string): Promise<void> {
  // Down *and* up, because every button on the kiosk waits for the lift now —
  // a press alone is a gesture the control has not decided about yet (see
  // components/tapGuard.ts).
  const button = screen.getByText(text).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
  });
  await settle();
}

/**
 * Types on the kiosk's own keyboard, which listens on glass contact.
 *
 * Addressed by `data-key`, never by the label: a letter key now shows its
 * shift state, so its text changes as you type and its name does not. What
 * comes out is whatever case the keyboard was showing — which is the point of
 * the shift key, and why this passes the intended text rather than a cased one.
 */
async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) {
    await act(async () => {
      const name = key === ' ' ? 'space' : key;
      fireEvent.pointerDown(document.querySelector(`[data-key="${name}"]`)!);
    });
  }
  await settle();
}

/** One child, through the three questions and the fork. */
/** A row of the question list, which is a button once it has an answer. */
async function tapRow(id: string): Promise<void> {
  const row = screen.getByTestId(`question-${id}`);
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
}

async function enterChild(first: string, last: string, grade: string): Promise<void> {
  await type(first);
  await tap('Next');
  await tap('Clear');
  await type(last);
  await tap('Next');
  // A chip selects rather than advancing now; Next leaves the question, as on
  // every other step.
  await tap(grade);
  await tap('Next');
}

/** The adult's three questions, from their first name to the confirm. */
async function enterGuardian(first: string, last: string, phone: string): Promise<void> {
  await type(first);
  await tap('Next');
  await tap('Clear');
  await type(last);
  await tap('Next');
  await type(phone);
  await tap('Next');
}

/**
 * The whole wizard, up to but not including the final button.
 *
 * The second child is added from the confirm screen, which is the only place
 * that offers it now: the "Anybody else?" screen that used to stand between the
 * children and the adult asked every family a question most of them answer
 * "no" to, about a list the confirm shows again four screens later.
 */
async function fillInTheFamily(): Promise<void> {
  await tap(/Register your child/);
  await enterChild('Robin', 'Fields', '4');
  await enterGuardian('Dana', 'Fields', '5550103344');
  await tap('Add another child');
  await enterChild('Sam', 'Fields', '2');
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  sent = [];
  registerFails = false;
  registerError = { code: 'functions/internal' };
  registerHangs = false;
  releaseRegister = () => {};
  phoneIndex = {};
  refreshedStudents = [];
  refreshedLast4 = {};
  answer = {
    status: 'created',
    children: [
      { studentId: 'new-robin', firstName: 'Robin', lastName: 'Fields', grade: 4, searchName: 'robin fields' },
      { studentId: 'new-sam', firstName: 'Sam', lastName: 'Fields', grade: 2, searchName: 'sam fields' },
    ],
    last4: '3344',
    checkedIn: true,
    };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getting into the wizard', () => {
  it('offers the door without making a family fail a search first', async () => {
    // A parent told "just put your name in" types a name and gets somebody
    // else's child back — the no-match state never fires for them, so the
    // standing offer is the only door they will ever find.
    await mount();
    expect(screen.getByText(/First time here\?/)).toBeTruthy();
  });

  it('replaces the old dead end when a search finds nobody', async () => {
    await mount();
    await type('ZZ');

    expect(screen.getByText(/No match — first time here\?/)).toBeTruthy();
    // Seeing a leader is still offered; it is no longer the whole answer.
    expect(screen.getByText(/or see a leader/)).toBeTruthy();
  });

  it('keeps the door open when the four digits matched somebody else', async () => {
    /*
     * The coincidence, which the no-match state can never catch.
     *
     * Four digits are a small keyspace. A family nobody has met types theirs,
     * and the kiosk answers with a real child, correctly spelled, who is not
     * theirs — a *successful* search that is the wrong answer. The offer has to
     * be standing there while those rows are up, and it has to stop asking
     * whether they are new: what they are looking at is a stranger.
     */
    phoneIndex = { '3344': [ADA.id] };
    await mount();
    await type('3344');

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText(/Not your family\?/)).toBeTruthy();
    expect(screen.queryByText(/First time here\?/)).toBeNull();

    await tap(/Register your child/);

    // And it is the same door, opening the same wizard — one tap from the
    // question to the first question. The wizard names its field against the
    // readout rather than in the header; that label is what identifies the step.
    expect(screen.getByText("Child's first name")).toBeTruthy();
  });
});

describe('registering a family', () => {
  it('sends one call for the whole family, checked in against this gathering', async () => {
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.eventId).toBe('friday-today');
    expect(sent[0]!.children).toEqual([
      { firstName: 'Robin', lastName: 'Fields', grade: 4 },
      { firstName: 'Sam', lastName: 'Fields', grade: 2 },
    ]);
    expect(sent[0]!.guardian).toEqual({
      firstName: 'Dana',
      lastName: 'Fields',
      phone: '5550103344',
    });
    expect(sent[0]!.registrationId).toMatch(/.{20,}/);
  });

  it('teaches the family their four digits before it lets them go', async () => {
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');

    expect(screen.getByText('Robin and Sam are checked in. Welcome!')).toBeTruthy();
    expect(screen.getByText('3344')).toBeTruthy();
  });

  it('prints one sticker per child', async () => {
    configurePrinter();
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');

    expect(printing.printLabel).toHaveBeenCalledTimes(2);
    expect((printing.printLabel as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].firstName))
      .toEqual(['Robin', 'Sam']);
  });

  it('leaves the family searchable by name and by their digits, at once', async () => {
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');
    await tap('Done');

    // Nothing was refetched: the server patched the index, and the answer that
    // came back with the response is what this screen searches until it does.
    await type('Robin');
    expect(screen.getByText('Robin Fields')).toBeTruthy();

    await tap('Clear');
    await type('3344');
    expect(screen.getByText('Robin Fields')).toBeTruthy();
    expect(screen.getByText('Sam Fields')).toBeTruthy();
  });

  it('shows them as checked in, so a second family cannot re-tap them', async () => {
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');
    await tap('Done');
    await type('Robin');

    expect(screen.getByText('✓ Checked in')).toBeTruthy();
  });

  it('gives a just-registered child the same ten-minute hold a tap would', async () => {
    /*
     * `reprintStanding` asks whether *this kiosk* checked the child in and
     * when, and the when was never written down here — only `onConfirm` kept
     * that clock. So the one hold built for "I checked in just now and no
     * sticker came out" was missing from the only door that had just printed a
     * child's first ever label, which is the likeliest place for it to be
     * wanted. See reprintOffer.ts.
     */
    configurePrinter();
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');
    await tap('Done');

    await type('Robin');
    const row = screen.getByText('Robin Fields').closest('button')!;
    await act(async () => {
      fireEvent.pointerDown(row);
      fireEvent.pointerUp(row);
    });
    await settle();

    expect(screen.getByText(/Already checked in/i)).toBeTruthy();
    expect(screen.getByText(/Hold to print a name tag/i)).toBeTruthy();
  });
});

describe('while the call is in the air', () => {
  it('takes Back away, so a parent cannot drop their own registration mid-flight', async () => {
    /*
     * `goBack` has no case for `submitting`, so it answered null — and null is
     * this header's word for "there is nowhere back, close the wizard". One tap
     * on a button sitting in plain sight put the parent on the search screen
     * while the callable was still in the air. The family still landed and the
     * stickers still came out, because `onRegistered` belongs to `KioskApp` and
     * outlives the unmount; what went was the screen with their four digits on
     * it, which is the entire point of the run.
     */
    registerHangs = true;
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');

    expect(screen.getByText('One moment')).toBeTruthy();
    await tap(/← Back/);
    expect(screen.getByText('One moment')).toBeTruthy();

    await act(async () => {
      releaseRegister();
    });
    await settle();
    expect(screen.getByText('3344')).toBeTruthy();
  });
});

describe('the four things a parent touches', () => {
  it('names the field it is asking about, on both people', async () => {
    // "Type here" repeated the shape of the screen back and named nothing. On
    // the two steps where the answer could belong to either person in the room,
    // the placeholder is the only thing that says which.
    await mount();
    await tap(/Register your child/);
    expect(screen.getAllByText("Child's first name").length).toBeGreaterThan(0);

    await type('Robin');
    await tap('Next');
    expect(screen.getAllByText("Child's last name").length).toBeGreaterThan(0);

    await tap('Clear');
    await type('Fields');
    await tap('Next');
    expect(screen.getAllByText('What grade are they in?').length).toBeGreaterThan(0);

    await tap('4');
    await tap('Next');
    expect(screen.getAllByText('Your first name').length).toBeGreaterThan(0);
    /*
     * And the header is not the same words again. It carries the gathering,
     * because the field says what it wants against the field: the question used
     * to be asked twice at opposite ends of the type ramp, once at 4.24:1 in
     * the smallest text on the screen and once as the loudest object on it.
     */
    expect(screen.getAllByText('Friday Fellowship').length).toBeGreaterThan(0);
  });

  it('shows the whole run, so the adult’s half is not a surprise', async () => {
    /*
     * The "Anybody else?" screen used to stand between the children and the
     * adult, and however badly its **That's everyone** read, it was a visible
     * seam. Without one, three questions about the adult would arrive in a
     * frame identical to the four before them — so the run is on the glass
     * from the first question, named rather than counted.
     */
    await mount();
    await tap(/Register your child/);

    expect(screen.getByTestId('question-child-0-child-first')).toHaveAttribute(
      'data-state',
      'now',
    );
    for (const id of ['adult-guardian-first', 'adult-guardian-last', 'adult-guardian-phone']) {
      expect(screen.getByTestId(`question-${id}`)).toHaveAttribute('data-state', 'todo');
    }

    // And the answers fill in behind, so a name typed forty seconds ago can be
    // checked without pressing Back four times to reach it.
    await enterChild('Robin', 'Fields', '4');
    expect(screen.getByTestId('question-child-0-child-first')).toHaveTextContent('Robin');
    expect(screen.getByTestId('question-child-0-child-grade')).toHaveTextContent('4th');
    expect(screen.getByTestId('question-adult-guardian-first')).toHaveAttribute(
      'data-state',
      'now',
    );
  });

  it('reopens the child a parent backs out of, rather than a nameless one', async () => {
    /*
     * Banking the child mints a blank draft behind them, so a parent who
     * answered the last child question and then pressed Back used to reopen a
     * child with no name — and pressing on banked that blank for real, which
     * the callable refused. Changing your mind once cost the registration.
     */
    await mount();
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    expect(screen.getAllByText('Your first name').length).toBeGreaterThan(0);

    await tap(/Back/);

    // Back on the grade chips, for the child whose grade they are.
    expect(screen.getAllByText('What grade are they in?').length).toBeGreaterThan(0);
    await tap('4');
    await tap('Next');
    await enterGuardian('Dana', 'Fields', '5550103344');

    // One child on the confirm, not one and a blank — and the commit names
    // them, so a phantom second child would show in the button itself.
    expect(screen.getByText('Check in Robin')).toBeTruthy();
    expect(screen.getAllByText('Robin').length).toBeGreaterThan(0);
  });

  it('shows where the letters will land, before any have', async () => {
    /*
     * The readout is a div and never an input, and deliberately not a box
     * either — so until somebody types it looks like nothing at all, on a step
     * that has only just opened. The caret is the whole of what says otherwise.
     */
    await mount();
    await tap(/Register your child/);
    expect(screen.getByTestId('readout-caret')).toBeTruthy();
  });

  it('offers a shift key, and types what the key is showing', async () => {
    await mount();
    await tap(/Register your child/);

    // Auto-capitalised at the start, so the first letter needs no thought.
    await type('Mc');
    expect(screen.getByText('Mc')).toBeTruthy();

    // And the key is there for the letter no rule would have capitalised.
    await act(async () => {
      fireEvent.pointerDown(document.querySelector('[data-key="shift"]')!);
    });
    await type('D');
    await type('onald');
    expect(screen.getByText('McDonald')).toBeTruthy();
  });

  it('gives the phone number a dialer rather than a keyboard', async () => {
    await mount();
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    await type('Dana');
    await tap('Next');
    await tap('Clear');
    await type('Fields');
    await tap('Next');

    // The letters are gone; the digits are laid out as a phone.
    expect(document.querySelector('[data-key="Q"]')).toBeNull();
    expect(document.querySelector('[data-key="7"]')).toBeTruthy();
    expect(screen.getByText('PQRS')).toBeTruthy();
  });

  it('names the year below kindergarten rather than printing its number', async () => {
    // Pre-K's number is Planning Center's, and it is -1. The chip grid used to
    // stringify the grade it was given, so the first thing the parent of a
    // four-year-old read — top left, ahead of "K" — was a chip saying "-1".
    await mount();
    await tap(/Register your child/);
    await type('Robin');
    await tap('Next');
    await tap('Clear');
    await type('Fields');
    await tap('Next');

    expect(screen.queryByText('-1')).toBeNull();
    await tap('Pre-K');
    await tap('Next');
    await enterGuardian('Dana', 'Fields', '5550103344');

    // And it is a real answer, not a blank: the wizard records the year.
    expect(screen.getByText('Check in Robin')).toBeTruthy();
    expect(screen.getByText('Pre-K')).toBeTruthy();
  });

  it('lets a parent tap a name three screens back and puts them where they were', async () => {
    /*
     * The repair Back could not give them. The row somebody wants is usually a
     * banked child's, and Back un-banks its way there — so fixing one letter
     * meant walking the whole run forwards again, in front of a queue.
     */
    await mount();
    await tap(/Register your child/);
    await enterChild('Robin', 'Feilds', '4');
    await type('Dana');
    await tap('Next');
    expect(screen.getAllByText('Your last name').length).toBeGreaterThan(0);

    // Three screens back, already committed, and one tap away.
    await tapRow('child-0-child-last');
    expect(screen.getAllByText("Child's last name").length).toBeGreaterThan(0);

    // And the header names the child whose question it is, not the one that
    // would be next: they are fixing their first child, not starting a second.
    expect(screen.getAllByText('Your child').length).toBeGreaterThan(0);
    expect(screen.queryByText('Child 2')).toBeNull();

    await tap('Clear');
    await type('Fields');
    await tap('Next');

    // Back on the adult's surname, which is where they were.
    expect(screen.getAllByText('Your last name').length).toBeGreaterThan(0);
    expect(screen.getByTestId('question-child-0-child-last')).toHaveTextContent('Fields');
  });

  it('repairs a wrong answer from the confirm itself, and comes back to it', async () => {
    /*
     * The whole argument for keeping the list on the confirm. The screen that
     * asks a parent to check their typing used to be the one screen where the
     * rows stopped being buttons — so repair got harder at the exact moment it
     * was asked for, and the only ways back were Back and Cancel.
     */
    await mount();
    await tap(/Register your child/);
    await enterChild('Robin', 'Feilds', '4');
    await enterGuardian('Dana', 'Feilds', '5550103344');
    expect(screen.getByText('Check in Robin')).toBeTruthy();

    await tapRow('child-0-child-last');
    expect(screen.getAllByText("Child's last name").length).toBeGreaterThan(0);
    await tap('Clear');
    await type('Fields');
    await tap('Next');

    // Straight back to the confirm, corrected — not five screens of walking.
    expect(screen.getByText('Check in Robin')).toBeTruthy();
    expect(screen.getByTestId('question-child-0-child-last')).toHaveTextContent('Fields');
  });

  it('names on the commit what it is about to check in, and only that', async () => {
    /*
     * "Check in everyone" named a set the kiosk does not act on: the guardian
     * is the last row on this screen and is never checked in — one attendance
     * row is written per child and only per child. The button says what it
     * does instead, which leaves the ambiguity nowhere to live.
     */
    await mount();
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    await enterGuardian('Dana', 'Fields', '5550103344');
    expect(screen.getByText('Check in Robin')).toBeTruthy();
    expect(screen.queryByText(/everyone/i)).toBeNull();

    await tap('Add another child');
    await enterChild('Sam', 'Fields', '2');
    expect(screen.getByText('Check in Robin and Sam')).toBeTruthy();

    // Past two it counts rather than lists — six names would not fit a button.
    await tap('Add another child');
    await enterChild('Wren', 'Fields', '1');
    expect(screen.getByText('Check in 3 children')).toBeTruthy();

    // And the adult is on the glass throughout, under their own heading rather
    // than as an unlabelled third row of a check-in list.
    expect(screen.getAllByText('And you').length).toBeGreaterThan(0);
  });

  it('shows the children on the screen that offers another one', async () => {
    /*
     * "Anybody else?" cannot be answered against a parent's memory of what they
     * typed forty seconds ago — least of all the parent of four, who is exactly
     * who the loop exists for. So the offer stands against the list, on the
     * screen where the family is written out and a missing child is noticed by
     * reading rather than by remembering.
     */
    await mount();
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    await enterGuardian('Dana', 'Fields', '5550103344');

    // The run itself, still on the glass — the confirm keeps the list rather
    // than replacing it with a receipt of the same facts.
    expect(screen.getByText('Robin')).toBeTruthy();
    expect(screen.getAllByText('Fields').length).toBeGreaterThan(0);
    expect(screen.getByText('4th')).toBeTruthy();
    expect(screen.getByText('Anyone else to add?')).toBeTruthy();
    expect(screen.getByText('Add another child')).toBeTruthy();

    await tap('Add another child');
    await enterChild('Sam', 'Fields', '2');

    // Both of them, including the one just added.
    expect(screen.getByText('Robin')).toBeTruthy();
    expect(screen.getByText('Sam')).toBeTruthy();
    expect(screen.getByText('Check in Robin and Sam')).toBeTruthy();
  });
});

describe('when it does not work', () => {
  /*
   * There is deliberately no "already on the roster" case here any more.
   *
   * The kiosk used to refuse a registration whose child's name matched
   * somebody and tell the family to search instead — which is an instruction
   * to check in a different child of the same name, on a screen with nobody
   * standing at it. The suspicion is recorded for the Review screen now and
   * the family is checked in either way. See
   * functions/src/kiosk/registration.ts.
   */

  it('offers a retry under the same registration id, so nobody is created twice', async () => {
    registerFails = true;
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');

    expect(screen.getByText(/please see a leader/)).toBeTruthy();

    registerFails = false;
    await tap('Try again');

    expect(sent).toHaveLength(2);
    expect(sent[1]!.registrationId).toBe(sent[0]!.registrationId);
    expect(screen.getByText('3344')).toBeTruthy();
  });

  it('does not tell a family it failed when all that happened is we gave up waiting', async () => {
    /*
     * The SDK's seventy-second deadline is a client giving up, not a
     * cancellation — the function runs to its own hundred and twenty seconds,
     * so it may yet write the family after this screen paints. Saying "we could
     * not save that" there is a lie half the time, and the half it is wrong
     * about walks out believing they are not registered. It says what it knows
     * instead: the tags are out, ask somebody who can look it up.
     */
    registerFails = true;
    registerError = { code: 'functions/deadline-exceeded' };
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');

    expect(screen.getByText(/taking longer than expected/i)).toBeTruthy();
    expect(screen.queryByText(/could not save that/i)).toBeNull();
    // Still retryable, and still under the same id — the whole reason giving up
    // early is safe at all.
    registerFails = false;
    await tap('Try again');
    expect(sent[1]!.registrationId).toBe(sent[0]!.registrationId);
  });

  it('still says so plainly when the server actually refused', async () => {
    registerFails = true;
    registerError = { code: 'functions/invalid-argument' };
    await mount();
    await fillInTheFamily();
    await tap('Check in Robin and Sam');

    expect(screen.getByText(/could not save that/i)).toBeTruthy();
  });
});

describe('the clock', () => {
  it('does not expire the binding under a family halfway through', async () => {
    /*
     * The gathering ends while somebody is typing — live at mount, over by the
     * time the clock next ticks. An idle kiosk would unbind there and go back
     * to the chooser; a kiosk with a parent halfway through must not. Seventy
     * seconds is past that tick and short of the wizard's own ninety-second
     * walked-away reset, which is a different rule tested below.
     */
    const endsSoon = Date.now() + 30_000;
    await mount(binding({ endAtMs: endsSoon, checkInClosesAtMs: endsSoon }));
    await tap(/Register your child/);
    await type('Robin');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000);
    });

    expect(screen.getByText(/^Child's first name$/)).toBeTruthy();
  });

  it('puts a half-typed registration away when the family walks off', async () => {
    // Their child's half-typed name must not be what greets the next person.
    await mount();
    await tap(/Register your child/);
    await type('Robin');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000);
    });

    expect(screen.getByText(/^Type a name$/)).toBeTruthy();
  });
});

/**
 * The allergies question, as a family meets it.
 *
 * The step machine's rules are pinned in steps.test.ts; what belongs here is
 * the rendered contract — the "No allergies" tick under the box, the note
 * echoed on the confirm list, and the wire shape: notes ride beside the
 * children only when the binding said the backend can carry them, and never at
 * all when nobody typed one.
 */
describe('the allergies question, where the backend can carry it', () => {
  const asking = () => binding({ allergiesSupported: true });

  const button = (label: string) =>
    screen.getByText(label).closest('button') as HTMLButtonElement;

  it('asks after the grade, and answers "none" in one press', async () => {
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');

    expect(screen.getByText(/Any allergies we should know about/i)).toBeTruthy();

    // One press, not a tick and then a Next: the commonest answer costs what
    // it is worth.
    await tap('No allergies');
    expect(screen.getAllByText('Your first name').length).toBeGreaterThan(0);
  });

  it('leaves Next dead until a note is typed', async () => {
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');

    /*
     * Two buttons that both committed an empty note could not say which one a
     * parent was meant to press. So the rule every other question keeps holds
     * here too: Next is lit when the box holds the answer it would send.
     */
    expect(button('Next').disabled).toBe(true);
    await tap('Next');
    expect(screen.getByText(/Any allergies we should know about/i)).toBeTruthy();

    await type('Peanuts');
    expect(button('Next').disabled).toBe(false);
  });

  it('keeps the keyboard live and the caret blinking throughout', async () => {
    // Nothing on this step is ever withdrawn now — there is no state to be in,
    // only two answers to give.
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');

    expect(screen.getByTestId('readout-caret').className).not.toContain('still');
    await type('Peanuts');
    expect(screen.getByText('Peanuts')).toBeTruthy();
  });

  it('records none whatever had been typed before', async () => {
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');

    await type('Peanuts');
    expect(screen.getByText('Peanuts')).toBeTruthy();

    // The press is the answer, not a label on the box: a parent who thought
    // better of the note is saying there is nothing to report.
    await tap('No allergies');
    await enterGuardian('Dana', 'Fields', '5550103344');
    expect(screen.queryByText(/Allergies:/)).toBeNull();
  });

  it('never asks where the binding is silent', async () => {
    await mount(); // no allergiesSupported key — a pre-flag binding
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    expect(screen.queryByText(/Any allergies/i)).toBeNull();
    expect(screen.getAllByText('Your first name').length).toBeGreaterThan(0);
  });

  it('carries a typed note through to the confirm', async () => {
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');

    await type('Peanuts');
    await tap('Next');
    await enterGuardian('Dana', 'Fields', '5550103344');

    // The family checking their own typing — the one moment the reader is the
    // writer, before this becomes a record a reviewer acts on. Under its own
    // label now, on the row that asked for it.
    expect(screen.getByText('Peanuts')).toBeTruthy();
    expect(screen.getAllByText('Allergies').length).toBeGreaterThan(0);
  });

  it('sends the notes beside the children, and only when one was typed', async () => {
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    await type('Peanuts');
    await tap('Next');
    await enterGuardian('Dana', 'Fields', '5550103344');
    await tap('Add another child');
    await enterChild('Sam', 'Fields', '2');
    await tap('No allergies');
    await tap('Check in Robin and Sam');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.allergies).toEqual(['Peanuts', null]);
    // The children themselves stay the three-field shape the callable parses.
    expect(sent[0]!.children).toEqual([
      { firstName: 'Robin', lastName: 'Fields', grade: 4 },
      { firstName: 'Sam', lastName: 'Fields', grade: 2 },
    ]);
  });

  it('omits the key entirely when every answer was "none"', async () => {
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    await tap('No allergies');
    await enterGuardian('Dana', 'Fields', '5550103344');
    await tap('Check in Robin');

    expect(sent).toHaveLength(1);
    // Not [null] — absent. An all-null array says nothing, and omitting it
    // keeps every no-notes run working across a functions rollback to a
    // version that refuses the key.
    expect(sent[0]!).not.toHaveProperty('allergies');
  });

  it('hands the note to the sticker rather than asking a callable that cannot answer', async () => {
    /*
     * The only child on this kiosk whose allergy cannot be looked up.
     *
     * Registration mints a Tally-owned id, so `fetchAllergyNote` has no
     * upstream person to put to the callable and answers null — and a null
     * under a set flag prints the bare word `Allergy`. The parent typed the
     * real thing four screens ago; it is handed over rather than asked for.
     */
    configurePrinter();
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    await type('Peanuts');
    await tap('Next');
    await enterGuardian('Dana', 'Fields', '5550103344');
    await tap('Check in Robin');

    // Before the sticker, because the sticker is drawn from it — the rule the
    // printing module's own tests pin from the other side.
    expect(printing.rememberAllergyNote).toHaveBeenCalledWith('new-robin', 'Peanuts');
  });

  it('seeds an empty answer for the families who have none', async () => {
    configurePrinter();
    await mount(asking());
    await tap(/Register your child/);
    await enterChild('Robin', 'Fields', '4');
    await tap('No allergies');
    await enterGuardian('Dana', 'Fields', '5550103344');
    await tap('Check in Robin');

    expect(printing.rememberAllergyNote).toHaveBeenCalledWith('new-robin', '');
  });
});
