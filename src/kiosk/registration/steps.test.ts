/**
 * The wizard's rules, without rendering anything.
 *
 * What is worth pinning here is not that the steps happen in order — that is
 * one switch statement — but the three judgements a family actually feels: what
 * the keyboard will and will not accept into a name, where the surnames come
 * from, and that the loop banks a child before it asks about the next one.
 */
import { describe, expect, it } from 'vitest';
import type { Grade } from '@/types';
import type { ShiftState } from '../components/Keyboard';
import {
  advance,
  answerAnother,
  applyKey,
  canAdvance,
  chooseGrade,
  defaultGrade,
  familyOf,
  formatPhone,
  goBack,
  initialState,
  MAX_CHILDREN,
  NAME_MAX_LENGTH,
  PHONE_LENGTH,
  toggleNoAllergies,
  type RegistrationState,
} from './steps';

function start(requiresCheckOut = false): RegistrationState {
  return initialState({ registrationId: 'r-1', requiresCheckOut });
}

function typeText(state: RegistrationState, text: string): RegistrationState {
  return [...text].reduce(
    (held, value) => applyKey(held, { kind: 'char', value }),
    state,
  );
}

/** One child, through their three questions, to the "anybody else" fork. */
function addChild(
  state: RegistrationState,
  firstName: string,
  lastName: string,
  grade: Grade | null,
): RegistrationState {
  let held = advance(typeText(state, firstName));
  // The last-name step opens prefilled; clear it before typing this child's.
  held = advance(typeText(applyKey(held, { kind: 'clear' }), lastName));
  return chooseGrade(held, grade);
}

describe('typing a name', () => {
  it('refuses digits, so a phone number cannot become a name', () => {
    const typed = typeText(start(), 'Ada7');
    expect(typed.buffer).toBe('Ada');
  });

  it('keeps the apostrophe and the hyphen', () => {
    // The whole reason those two keys were added to the kiosk keyboard: what is
    // typed here is written to the roster and printed on a sticker.
    expect(typeText(start(), "O'Brien").buffer).toBe("O'Brien");
    expect(typeText(start(), 'Anne-Marie').buffer).toBe('Anne-Marie');
  });

  it('will not open with a space, and collapses the rest', () => {
    expect(typeText(start(), ' ').buffer).toBe('');
    expect(typeText(start(), 'Mary  Jane').buffer).toBe('Mary Jane');
  });

  it('will not advance on an empty answer', () => {
    expect(canAdvance(start())).toBe(false);
    expect(canAdvance(typeText(start(), 'Ada'))).toBe(true);
  });
});

/**
 * The shift key exists because no rule short of a dictionary gets McDonald,
 * O'Brien and van der Berg all right, and what is typed here goes on the roster,
 * into the church's database and onto a sticker a child wears. What is tested is
 * the state the keyboard is *told to draw* — the letters themselves are cased by
 * the keyboard, which shows what it will produce.
 */
describe('the shift key', () => {
  const shiftKey = { kind: 'shift' } as const;

  it('starts a name in capitals without anybody asking', () => {
    expect(start().shift).toBe('on');
  });

  it('spends itself on one letter, then stands down', () => {
    const typed = applyKey(start(), { kind: 'char', value: 'M' });
    expect(typed.shift).toBe('off');
  });

  it('comes back at every boundary a name has', () => {
    // A space, a hyphen and an apostrophe each start a new part of a name.
    for (const boundary of [' ', '-', "'"]) {
      const typed = typeText(start(), `Ann${boundary}`);
      expect(typed.shift).toBe('on');
    }
  });

  it('cycles off → on → lock → off, the way every phone does', () => {
    let held = applyKey(start(), { kind: 'char', value: 'M' });
    expect(held.shift).toBe('off');

    const seen: ShiftState[] = [];
    for (let i = 0; i < 3; i += 1) {
      held = applyKey(held, shiftKey);
      seen.push(held.shift);
    }
    expect(seen).toEqual(['on', 'lock', 'off']);
  });

  it('holds through a whole word once locked', () => {
    let held = applyKey(start(), { kind: 'char', value: 'V' });
    held = applyKey(held, shiftKey); // on
    held = applyKey(held, shiftKey); // lock
    held = typeText(held, 'AN');
    expect(held.shift).toBe('lock');
  });

  it('follows the buffer backwards, so a correction is capitalised again', () => {
    const typed = typeText(start(), 'Ann ');
    expect(typed.shift).toBe('on');
    // Deleting the space puts the caret back inside a word.
    expect(applyKey(typed, { kind: 'backspace' }).shift).toBe('off');
  });

  it('opens a prefilled field with shift down, and an empty one with it up', () => {
    // The surname carried forward from the last child is already written; the
    // next keystroke belongs mid-word, not at the start of one.
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, true, false);
    expect(held.shift).toBe('on');
    held = advance(typeText(held, 'Byron'));
    expect(held.buffer).toBe('Lovelace');
    expect(held.shift).toBe('off');
  });
});

