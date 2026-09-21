/**
 * Checking a family in — and out — in one pass.
 *
 * A parent with three children used to walk the whole flow three times. The
 * kiosk already knows the other two, because they came back from the same four
 * digits, so the confirm screen offers them.
 *
 * What is pinned here is not the offer itself so much as its edges, which are
 * where a bulk action goes wrong: that it only ever offers what the button says
 * it will do, that a name unticked is a child left alone, and that one confirm
 * produces one write per child and no more.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { KIOSK_KEYS } from '@/kiosk/storage';
import type { KioskBinding } from '@/kiosk/binding';
import type { KioskStudent } from '@/kiosk/search';

function student(id: string, firstName: string, lastName: string): KioskStudent {
  return {
    id,
    firstName,
    lastName,
    grade: 9,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
    hasAllergies: false,
  };
}

const AMARA = student('s-amara', 'Amara', 'Osei');
const MARCUS = student('s-marcus', 'Marcus', 'Osei');
/** Same four digits, different family — the coincidence family.ts throws out. */
const MAYA = student('s-maya', 'Maya', 'Chen');

const ROSTER = [AMARA, MARCUS, MAYA];

const LAST4: Record<string, string[]> = {
  // The Osei household answers to two numbers; Maya's family only shares one.
  '0134': ['s-amara', 's-marcus', 's-maya'],
  '7788': ['s-amara', 's-marcus'],
  '2200': ['s-maya'],
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
    labelTemplate: null,
    boundAtMs: now,
    ...overrides,
  };
}

/** Who the register says is already here. Reassigned per test. */
let present = new Set<string>();
let checkedOut = new Set<string>();
/** Which arrival put each of them here, where the register knows. */
let arrivals = new Map<string, string>();
/**
 * What the nightly aggregate says about this gathering. Empty by default, which
 * every reader takes as "nothing to scope by" — the behaviour the kiosk had
 * before it existed, and what most of these tests are about.
 */
let scope = { participated: new Set<string>(), recent: new Set<string>() };

const services = {
  restoredSession: vi.fn(async () => ({ uid: 'kiosk_kiosk-test-device', reason: null })),
  reportStanding: vi.fn(async () => 'live' as const),
  unpair: vi.fn(async () => {}),
  loadRoster: vi.fn(async () => ROSTER),
  loadPhoneIndex: vi.fn(async () => LAST4),
  loadParticipation: vi.fn(async () => scope),
  fetchPulse: vi.fn(async () => null),
  rememberPulse: vi.fn(),
  refetchRoster: vi.fn(async () => {}),
  refetchPhoneIndex: vi.fn(async () => {}),
  refetchParticipation: vi.fn(async () => {}),
  fetchAttendance: vi.fn(async () => ({ present, checkedOut, arrivals })),
  replayQueue: vi.fn(async () => 0),
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

/** Boot the kiosk straight into a bound, ready screen. */
async function mount(bound: KioskBinding = binding()): Promise<void> {
  localStorage.setItem(KIOSK_KEYS.binding, JSON.stringify(bound));
  localStorage.setItem(KIOSK_KEYS.roster, JSON.stringify({ fetchedAtMs: Date.now(), students: ROSTER }));
  localStorage.setItem(
    KIOSK_KEYS.phoneIndex,
    JSON.stringify({ fetchedAtMs: Date.now(), builtAtMs: Date.now(), last4: LAST4 }),
  );
  render(<KioskApp />);
  await settle();
}

/** Types on the kiosk's own keyboard — pointer contact, on the key itself. */
async function type(text: string): Promise<void> {
  for (const key of text.toUpperCase()) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByText(key, { selector: '[data-key]' }));
    });
  }
  await settle();
}

/** A row commits on lift, because the results list scrolls. */
async function pick(name: string): Promise<void> {
  const row = screen.getByText(name).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
}

/** A ticked sibling, which unticks the same way. */
async function toggle(name: string): Promise<void> {
  const row = screen.getByText(name).closest('button')!;
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
  });
  await settle();
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

function checkedInIds(): string[] {
  return vi
    .mocked(services.performCheckIn)
    .mock.calls.map((call) => call[0].student.id)
    .sort();
}

