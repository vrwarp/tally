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
  canReprint: vi.fn(() => false),
  reprintLast: vi.fn(),
  testPrint: vi.fn(),
  // Handed the allergy callable by KioskApp once both chunks have landed —
  // `services.ts` is the only module allowed to import Firebase, so the
  // printing chunk is given the reader rather than reaching for one.
  setAllergySource: vi.fn(),
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
/** What a forced refresh finds — a family who registered on their own phone. */
let refreshedStudents: KioskStudent[] = [];
let refreshedLast4: Record<string, string[]> = {};

const services = {
  restoredUid: vi.fn(async () => 'staff-uid'),
  // Only reached if a test lets the kiosk fall back to the chooser, which is
  // the failure these tests are about — so it answers rather than throwing.
  listEvents: vi.fn(async () => []),
  loadRoster: vi.fn(async () => [ADA]),
  loadPhoneIndex: vi.fn(async () => ({})),
  fetchAttendance: vi.fn(async () => ({ present: new Set<string>(), checkedOut: new Set<string>() })),
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
    if (registerFails) throw new Error('offline');
    return answer;
  }),
  mintRegistrationCode: vi.fn(async () => ({ code: 'ABC234', rotateAfterMs: 600_000 })),
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
  await act(async () => {
    fireEvent.pointerDown(screen.getByText(text).closest('button')!);
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
async function enterChild(first: string, last: string, grade: string): Promise<void> {
  await type(first);
  await tap('Next');
  await tap('Clear');
  await type(last);
  await tap('Next');
  await tap(grade);
}

/** The whole wizard, up to but not including the final button. */
async function fillInTheFamily(): Promise<void> {
  await tap(/Register your child/);
  // The QR is offered first; the wizard is behind "no phone".
  await tap(/Register right here/);
  await enterChild('Robin', 'Fields', '4');
  await tap('Add another child');
  await enterChild('Sam', 'Fields', '2');
  await tap("That's everyone");
  await type('Dana');
  await tap('Next');
  await tap('Clear');
  await type('Fields');
  await tap('Next');
  await type('5550103344');
  await tap('Next');
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  sent = [];
  registerFails = false;
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
});

describe('registering a family', () => {
  it('sends one call for the whole family, checked in against this gathering', async () => {
    await mount();
    await fillInTheFamily();
    await tap('Check in everyone');

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
    await tap('Check in everyone');

    expect(screen.getByText('Robin and Sam are checked in. Welcome!')).toBeTruthy();
    expect(screen.getByText('3344')).toBeTruthy();
  });

  it('prints one sticker per child', async () => {
    configurePrinter();
    await mount();
    await fillInTheFamily();
    await tap('Check in everyone');

    expect(printing.printLabel).toHaveBeenCalledTimes(2);
    expect((printing.printLabel as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].firstName))
      .toEqual(['Robin', 'Sam']);
  });

  it('leaves the family searchable by name and by their digits, at once', async () => {
    await mount();
    await fillInTheFamily();
    await tap('Check in everyone');
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
    await tap('Check in everyone');
    await tap('Done');
    await type('Robin');

    expect(screen.getByText('✓ Checked in')).toBeTruthy();
  });
});

describe('the four things a parent touches', () => {
  it('names the field it is asking about, on both people', async () => {
    // "Type here" repeated the shape of the screen back and named nothing. On
    // the two steps where the answer could belong to either person in the room,
    // the placeholder is the only thing that says which.
    await mount();
    await tap(/Register your child/);
    await tap(/Register right here/);
    expect(screen.getAllByText("Child's first name").length).toBeGreaterThan(0);

    await type('Robin');
    await tap('Next');
    expect(screen.getAllByText("Child's last name").length).toBeGreaterThan(0);

    await tap('Clear');
    await type('Fields');
    await tap('Next');
    await tap('4');
    await tap("That's everyone");
    expect(screen.getAllByText('Your first name').length).toBeGreaterThan(0);
    // And the line above it is context, not the same words again.
    expect(screen.getByText('So we know who brought them.')).toBeTruthy();
  });

  it('offers a shift key, and types what the key is showing', async () => {
    await mount();
    await tap(/Register your child/);
    await tap(/Register right here/);

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
    await tap(/Register right here/);
    await enterChild('Robin', 'Fields', '4');
    await tap("That's everyone");
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

  it('shows the children so far when it asks whether there are more', async () => {
    // The question is "anybody else?", and the parent of four cannot answer it
    // against their memory of what they typed forty seconds ago.
    await mount();
    await tap(/Register your child/);
    await tap(/Register right here/);
    await enterChild('Robin', 'Fields', '4');

    expect(screen.getByText('Robin Fields')).toBeTruthy();
    expect(screen.getByText('4th grade')).toBeTruthy();

    await tap('Add another child');
    await enterChild('Sam', 'Fields', '2');

    // Both of them, including the one just added.
    expect(screen.getByText('Robin Fields')).toBeTruthy();
    expect(screen.getByText('Sam Fields')).toBeTruthy();
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
    await tap('Check in everyone');

    expect(screen.getByText(/please see a leader/)).toBeTruthy();

    registerFails = false;
    await tap('Try again');

    expect(sent).toHaveLength(2);
    expect(sent[1]!.registrationId).toBe(sent[0]!.registrationId);
    expect(screen.getByText('3344')).toBeTruthy();
  });
});

describe('registering on your own phone', () => {
  const REMOTE: KioskStudent = {
    id: 'remote-wren',
    firstName: 'Wren',
    lastName: 'Quill',
    grade: 3,
    searchName: 'wren quill',
    hasAllergies: false,
  };

  it('offers a code to scan, and the address in words for a camera that will not', async () => {
    await mount();
    await tap(/Register your child/);

    expect(screen.getByLabelText('Registration QR code')).toBeTruthy();
    expect(screen.getByText('ABC234')).toBeTruthy();
  });

  it('goes and looks when the family says they have registered', async () => {
    // The form checked nobody in and this kiosk has never heard of them: it
    // searches a local copy of the roster that refreshes every six hours.
    refreshedStudents = [REMOTE];
    refreshedLast4 = { '9012': [REMOTE.id] };

    await mount();
    await tap(/Register your child/);
    await tap(/I've registered/);

    // Back on search, told what to type — the digits are useless without that
    // sentence, and the sentence is useless before the refresh.
    expect(screen.getByText(/type the last 4 digits of your phone/i)).toBeTruthy();

    await type('9012');
    expect(screen.getByText('Wren Quill')).toBeTruthy();
  });

  it('reuses the forced read the no-match state already offers', async () => {
    // Same button behind two doors: this kiosk's roster cache has never heard
    // of a family who filled a form in on their phone, and there is one right
    // way to go and look — see `refreshDirectory`.
    await mount();
    await tap(/Register your child/);
    await tap(/I've registered/);

    expect(services.refreshDirectory).toHaveBeenCalledTimes(1);
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
    await tap(/Register right here/);
    await type('Robin');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000);
    });

    expect(screen.getByText(/first name/i)).toBeTruthy();
  });

  it('puts a half-typed registration away when the family walks off', async () => {
    // Their child's half-typed name must not be what greets the next person.
    await mount();
    await tap(/Register your child/);
    await tap(/Register right here/);
    await type('Robin');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000);
    });

    expect(screen.getByText(/Type a name, or the last 4 digits/)).toBeTruthy();
  });
});