describe('typing a phone number', () => {
  function atPhone(): RegistrationState {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, false, false);
    held = advance(typeText(held, 'Anne'));
    return advance(typeText(applyKey(held, { kind: 'clear' }), 'Lovelace'));
  }

  it('takes digits only and stops at ten', () => {
    const typed = typeText(atPhone(), '555a010-33449');
    expect(typed.buffer).toBe('5550103344');
    expect(typed.buffer.length).toBe(PHONE_LENGTH);
  });

  it('will not advance on a partial number', () => {
    expect(canAdvance(typeText(atPhone(), '555010'))).toBe(false);
    expect(canAdvance(typeText(atPhone(), '5550103344'))).toBe(true);
  });

  it('reads back as a phone number rather than ten digits', () => {
    expect(formatPhone('5550103344')).toBe('555-010-3344');
    expect(formatPhone('55501')).toBe('555-01');
  });
});

describe('the surnames', () => {
  it("opens the second child's last name on the first child's", () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, true, false);
    held = advance(typeText(held, 'Byron'));

    expect(held.step).toBe('child-last');
    expect(held.buffer).toBe('Lovelace');
  });

  it("opens the parent's last name on the family's", () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, false, false);
    held = advance(typeText(held, 'Anne'));

    expect(held.step).toBe('guardian-last');
    expect(held.buffer).toBe('Lovelace');
    /*
     * And the keyboard opens lower-case on it, because the next press is a
     * correction to an existing word rather than the start of a new one. Shift
     * has to be decided from the same string the buffer was — a prefill offered
     * in caps is one a parent has to un-capitalise before they can fix it.
     */
    expect(held.shift).toBe('off');
  });
});

describe('the loop', () => {
  it('answers the fork only while the fork is on screen', () => {
    /*
     * Every one of these is a button on some other screen, and the wizard is
     * one shared state machine — a stray press mid-typing must be a press that
     * did nothing, not one that banks a half-typed child or jumps a question.
     */
    const typing = typeText(start(), 'Ada');

    expect(answerAnother(typing, true, false)).toBe(typing);
    expect(chooseGrade(typing, 4 as Grade)).toBe(typing);
    // And the draft is not part of the family until the fork is reached: a
    // confirm list drawn mid-question would show a child nobody finished.
    expect(familyOf(typing)).toEqual([]);
  });

  it('advances nothing while the answer is not one', () => {
    // Every step that reads a buffer refuses an empty one. `advance` is what
    // the Next key calls, and the key is drawn disabled — but the rule lives
    // here, because a hardware keyboard's Enter reaches the same function.
    const empty = start();
    expect(canAdvance(empty)).toBe(false);
    expect(advance(empty)).toBe(empty);
  });

  it('banks the child on the fork, whichever way it is answered', () => {
    const forked = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    expect(forked.step).toBe('another');
    // Not banked yet — but shown, because the confirm list a parent is about to
    // see has to include the child they just typed.
    expect(forked.children).toHaveLength(0);
    expect(familyOf(forked)).toHaveLength(1);

    expect(answerAnother(forked, true, false).children).toHaveLength(1);
    expect(answerAnother(forked, false, false).children).toHaveLength(1);
  });

  it('starts the next child clean, on the same gathering default', () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, true, false);

    expect(held.step).toBe('child-first');
    expect(held.buffer).toBe('');
    expect(held.draft.firstName).toBe('');
    expect(held.draft.grade).toBe(9);
  });

  it('collects a whole family in one run', () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, true, false);
    held = addChild(held, 'Byron', 'Lovelace', 1 as Grade);
    held = answerAnother(held, false, false);

    expect(held.children).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', grade: 4, allergies: '' },
      { firstName: 'Byron', lastName: 'Lovelace', grade: 1, allergies: '' },
    ]);
  });
});