function checkOutCalls(): string[] {
  return vi
    .mocked(services.performCheckOut)
    .mock.calls.map((call) => call[0].studentId)
    .sort();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  localStorage.clear();
  present = new Set();
  checkedOut = new Set();
  arrivals = new Map();
  scope = { participated: new Set(), recent: new Set() };
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('checking a family in together', () => {
  it('offers the sibling unticked, and takes both once the parent says so', async () => {
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.getByText(/anyone else\?/i)).toBeTruthy();
    expect(screen.getByText('Amara Osei')).toBeTruthy();
    // The offer is exactly as wide as it ever was; only the tick went. And the
    // button counts who is going, so a number on it is the screen saying there
    // are other names here that are not.
    expect(screen.getByText(/check in 1/i)).toBeTruthy();

    await toggle('Amara Osei');
    await tap(/check in 2/i);

    expect(checkedInIds()).toEqual(['s-amara', 's-marcus']);
    // One tick, both names on it.
    expect(screen.getByText('Marcus and Amara')).toBeTruthy();
  });

  it('does not offer a family that merely shares four digits', async () => {
    // Maya turns up in the same phone search, and is nobody's sibling.
    await mount();
    await type('0134');
    await pick('Maya Chen');

    // The question is asked on every check-in now — what must not appear is a
    // sibling row for somebody who merely shares a tail.
    expect(screen.queryByText('Amara Osei')).toBeNull();
    expect(screen.queryByText('Marcus Osei')).toBeNull();
    await tap('Check in');

    expect(checkedInIds()).toEqual(['s-maya']);
  });

  it('leaves the sibling nobody ticked', async () => {
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    // Nothing to untick: the sibling arrives unticked, which is the change.
    // The button says what it will do, and the count says somebody is staying.
    await tap(/check in 1/i);

    expect(checkedInIds()).toEqual(['s-marcus']);
  });

  it('only offers siblings the button would do the same thing to', async () => {
    // Amara is already here; Marcus is not. Checking Marcus in must not offer
    // to do anything at all to his sister.
    present = new Set([AMARA.id]);
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    // Amara is offered as no kind of row: a confirm only ever lists people the
    // button would do the very same thing to.
    expect(screen.queryByText('Amara Osei')).toBeNull();
    await tap('Check in');

    expect(checkedInIds()).toEqual(['s-marcus']);
    expect(services.performCheckOut).not.toHaveBeenCalled();
  });

  it('offers nothing beside a child who is already checked in', async () => {
    present = new Set([MARCUS.id]);
    await mount(binding({ requiresCheckOut: false }));
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.getByText(/already checked in/i)).toBeTruthy();
    expect(screen.queryByText(/anyone else/i)).toBeNull();
  });
});

describe('checking a family out together', () => {
  /*
   * The pickup was a two-second hold, and a test here pinned that a tap alone
   * did nothing. It is one tap now — see the note at the top of ConfirmScreen
   * for what that traded away and why — so what is left to pin is the half that
   * never depended on the gesture: one press, both children, and nothing
   * checked *in* on a screen that hands them back.
   */
  it('checks both out on one press', async () => {
    present = new Set([MARCUS.id, AMARA.id]);
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.getByText(/Checking out anyone else/i)).toBeTruthy();

    await tap(/check out 2/i);

    expect(
      vi
        .mocked(services.performCheckOut)
        .mock.calls.map((call) => call[0].studentId)
        .sort(),
    ).toEqual(['s-amara', 's-marcus']);
    expect(services.performCheckIn).not.toHaveBeenCalled();
  });

  it('does not offer a sibling who has already been checked out', async () => {
    present = new Set([MARCUS.id, AMARA.id]);
    checkedOut = new Set([AMARA.id]);
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.queryByText(/anyone else/i)).toBeNull();
    await tap(/check out/i);

    expect(vi.mocked(services.performCheckOut).mock.calls.map((call) => call[0].studentId)).toEqual([
      's-marcus',
    ]);
  });
});