/**
 * Every transition, asserted whole.
 *
 * The rest of this file checks the judgements a family feels. This block exists
 * because the state object is what the screen renders from, and a transition
 * that gets the step right and leaves the buffer holding the previous
 * question's answer is a wizard that opens the next question pre-filled with
 * the wrong thing — which no assertion on `step` alone would notice.
 */
describe('the whole state, at each transition', () => {
  const BASE: RegistrationState = {
    mode: 'family',
    step: 'child-first',
    registrationId: 'r-1',
    allergiesSupported: false,
    noAllergies: false,
    children: [],
    draft: { firstName: '', lastName: '', grade: 9 as Grade, allergies: '' },
    guardian: { firstName: '', lastName: '', phone: '' },
    buffer: '',
    shift: 'on',
    last4: '',
    message: '',
  };

  it('opens on the first question with everything else empty', () => {
    expect(initialState({ registrationId: 'r-1', requiresCheckOut: false })).toEqual(BASE);
  });

  it('opens a gathering that hands children back on no grade', () => {
    expect(initialState({ registrationId: 'r-1', requiresCheckOut: true })).toEqual({
      ...BASE,
      draft: { ...BASE.draft, grade: null },
    });
  });

  it('takes the mode and the allergy gate from the binding', () => {
    expect(
      initialState({
        registrationId: 'r-2',
        requiresCheckOut: false,
        mode: 'sibling',
        allergiesSupported: true,
      }),
    ).toEqual({ ...BASE, registrationId: 'r-2', mode: 'sibling', allergiesSupported: true });
  });

  it('reads anything but a literal true as "no allergy question"', () => {
    // The binding is server-written and this is the gate on asking a family
    // about medicine at a lobby screen; anything short of yes is no.
    for (const value of [undefined, null, 0, '', 'yes']) {
      const state = initialState({
        registrationId: 'r-1',
        requiresCheckOut: false,
        allergiesSupported: value as unknown as boolean,
      });
      expect(state.allergiesSupported).toBe(false);
    }
  });

  it('banks the first name and opens the second question', () => {
    expect(advance(typeText(start(), 'Ada'))).toEqual({
      ...BASE,
      draft: { ...BASE.draft, firstName: 'Ada' },
      step: 'child-last',
      buffer: '',
      shift: 'on',
    });
  });

  it('banks the last name and opens the grade chips with an empty box', () => {
    const named = advance(typeText(advance(typeText(start(), 'Ada')), 'Lovelace'));

    expect(named).toEqual({
      ...BASE,
      draft: { ...BASE.draft, firstName: 'Ada', lastName: 'Lovelace' },
      step: 'child-grade',
      buffer: '',
      shift: 'on',
    });
  });

  it('goes from the grade straight to the fork when allergies are not asked', () => {
    const graded = chooseGrade(
      advance(typeText(advance(typeText(start(), 'Ada')), 'Lovelace')),
      11 as Grade,
    );

    expect(graded).toEqual({
      ...BASE,
      draft: { firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: '' },
      step: 'another',
      buffer: '',
      shift: 'on',
      noAllergies: false,
    });
  });

  it('banks the note and unticks the box on the way to the fork', () => {
    const withAllergies = initialState({
      registrationId: 'r-1',
      requiresCheckOut: false,
      allergiesSupported: true,
    });
    const asked = chooseGrade(
      advance(typeText(advance(typeText(withAllergies, 'Ada')), 'Lovelace')),
      11 as Grade,
    );
    expect(asked.step).toBe('child-allergies');

    expect(advance(typeText(asked, 'Peanuts'))).toEqual({
      ...BASE,
      allergiesSupported: true,
      draft: { firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: 'Peanuts' },
      step: 'another',
      buffer: '',
      shift: 'on',
      noAllergies: false,
    });
  });

  it('banks the adult and closes on confirm', () => {
    const atPhone: RegistrationState = {
      ...BASE,
      step: 'guardian-phone',
      guardian: { firstName: 'Dana', lastName: 'Rivera', phone: '' },
      buffer: '5550103344',
      shift: 'off',
    };

    expect(advance(atPhone)).toEqual({
      ...atPhone,
      guardian: { firstName: 'Dana', lastName: 'Rivera', phone: '5550103344' },
      step: 'confirm',
      buffer: '',
      shift: 'on',
    });
  });

  it("opens the adult's surname prefilled, and the phone with shift down", () => {
    const atGuardianFirst: RegistrationState = { ...BASE, step: 'guardian-first' };
    const named = advance(typeText(atGuardianFirst, 'Dana'));

    expect(named).toEqual({
      ...BASE,
      step: 'guardian-last',
      guardian: { firstName: 'Dana', lastName: '', phone: '' },
      buffer: '',
      shift: 'on',
    });

    expect(advance(typeText(named, 'Rivera'))).toEqual({
      ...BASE,
      step: 'guardian-phone',
      guardian: { firstName: 'Dana', lastName: 'Rivera', phone: '' },
      buffer: '',
      // A number pad has no capitals to offer.
      shift: 'off',
    });
  });

  it('reopens the adult\'s number rather than making them type it twice', () => {
    const atPhone: RegistrationState = {
      ...BASE,
      step: 'guardian-phone',
      guardian: { firstName: 'Dana', lastName: 'Rivera', phone: '5550103344' },
      buffer: '5550103344',
      shift: 'off',
    };
    const confirmed = advance(atPhone);

    expect(goBack(confirmed)).toEqual({ ...confirmed, step: 'guardian-phone', buffer: '5550103344', shift: 'off' });
  });

  it('starts the next child on a clean draft', () => {
    const banked = chooseGrade(
      advance(typeText(advance(typeText(start(), 'Ada')), 'Lovelace')),
      11 as Grade,
    );

    expect(answerAnother(banked, true, false)).toEqual({
      ...BASE,
      children: [{ firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: '' }],
      draft: { firstName: '', lastName: '', grade: 9 as Grade, allergies: '' },
      step: 'child-first',
      buffer: '',
      shift: 'on',
    });
  });

  it('goes on to the adult when the family is done', () => {
    const banked = chooseGrade(
      advance(typeText(advance(typeText(start(), 'Ada')), 'Lovelace')),
      11 as Grade,
    );

    expect(answerAnother(banked, false, false)).toEqual({
      ...BASE,
      children: [{ firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: '' }],
      draft: { firstName: '', lastName: '', grade: 9 as Grade, allergies: '' },
      step: 'guardian-first',
      buffer: '',
      shift: 'on',
    });
  });

  it('carries the gathering default onto the next child too', () => {
    const banked = chooseGrade(
      advance(typeText(advance(typeText(start(true), 'Ada')), 'Lovelace')),
      11 as Grade,
    );

    expect(answerAnother(banked, true, true).draft.grade).toBeNull();
  });

  it('stops looping once the family is as large as the kiosk will take', () => {
    let held = start();
    for (let index = 0; index < MAX_CHILDREN - 1; index += 1) {
      held = answerAnother(addChild(held, `Child${index}`, 'Osei', 9 as Grade), true, false);
      expect(held.step).toBe('child-first');
    }

    // The sixth is banked and the loop closes rather than offering a seventh.
    const full = answerAnother(addChild(held, 'Child5', 'Osei', 9 as Grade), true, false);
    expect(full.children).toHaveLength(MAX_CHILDREN);
    expect(full.step).toBe('guardian-first');
  });

  it('clears the error message on the way back to confirm', () => {
    const failed: RegistrationState = {
      ...BASE,
      step: 'error',
      message: 'Planning Center is having a minute',
    };

    expect(goBack(failed)).toEqual({ ...BASE, step: 'confirm', buffer: '', shift: 'on', message: '' });
  });

  it('reopens the grade chips from the allergy question with an empty box', () => {
    const atAllergies: RegistrationState = {
      ...BASE,
      allergiesSupported: true,
      step: 'child-allergies',
      buffer: 'Peanuts',
      noAllergies: true,
    };

    expect(goBack(atAllergies)).toEqual({ ...atAllergies, step: 'child-grade', buffer: '', shift: 'on' });
  });

  it('reopens each earlier question with its own answer', () => {
    const draft = { firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: 'Peanuts' };
    const guardian = { firstName: 'Dana', lastName: 'Rivera', phone: '5550103344' };
    const held: RegistrationState = { ...BASE, draft, guardian };

    expect(goBack({ ...held, step: 'child-last' })).toMatchObject({
      step: 'child-first',
      buffer: 'Ada',
      shift: 'off',
    });
    expect(goBack({ ...held, step: 'child-grade' })).toMatchObject({
      step: 'child-last',
      buffer: 'Lovelace',
      shift: 'off',
    });
    expect(goBack({ ...held, step: 'guardian-first' })).toMatchObject({
      step: 'another',
      buffer: '',
      shift: 'on',
    });
    expect(goBack({ ...held, step: 'guardian-last' })).toMatchObject({
      step: 'guardian-first',
      buffer: 'Dana',
      shift: 'off',
    });
    expect(goBack({ ...held, step: 'guardian-phone' })).toMatchObject({
      step: 'guardian-last',
      buffer: 'Rivera',
      shift: 'off',
    });
  });

  it('reopens the allergy note unticked, from the fork', () => {
    const draft = { firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: 'Peanuts' };
    const atFork: RegistrationState = {
      ...BASE,
      allergiesSupported: true,
      step: 'another',
      draft,
      noAllergies: true,
    };

    expect(goBack(atFork)).toEqual({
      ...atFork,
      step: 'child-allergies',
      buffer: 'Peanuts',
      shift: 'off',
      noAllergies: false,
    });
  });

  it('has nowhere to go back to from a step with no question behind it', () => {
    for (const step of ['submitting', 'success'] as const) {
      expect(goBack({ ...BASE, step })).toBeNull();
    }
  });
});

describe('the keys that are not letters', () => {
  it('empties the box and puts shift back up', () => {
    const typed = typeText(start(), 'Adaa');

    expect(applyKey(typed, { kind: 'clear' })).toMatchObject({ buffer: '', shift: 'on' });
  });

  it('takes one character off the end, not off the front', () => {
    const typed = typeText(start(), 'Ada');

    expect(applyKey(typed, { kind: 'backspace' }).buffer).toBe('Ad');
  });

  it('does nothing to an empty box', () => {
    expect(applyKey(start(), { kind: 'backspace' }).buffer).toBe('');
  });

  it('puts shift back up when a backspace lands on a word boundary', () => {
    const typed = typeText(start(), 'Anne-M');
    expect(typed.shift).toBe('off');

    expect(applyKey(typed, { kind: 'backspace' }).shift).toBe('on');
  });

  it('leaves a locked shift locked through a backspace', () => {
    let held = applyKey(typeText(start(), 'AD'), { kind: 'shift' });
    held = applyKey(held, { kind: 'shift' });
    expect(held.shift).toBe('lock');

    expect(applyKey(held, { kind: 'backspace' }).shift).toBe('lock');
  });

  it('is inert on a step with no keyboard', () => {
    const atGrade = advance(typeText(advance(typeText(start(), 'Ada')), 'Lovelace'));
    expect(atGrade.step).toBe('child-grade');

    for (const key of [
      { kind: 'char', value: 'x' },
      { kind: 'backspace' },
      { kind: 'clear' },
      { kind: 'shift' },
    ] as const) {
      expect(applyKey(atGrade, key)).toBe(atGrade);
    }
  });
});