/**
 * The register's own answer to "who is going home with them".
 *
 * A check-in guesses at a family from four phone digits, because at the front
 * door that is all there is. By the time somebody comes back for them there is
 * something better: the set that walked in together, stated by a thumb on this
 * kiosk's own button and written on the register. These pin that the pickup
 * screen prefers the fact to the guess, and — the part that matters most —
 * that it still *shows* the guess, because a family that arrived in two waves
 * usually leaves in one.
 */
describe('checking out the ones who came in together', () => {
  it('ticks the arrival, and lists a sibling who came separately without ticking them', async () => {
    present = new Set([AMARA.id, MARCUS.id]);
    arrivals = new Map([
      [AMARA.id, 'arrival-morning'],
      // Dropped off half an hour later, by somebody else. Same family, and the
      // register knows they were not part of the same act.
      [MARCUS.id, 'arrival-later'],
    ]);
    await mount();
    await type('0134');
    await pick('Amara Osei');

    // On the screen, because families do leave together after arriving apart.
    expect(screen.getByText('Marcus Osei')).toBeTruthy();
    // Not ticked, and the button counts only the one nobody has to think about.
    expect(screen.getByText('Marcus Osei').closest('button')!.getAttribute('aria-pressed')).toBe(
      'false',
    );

    await tap(/check out 1/i);
    expect(checkOutCalls()).toEqual(['s-amara']);
  });

  it('ticks a child the phone index never called family, when they arrived together', async () => {
    /*
     * The half of this the four-digit guess can never do. Maya is a different
     * family by every number on file — `family.ts` refuses her on purpose — but
     * she came through the door in the same press, so she is going home in it.
     * A cousin, a neighbour's boy, a child found through "find a brother or
     * sister": all of them look exactly like this.
     */
    present = new Set([AMARA.id, MAYA.id]);
    arrivals = new Map([
      [AMARA.id, 'arrival-together'],
      [MAYA.id, 'arrival-together'],
    ]);
    await mount();
    await type('0134');
    await pick('Amara Osei');

    expect(screen.getByText('Maya Chen').closest('button')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    await tap(/check out 2/i);
    expect(checkOutCalls()).toEqual(['s-amara', 's-maya']);
  });

  it('falls back to the guess when nothing was ever stated', async () => {
    // A volunteer checked them in from the roster, one at a time; or the
    // records predate arrivals. "No claim" is not "came alone", so the screen
    // does exactly what it did before this existed.
    present = new Set([AMARA.id, MARCUS.id]);
    arrivals = new Map();
    await mount();
    await type('0134');
    await pick('Amara Osei');

    expect(screen.getByText('Marcus Osei').closest('button')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    await tap(/check out 2/i);
    expect(checkOutCalls()).toEqual(['s-amara', 's-marcus']);
  });

  it('records one arrival per press, shared by everyone it checked in', async () => {
    await mount();
    await type('7788');
    await pick('Amara Osei');
    await toggle('Marcus Osei');
    await tap(/check in 2/i);

    const ids = vi.mocked(services.performCheckIn).mock.calls.map((call) => call[0].arrivalId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(1);
  });

  it('gives a child checked in alone an arrival of their own', async () => {
    /*
     * Not "no arrival". A solo check-in is a statement, and it is what stops a
     * sibling dropped off later from arriving pre-ticked for check-out —
     * which is the whole difference between this and a null.
     */
    await mount();
    await type('2200');
    await pick('Maya Chen');
    await tap(/^check in$/i);

    const first = vi.mocked(services.performCheckIn).mock.calls[0]![0].arrivalId;
    expect(first).toBeTruthy();
  });
});

/**
 * The escape hatch the conservative guess creates.
 *
 * `family.ts` throws out every coincidence and, with it, some real siblings: a
 * child on a different number, a family split across two households, somebody
 * added by hand last week. Those parents are looking at one name and know there
 * should be two — and the answer used to be a link that took them to a form
 * asking a *new* child's name, which is not what they meant.
 */
describe('finding a brother or sister the kiosk did not offer', () => {
  it('is offered on a check-in', async () => {
    await mount();
    await type('2200');
    await pick('Maya Chen');
    expect(screen.getByText(/Another child/i)).toBeTruthy();
  });

  it('is never offered on a check-out', async () => {
    // A parent taking a child home is answering a different question, and the
    // roster is read once at boot — so this is a kiosk that started the morning
    // with Maya already here.
    present = new Set([MAYA.id]);
    await mount();
    await type('2200');
    await pick('Maya Chen');

    expect(screen.getByText(/check out/i)).toBeTruthy();
    expect(screen.queryByText(/Another child/i)).toBeNull();
  });

  it('checks in a sibling found by name, together with the first', async () => {
    await mount();
    // Maya's four digits find only Maya; Amara is a sibling this kiosk's
    // family guess would never have offered.
    await type('2200');
    await pick('Maya Chen');
    await tap(/Another child/i);

    await type('amara');
    await pick('Amara Osei');

    // Back on the confirm, with both — one group, one button, one count.
    expect(screen.getByText(/Check in 2/i)).toBeTruthy();
    await tap(/Check in 2/i);

    expect(
      vi
        .mocked(services.performCheckIn)
        .mock.calls.map((call) => call[0].student.id)
        .sort(),
    ).toEqual(['s-amara', 's-maya']);
  });

  it('does not offer somebody already on the confirm screen', async () => {
    await mount();
    await type('7788');
    await pick('Amara Osei');
    await tap(/Another child/i);

    // Marcus arrived with Amara and is ticked behind this screen; offering him
    // again would be a row that does nothing.
    await type('osei');
    expect(screen.queryByText('Marcus Osei')).toBeNull();
    expect(screen.queryByText('Amara Osei')).toBeNull();
  });

  it('leaves the confirm exactly as it was when the search finds nobody', async () => {
    await mount();
    await type('7788');
    await pick('Amara Osei');
    await toggle('Marcus Osei');
    await tap(/Another child/i);

    await type('zzq');
    expect(screen.getByText(/are they new/i)).toBeTruthy();
    await tap('← Back');

    // Marcus is still ticked: going to look for somebody must not silently
    // undo the decision this parent made with their thumb.
    expect(screen.getByText(/check in 2/i)).toBeTruthy();
  });
});

/**
 * Which of the offered names arrive ticked, which is now none of them.
 *
 * `familyOf` guesses a family from four phone digits, and the tick used to
 * follow the gathering's own "Recent" prediction over that guess. Both halves
 * turned out to be built on sand. The roster carries parents mis-filed as
 * children by the church's previous check-in kiosk, imported with years of
 * attendance, so an adult clears "two of the last three" better than a child
 * who joined in September — and the prediction *failed open*, ticking the whole
 * household whenever a chain had no history, a read failed, or a tablet was
 * cold.
 *
 * So the offer stays exactly as wide as the guess, and nothing arrives ticked
 * but the child a parent actually pressed. What carries the weight instead is
 * the commit button, which counts who is going.
 */
describe('saying which room this kiosk checks into', () => {
  it('names the room under the child, in place of their grade', async () => {
    await mount(binding({ location: 'Room 104' }));
    await type('0134');
    await pick('Marcus Osei');

    /*
     * The room replaces the grade rather than standing beside it. A parent told
     * Room 104 does not need the classification the room was derived from, and
     * the head is where the room's height has to come from: at the seven-name
     * cap the alternative was taking it out of the child's own air.
     */
    expect(screen.getByText('Room 104')).toBeTruthy();
    expect(screen.queryByText(/grade/i)).toBeNull();
  });

  it('keeps the grade on a gathering that names no room', async () => {
    await mount();
    await type('0134');
    await pick('Marcus Osei');

    expect(screen.queryByText('Room 104')).toBeNull();
    expect(screen.getByText(/grade/i)).toBeTruthy();
  });

  it('says it again on the way out, where a sticker is the only other copy', async () => {
    await mount(binding({ location: 'Room 104' }));
    await type('0134');
    await pick('Marcus Osei');
    await tap(/check in 1/i);

    // The success screen lasts four seconds; the sticker lasts the morning.
    expect(screen.getByText('Room 104')).toBeTruthy();
  });
});

describe('offering a family without ticking any of them', () => {
  it('leaves a sibling the prediction expects unticked, like every other', async () => {
    scope = {
      participated: new Set(['s-amara', 's-marcus', 's-maya']),
      // Marcus comes every week — and it no longer buys him a tick, because
      // this is exactly the signal a mis-filed adult scores best on.
      recent: new Set(['s-amara', 's-marcus']),
    };
    await mount();
    await type('7788');
    await pick('Amara Osei');

    // Marcus is on the screen — the parent may well have brought him.
    expect(screen.getByText('Marcus Osei')).toBeTruthy();
    expect(screen.getByText('Marcus Osei').closest('button')!.getAttribute('aria-pressed')).toBe(
      'false',
    );

    await tap(/Check in 1/i);
    expect(checkedInIds()).toEqual(['s-amara']);
  });

  it('includes an unexpected sibling the parent ticks', async () => {
    scope = {
      participated: new Set(['s-amara', 's-marcus']),
      recent: new Set(['s-amara']),
    };
    await mount();
    await type('7788');
    await pick('Amara Osei');

    // The same tap that unticks a ticked row ticks an unticked one.
    await toggle('Marcus Osei');
    await tap(/Check in 2/i);

    expect(checkedInIds()).toEqual(['s-amara', 's-marcus']);
  });

  it('always includes the child who was tapped, prediction or not', async () => {
    scope = {
      participated: new Set(['s-amara', 's-marcus', 's-maya']),
      // The gathering has regulars, and neither Osei child is one of them.
      recent: new Set(['s-maya']),
    };
    await mount();
    await type('7788');
    await pick('Marcus Osei');

    // Amara is offered and unticked; Marcus is on the register regardless,
    // because a parent pressing a name is not a prediction to be second-guessed.
    expect(screen.getByText('Amara Osei')).toBeTruthy();
    await tap(/Check in 1/i);
    expect(checkedInIds()).toEqual(['s-marcus']);
  });

  it('ticks nobody when the gathering has no prediction to offer', async () => {
    /*
     * The case the old rule failed open on, and the strongest argument for the
     * change: a gathering meeting for the first time, a binding written before
     * any of this existed, a failed read, a restricted chain the participation
     * index leaves out entirely. All of them used to tick the whole household
     * — on exactly the mornings with the least evidence behind them.
     */
    await mount();
    await type('7788');
    await pick('Amara Osei');

    expect(screen.getByText('Marcus Osei').closest('button')!.getAttribute('aria-pressed')).toBe(
      'false',
    );
    await tap(/Check in 1/i);
    expect(checkedInIds()).toEqual(['s-amara']);
  });

  it('ticks a sibling found by name, whatever the prediction thinks', async () => {
    scope = { participated: new Set(['s-maya']), recent: new Set(['s-maya']) };
    await mount();
    await type('2200');
    await pick('Maya Chen');
    await tap(/Another child/i);

    // Amara is in no part of this gathering's history. The parent named her.
    await type('amara');
    await pick('Amara Osei');

    await tap(/Check in 2/i);
    expect(checkedInIds()).toEqual(['s-amara', 's-maya']);
  });

  it('does not warm a label for a sibling arriving unticked', async () => {
    scope = {
      participated: new Set(['s-amara', 's-marcus']),
      recent: new Set(['s-amara']),
    };
    await mount();
    await type('7788');
    await pick('Amara Osei');

    const warmed = vi.mocked(services.warmStudentDates).mock.calls.map((call) => call[0]);
    expect(warmed).toContain('s-amara');
    expect(warmed).not.toContain('s-marcus');

    // Until the parent says otherwise, at which point it is worth preparing.
    await toggle('Marcus Osei');
    expect(
      vi.mocked(services.warmStudentDates).mock.calls.map((call) => call[0]),
    ).toContain('s-marcus');
  });

  it('leaves a pickup reading the register, not the prediction', async () => {
    // Both Osei children came in together an hour ago; neither is a regular.
    present = new Set(['s-amara', 's-marcus']);
    arrivals = new Map([
      ['s-amara', 'arrival-1'],
      ['s-marcus', 'arrival-1'],
    ]);
    scope = { participated: new Set(['s-amara', 's-marcus']), recent: new Set() };

    await mount(binding({ requiresCheckOut: true }));
    await type('7788');
    await pick('Amara Osei');

    await tap(/check out 2/i);
    expect(checkOutCalls()).toEqual(['s-amara', 's-marcus']);
  });
});