describe('the boundaries of a typed answer', () => {
  it('takes a name of exactly the length it allows, and no more', () => {
    const exact = 'A'.repeat(NAME_MAX_LENGTH);

    expect(typeText(start(), exact).buffer).toBe(exact);
    expect(typeText(start(), `${exact}B`).buffer).toBe(exact);
  });

  it('capitalises after every boundary a name has, and nowhere else', () => {
    // The boundaries a name actually has: its start, and after a space, a
    // hyphen or an apostrophe — which is what makes Anne-Marie and O'Brien come
    // out right without anybody reaching for shift.
    expect(typeText(start(), 'Anne').shift).toBe('off');
    expect(typeText(start(), 'Anne-').shift).toBe('on');
    expect(typeText(start(), 'Anne-Marie').shift).toBe('off');
    expect(typeText(start(), "O'").shift).toBe('on');
    expect(typeText(start(), 'van ').shift).toBe('on');
    expect(typeText(start(), 'van der').shift).toBe('off');
  });

  it('trims the trailing space off an answer as it is banked', () => {
    const trailing = applyKey(typeText(start(), 'Ada'), { kind: 'char', value: ' ' });
    expect(trailing.buffer).toBe('Ada ');

    expect(advance(trailing).draft.firstName).toBe('Ada');
  });

  it('takes one digit per press and nothing composite', () => {
    const atPhone: RegistrationState = { ...start(), step: 'guardian-phone' };

    // A press is a digit: `^\d$` and not `\d`, so nothing arrives carrying a
    // digit alongside something else.
    expect(applyKey(atPhone, { kind: 'char', value: '5' }).buffer).toBe('5');
    expect(applyKey(atPhone, { kind: 'char', value: 'a5' }).buffer).toBe('');
    expect(applyKey(atPhone, { kind: 'char', value: '5a' }).buffer).toBe('');
  });
});

describe('the grade question', () => {
  it('opens on the middle of the band, and on none where children are collected', () => {
    expect(defaultGrade(false)).toBe(9);
    // A nursery child has no grade to type, and "No grade" is the answer rather
    // than a field somebody has to clear forty times a morning.
    expect(defaultGrade(true)).toBeNull();
  });

  it('takes "no grade" as an answer and moves on', () => {
    const held = addChild(start(true), 'Robin', 'Fields', null);
    expect(held.step).toBe('another');
    expect(familyOf(held)[0]!.grade).toBeNull();
  });
});

describe('going back from the fork', () => {
  it('reopens the allergies question where the gathering asks one', () => {
    let held = initialState({ registrationId: 'r-1', requiresCheckOut: false, allergiesSupported: true });
    held = advance(typeText(held, 'Ada'));
    held = advance(typeText(applyKey(held, { kind: 'clear' }), 'Lovelace'));
    held = chooseGrade(held, 4 as Grade);
    held = advance(typeText(held, 'Peanuts'));

    expect(goBack(held)).toMatchObject({ step: 'child-allergies', buffer: 'Peanuts' });
  });

  it('steps over it entirely where the gathering does not', () => {
    // The wizard is exactly as short as it was before the question existed,
    // backwards as well as forwards — a step back that landed on a question
    // nobody was asked would be a screen with no way off it.
    const held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);

    expect(goBack(held)).toMatchObject({ step: 'child-grade', buffer: '', shift: 'on' });
  });

  it('sends a sibling run back to the fork rather than to the parent’s number', () => {
    /*
     * A sibling run has no adult half — the family is already registered, and
     * the parent's details came off the existing record. Backing out of the
     * confirm screen has to land on "anybody else", which is the only question
     * that run asked.
     */
    let held = initialState({ registrationId: 'r-1', requiresCheckOut: false, mode: 'sibling' });
    held = addChild(held, 'Byron', 'Lovelace', 1 as Grade);
    held = answerAnother(held, false, false);
    expect(held.step).toBe('confirm');

    expect(goBack(held)).toMatchObject({ step: 'another', buffer: '', shift: 'on' });
  });

  it('un-banks the child on the way, rather than seating a nameless one beside them', () => {
    /*
     * `answerAnother` commits the draft and blanks it, so a parent who pressed
     * "That's everyone" and then Back arrived at a fork whose list — `children`
     * plus the draft — carried a second, nameless child. Pressing on banked
     * that blank for real, and the callable refused the whole registration on
     * its name: the family met "We could not save that just now — please see a
     * leader" for having changed their mind once.
     */
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, false, false);
    expect(held.step).toBe('guardian-first');

    const back = goBack(held)!;

    expect(back.step).toBe('another');
    expect(familyOf(back)).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', grade: 4, allergies: '' },
    ]);
    // And the family that comes back off the fork is the one that went on to
    // it — banked once, not twice, and not one and a half.
    expect(answerAnother(back, false, false).children).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', grade: 4, allergies: '' },
    ]);
  });

  it('un-banks on the sibling path too, where the confirm is what the fork leads to', () => {
    let held = initialState({ registrationId: 'r-1', requiresCheckOut: false, mode: 'sibling' });
    held = addChild(held, 'Byron', 'Lovelace', 1 as Grade);
    held = answerAnother(held, false, false);

    const back = goBack(held)!;

    expect(back.children).toHaveLength(0);
    expect(familyOf(back)).toEqual([
      { firstName: 'Byron', lastName: 'Lovelace', grade: 1, allergies: '' },
    ]);
  });

  it('leaves the earlier children alone, and only the last one on the draft', () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, true, false);
    held = addChild(held, 'Byron', 'Lovelace', 1 as Grade);
    held = answerAnother(held, false, false);

    const back = goBack(held)!;

    expect(back.children).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', grade: 4, allergies: '' },
    ]);
    expect(back.draft).toEqual({
      firstName: 'Byron',
      lastName: 'Lovelace',
      grade: 1,
      allergies: '',
    });
  });

  it('keeps walking back into that child’s own questions, so a wrong name is reachable', () => {
    /*
     * The other half of un-banking, and the reason it is worth more than a
     * missing blank row. A parent who spots a mistyped name two screens later
     * has Back and nothing else; it has to reach the box that holds the name,
     * with the name in it, rather than stopping at a fork that has forgotten
     * which child it is talking about.
     */
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, false, false);

    let back = goBack(held)!;
    back = goBack(back)!;
    back = goBack(back)!;

    expect(back).toMatchObject({ step: 'child-last', buffer: 'Lovelace' });
  });
});

describe('going back', () => {
  it('reopens the previous question with its answer in the buffer', () => {
    const held = advance(typeText(start(), 'Ada'));
    expect(held.step).toBe('child-last');

    const back = goBack(held)!;
    expect(back.step).toBe('child-first');
    expect(back.buffer).toBe('Ada');
  });

  it('has nowhere to go from the first question, which is how the wizard closes', () => {
    expect(goBack(start())).toBeNull();
  });
});

describe('adding a sibling', () => {
  const sibling = () =>
    initialState({ registrationId: 'r-1', requiresCheckOut: false, mode: 'sibling' });

  it('skips the adult entirely — two questions, not six', () => {
    let held = addChild(sibling(), 'Ada', 'Lovelace', 4 as Grade);
    expect(held.step).toBe('another');

    held = answerAnother(held, false, false);
    // Straight to the confirm. The family is already identified by the digits
    // they searched with, and the household upstream already holds their
    // parent — asking again is three questions to learn nothing.
    expect(held.step).toBe('confirm');
    expect(held.children).toHaveLength(1);
  });

  it('still loops, for the parent adding two at once', () => {
    let held = addChild(sibling(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, true, false);
    held = addChild(held, 'Byron', 'Lovelace', 1 as Grade);
    held = answerAnother(held, false, false);

    expect(held.step).toBe('confirm');
    expect(held.children.map((child) => child.firstName)).toEqual(['Ada', 'Byron']);
  });

  it('goes back to the list rather than to an adult who was never asked about', () => {
    let held = addChild(sibling(), 'Ada', 'Lovelace', 4 as Grade);
    held = answerAnother(held, false, false);

    expect(goBack(held)!.step).toBe('another');
  });
});

/**
 * The allergies question, which exists exactly where the backend can hold the
 * answer.
 *
 * The gate is the whole design: the retired phone form checked the same
 * write-back capability before showing its field, because a medical note typed
 * into a screen that silently drops it is worse than a screen that never
 * asked. Everything else — one tap for "none", digits allowed, the 200-cap —
 * follows from what the note is and what the glass keyboard can produce.
 */
describe('the allergies question', () => {
  function startAsking(requiresCheckOut = false): RegistrationState {
    return initialState({
      registrationId: 'r-1',
      requiresCheckOut,
      allergiesSupported: true,
    });
  }

  /** Through the name and grade questions, to wherever the wizard goes next. */
  function throughGrade(state: RegistrationState): RegistrationState {
    let held = advance(typeText(state, 'Ada'));
    held = advance(typeText(applyKey(held, { kind: 'clear' }), 'Lovelace'));
    return chooseGrade(held, 4 as Grade);
  }

  it('is only asked when the binding says the answer can land', () => {
    expect(throughGrade(startAsking()).step).toBe('child-allergies');
    // The default is silence: a binding written before the flag existed, or a
    // backend that cannot carry the note, and the wizard is exactly as short
    // as it was.
    expect(throughGrade(start()).step).toBe('another');
  });

  it('records nothing on one tap, which is the common answer', () => {
    const asked = throughGrade(startAsking());
    expect(canAdvance(asked)).toBe(true);
    const answered = advance(asked);
    expect(answered.step).toBe('another');
    expect(answered.draft.allergies).toBe('');
  });

  it('accepts the digits a name refuses', () => {
    // "Type 1 diabetes" is medical text, not a name. The class is exactly what
    // the glass keyboard produces — no comma, no period, and that is a
    // decision: two more keys would change the keyboard's geometry on every
    // screen, and a space-separated note reads fine to the human it is for.
    const asked = throughGrade(startAsking());
    expect(typeText(asked, 'Type 1 diabetes').buffer).toBe('Type 1 diabetes');
  });

  it('refuses the punctuation the keyboard has no key for', () => {
    // A hardware keyboard, or a paste. The class is the same one the glass
    // keys are drawn from, so what arrives from anywhere else is held to it.
    const asked = throughGrade(startAsking());

    expect(typeText(asked, 'Type 1, please.').buffer).toBe('Type 1 please');
    expect(applyKey(asked, { kind: 'char', value: '.' })).toBe(asked);
  });

  it('holds the shift lock through a whole note', () => {
    /*
     * The one place caps lock earns its keep: a parent writing EPIPEN in the
     * allergies box. Auto-shift is for names, and it would drop the lock after
     * the first letter of every word — so the lock, once a parent has chosen
     * it, outranks the automatic behaviour here exactly as it does in a name.
     */
    const locked = applyKey(throughGrade(startAsking()), { kind: 'shift' });
    expect(locked.shift).toBe('lock');

    expect(typeText(locked, 'EPIPEN').shift).toBe('lock');
  });

  it('opens the keyboard in capitals when the tick comes off', () => {
    // An emptied box is the start of a fresh answer, and the first letter of
    // one is a capital — the same rule every other question opens on.
    const typed = typeText(throughGrade(startAsking()), 'peanuts');
    expect(toggleNoAllergies(typed).shift).toBe('on');
    expect(toggleNoAllergies(toggleNoAllergies(typed)).shift).toBe('on');
  });

  it('refuses a note longer than the callable would take', () => {
    const asked = typeText(throughGrade(startAsking()), 'a'.repeat(300));
    expect(asked.buffer.length).toBe(200);
  });

  it('keeps the note on the child it was typed for', () => {
    let held = advance(typeText(throughGrade(startAsking()), 'Peanuts'));
    held = answerAnother(held, true, false);
    held = advance(typeText(held, 'Byron'));
    held = advance(held); // prefilled surname
    held = chooseGrade(held, 1 as Grade);
    held = advance(held); // no allergies for Byron
    held = answerAnother(held, false, false);

    expect(held.children.map((child) => child.allergies)).toEqual(['Peanuts', '']);
  });

  it('reopens with the note in the buffer, like every other question', () => {
    const answered = advance(typeText(throughGrade(startAsking()), 'Bee stings'));
    const reopened = goBack(answered)!;
    expect(reopened.step).toBe('child-allergies');
    expect(reopened.buffer).toBe('Bee stings');
    // And one more step back is the grade, not a skipped-over hole.
    expect(goBack(reopened)!.step).toBe('child-grade');
  });

  it('empties the box when the tick goes on, and leaves it empty coming off', () => {
    const typed = typeText(throughGrade(startAsking()), 'Peanuts');
    const ticked = toggleNoAllergies(typed);
    expect(ticked.noAllergies).toBe(true);
    expect(ticked.buffer).toBe('');

    /*
     * Unticking does not resurrect it. The box is the record of what will be
     * sent, and text that reappeared after being hidden behind a grey panel is
     * text nobody agreed to send.
     */
    const untutored = toggleNoAllergies(ticked);
    expect(untutored.noAllergies).toBe(false);
    expect(untutored.buffer).toBe('');
  });

  it('makes every key inert while it is ticked', () => {
    const ticked = toggleNoAllergies(throughGrade(startAsking()));
    // Not only the letters: clearing or backspacing an emptied, greyed box is
    // a press that would do nothing, and it says so by being grey.
    expect(typeText(ticked, 'Peanuts').buffer).toBe('');
    expect(applyKey(ticked, { kind: 'clear' })).toBe(ticked);
    expect(applyKey(ticked, { kind: 'backspace' })).toBe(ticked);
    expect(applyKey(ticked, { kind: 'shift' })).toBe(ticked);
  });

  it('records none when ticked, whatever had been typed before', () => {
    const answered = advance(toggleNoAllergies(typeText(throughGrade(startAsking()), 'Peanuts')));
    expect(answered.step).toBe('another');
    expect(answered.draft.allergies).toBe('');
  });

  it('starts each child unticked, so one answer cannot serve two', () => {
    let held = advance(toggleNoAllergies(throughGrade(startAsking())));
    held = answerAnother(held, true, false);
    held = advance(typeText(held, 'Byron'));
    held = advance(held); // prefilled surname
    held = chooseGrade(held, 1 as Grade);

    expect(held.step).toBe('child-allergies');
    expect(held.noAllergies).toBe(false);
  });

  it('only applies on its own step', () => {
    const naming = throughGrade(startAsking());
    const elsewhere = goBack(naming)!; // child-grade
    expect(toggleNoAllergies(elsewhere)).toBe(elsewhere);
  });

  it('is asked for a sibling too — the gate is the binding, not the mode', () => {
    const sibling = initialState({
      registrationId: 'r-2',
      requiresCheckOut: false,
      mode: 'sibling',
      allergiesSupported: true,
    });
    expect(throughGrade(sibling).step).toBe('child-allergies');
  });
});
