/**
 * The wizard's rules, without rendering anything.
 *
 * What is worth pinning here is not that the steps happen in order — that is
 * one switch statement — but the three judgements a family actually feels: what
 * the keyboard will and will not accept into a name, where the surnames come
 * from, and that the loop banks a child before it asks about the next one.
 */
import { describe, expect, it } from 'vitest';
import { PRE_K, type Grade } from '@/types';
import type { ShiftState } from '../components/Keyboard';
import {
  addAnotherChild,
  advance,
  applyKey,
  canAdvance,
  chooseGrade,
  defaultGrade,
  formatPhone,
  questionList,
  readoutFor,
  reopen,
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

/**
 * One child, through their questions and banked.
 *
 * Where that lands depends on the run: the first child of a family run goes on
 * to the adult, and every child after the adult has been answered goes to the
 * confirm. See `stepAfterChildQuestions`.
 */
function addChild(
  state: RegistrationState,
  firstName: string,
  lastName: string,
  grade: Grade | null,
): RegistrationState {
  let held = advance(typeText(state, firstName));
  // The last-name step opens prefilled; clear it before typing this child's.
  held = advance(typeText(applyKey(held, { kind: 'clear' }), lastName));
  // A chip selects; Next is what leaves the question, as on every other step.
  return advance(chooseGrade(held, grade));
}

/** The adult's three questions, from their first name to the confirm. */
function addGuardian(
  state: RegistrationState,
  firstName: string,
  lastName: string,
  phone: string,
): RegistrationState {
  let held = advance(typeText(state, firstName));
  held = advance(typeText(applyKey(held, { kind: 'clear' }), lastName));
  return advance(typeText(held, phone));
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
    held = addGuardian(held, 'Anne', 'Lovelace', '5550103344');
    held = addAnotherChild(held);
    expect(held.shift).toBe('on');
    held = advance(typeText(held, 'Byron'));
    expect(held.buffer).toBe('Lovelace');
    expect(held.shift).toBe('off');
  });
});

describe('typing a phone number', () => {
  function atPhone(): RegistrationState {
    const held = advance(typeText(addChild(start(), 'Ada', 'Lovelace', 4 as Grade), 'Anne'));
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
    held = addGuardian(held, 'Anne', 'Lovelace', '5550103344');
    held = advance(typeText(addAnotherChild(held), 'Byron'));

    expect(held.step).toBe('child-last');
    expect(held.buffer).toBe('Lovelace');
  });

  it("opens the parent's last name on the family's", () => {
    const held = advance(typeText(addChild(start(), 'Ada', 'Lovelace', 4 as Grade), 'Anne'));

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
  it('adds another child only from the screen that offers it', () => {
    /*
     * Every one of these is a button on some other screen, and the wizard is
     * one shared state machine — a stray press mid-typing must be a press that
     * did nothing, not one that banks a half-typed child or jumps a question.
     */
    const typing = typeText(start(), 'Ada');

    expect(addAnotherChild(typing)).toBe(typing);
    expect(chooseGrade(typing, 4 as Grade)).toBe(typing);
    // And the draft is nobody's child until their last question is answered: a
    // list drawn mid-question would show a child nobody finished.
    expect(typing.children).toEqual([]);
  });

  it('advances nothing while the answer is not one', () => {
    // Every step that reads a buffer refuses an empty one. `advance` is what
    // the Next key calls, and the key is drawn disabled — but the rule lives
    // here, because a hardware keyboard's Enter reaches the same function.
    const empty = start();
    expect(canAdvance(empty)).toBe(false);
    expect(advance(empty)).toBe(empty);
  });

  it('banks the child as their last question is answered', () => {
    const banked = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);

    expect(banked.children).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', grade: 4, allergies: '' },
    ]);
    // And the draft is clean behind them, ready for whoever comes next.
    expect(banked.draft.firstName).toBe('');
  });

  it('starts the next child clean, on the same gathering default', () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = addGuardian(held, 'Anne', 'Lovelace', '5550103344');
    held = addAnotherChild(held);

    expect(held.step).toBe('child-first');
    expect(held.buffer).toBe('');
    expect(held.draft.firstName).toBe('');
    expect(held.draft.grade).toBe(9);
  });

  it('collects a whole family in one run', () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = addGuardian(held, 'Anne', 'Lovelace', '5550103344');
    held = addChild(addAnotherChild(held), 'Byron', 'Lovelace', 1 as Grade);

    expect(held.step).toBe('confirm');
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
    requiresCheckOut: false,
    backFromConfirm: 'guardian-phone',
    gradePicked: false,
    editing: null,
    resume: null,
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
      requiresCheckOut: true,
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

  it('banks the child off the grade question when allergies are not asked', () => {
    const graded = advance(
      chooseGrade(advance(typeText(advance(typeText(start(), 'Ada')), 'Lovelace')), 11 as Grade),
    );

    expect(graded).toEqual({
      ...BASE,
      children: [{ firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: '' }],
      // The draft behind them is `BASE.draft` again — clean, on the gathering's
      // own default, ready for whoever the parent adds next.
      step: 'guardian-first',
      buffer: '',
      shift: 'on',
      noAllergies: false,
    });
  });

  it('banks the note and unticks the box as the child is banked', () => {
    const withAllergies = initialState({
      registrationId: 'r-1',
      requiresCheckOut: false,
      allergiesSupported: true,
    });
    const asked = advance(
      chooseGrade(
        advance(typeText(advance(typeText(withAllergies, 'Ada')), 'Lovelace')),
        11 as Grade,
      ),
    );
    expect(asked.step).toBe('child-allergies');

    expect(advance(typeText(asked, 'Peanuts'))).toEqual({
      ...BASE,
      allergiesSupported: true,
      children: [
        { firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: 'Peanuts' },
      ],
      step: 'guardian-first',
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
    const atConfirm: RegistrationState = {
      ...BASE,
      step: 'confirm',
      children: [{ firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: '' }],
      guardian: { firstName: 'Dana', lastName: 'Rivera', phone: '5550103344' },
    };

    expect(addAnotherChild(atConfirm)).toEqual({
      ...atConfirm,
      draft: { firstName: '', lastName: '', grade: 9 as Grade, allergies: '' },
      step: 'child-first',
      buffer: '',
      shift: 'on',
    });
  });

  it('goes to the adult the first time and back to the confirm after that', () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    expect(held.step).toBe('guardian-first');

    /*
     * A parent who came back from the confirm for another child has already
     * answered the adult's three questions. Asking again would be three
     * questions to learn nothing, and one more chance to mistype a name.
     */
    held = addGuardian(held, 'Dana', 'Rivera', '5550103344');
    held = addChild(addAnotherChild(held), 'Byron', 'Lovelace', 1 as Grade);

    expect(held.step).toBe('confirm');
    // And Back from there reopens that child, not the parent's number.
    expect(goBack(held)).toMatchObject({ step: 'child-grade' });
  });

  it('carries the gathering default onto the next child too', () => {
    let held = addChild(start(true), 'Ada', 'Lovelace', 11 as Grade);
    held = addGuardian(held, 'Dana', 'Rivera', '5550103344');

    expect(addAnotherChild(held).draft.grade).toBeNull();
  });

  it('stops offering another child once the family is as large as the kiosk will take', () => {
    let held = addGuardian(
      addChild(start(), 'Child0', 'Osei', 9 as Grade),
      'Dana',
      'Osei',
      '5550103344',
    );
    for (let index = 1; index < MAX_CHILDREN; index += 1) {
      held = addChild(addAnotherChild(held), `Child${index}`, 'Osei', 9 as Grade);
      expect(held.step).toBe('confirm');
    }
    expect(held.children).toHaveLength(MAX_CHILDREN);

    // The seventh is a leader's job. The offer does nothing rather than opening
    // a question whose answer could not be banked.
    expect(addAnotherChild(held)).toBe(held);
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

    expect(goBack(atAllergies)).toEqual({
      ...atAllergies,
      step: 'child-grade',
      buffer: '',
      shift: 'on',
      // Answered once already, so Next is not dead on the way back.
      gradePicked: true,
    });
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
    // The adult's first question steps back into the last child's own, which
    // means un-banking them — see `reopenLastChild`.
    expect(
      goBack({ ...held, step: 'guardian-first', children: [draft], draft: BASE.draft }),
    ).toMatchObject({ step: 'child-grade', buffer: '', shift: 'on' });
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

  it('reopens the allergy note unticked, from the step after it', () => {
    const child = { firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: 'Peanuts' };
    const banked: RegistrationState = {
      ...BASE,
      allergiesSupported: true,
      step: 'guardian-first',
      children: [child],
    };

    expect(goBack(banked)).toEqual({
      ...banked,
      children: [],
      draft: child,
      step: 'child-allergies',
      buffer: 'Peanuts',
      shift: 'off',
      noAllergies: false,
    });
  });

  it('goes back to the confirm from a child added out of it', () => {
    /*
     * The first question of a run has nowhere back and closes the wizard. The
     * first question of a child added from the confirm has somewhere: back to
     * the confirm, abandoning the half-typed child rather than the whole
     * registration a parent has already answered six questions for.
     */
    const adding: RegistrationState = {
      ...BASE,
      step: 'child-first',
      children: [{ firstName: 'Ada', lastName: 'Lovelace', grade: 11 as Grade, allergies: '' }],
      guardian: { firstName: 'Dana', lastName: 'Rivera', phone: '5550103344' },
      buffer: 'By',
    };

    expect(goBack(adding)).toMatchObject({ step: 'confirm', buffer: '' });
    expect(goBack({ ...adding, children: [] })).toBeNull();
  });

  it('has nowhere to go back to from a step with no question behind it', () => {
    for (const step of ['submitting', 'success'] as const) {
      expect(goBack({ ...BASE, step })).toBeNull();
    }
  });
});


/**
 * The list the wizard draws beside the question.
 *
 * A pure derivation, which is the whole reason it lives here: what a parent
 * sees of their own run — what is answered, what is being answered, and what is
 * still to come — is decided by rules, and the rules are worth pinning without
 * rendering anything.
 */
describe('the list of questions', () => {
  const labels = (state: RegistrationState) =>
    questionList(state).map((section) => [
      section.title,
      ...section.rows.map((row) => `${row.state} ${row.label} ${row.answer}`.trim()),
    ]);

  it('names every question in the run before any of them is answered', () => {
    // The forewarning the deleted fork used to carry, and then some: a parent
    // on the first question can see that the adult's three are coming.
    expect(labels(start())).toEqual([
      ['Your child', 'now First name', 'todo Last name', 'todo Grade'],
      ['And you', 'todo First name', 'todo Last name', 'todo Phone'],
    ]);
  });

  it('asks about allergies only where the binding says the answer can land', () => {
    const asking = initialState({
      registrationId: 'r-1',
      requiresCheckOut: false,
      allergiesSupported: true,
    });

    expect(questionList(asking)[0]!.rows.map((row) => row.label)).toEqual([
      'First name',
      'Last name',
      'Grade',
      'Allergies',
    ]);
  });

  it('shows no answer on a question nobody has reached', () => {
    /*
     * The draft opens on this gathering's default grade, and it is a real value
     * on the record from the first keystroke. Printing it beside "Grade" would
     * tell a family they had answered a question nobody asked them.
     */
    const typing = typeText(start(), 'Ada');
    const grade = questionList(typing)[0]!.rows[2]!;

    expect(grade.state).toBe('todo');
    expect(grade.answer).toBe('');
    expect(typing.draft.grade).toBe(9);
  });

  it('fills the answers in behind the parent', () => {
    const held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);

    expect(labels(held)[0]).toEqual([
      'Your child',
      'done First name Ada',
      'done Last name Lovelace',
      'done Grade 4th',
    ]);
  });

  it('names the two years that have no number of their own', () => {
    const preK = addChild(start(true), 'Robin', 'Fields', PRE_K as Grade);
    const none = addChild(start(true), 'Robin', 'Fields', null);

    expect(questionList(preK)[0]!.rows[2]!.answer).toBe('Pre-K');
    expect(questionList(none)[0]!.rows[2]!.answer).toBe('No grade');
  });

  it('puts a second child after the adult, because that is when they are added', () => {
    /*
     * Chronological, not grouped by person. A second child is added from the
     * confirm screen — after the adult's three — and a list that regrouped
     * itself mid-run would be a list that moves under a thumb.
     */
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = addGuardian(held, 'Dana', 'Rivera', '5550103344');
    held = advance(typeText(addAnotherChild(held), 'Byron'));

    expect(questionList(held).map((section) => section.title)).toEqual([
      'Your child',
      'And you',
      'Child 2',
    ]);
    // And the adult reads as answered from the second child's questions, since
    // they were answered before this child existed.
    expect(questionList(held)[1]!.rows.every((row) => row.state === 'done')).toBe(true);
  });

  it('has no adult at all on a sibling run', () => {
    const held = initialState({ registrationId: 'r-1', requiresCheckOut: false, mode: 'sibling' });

    expect(questionList(held).map((section) => section.title)).toEqual(['Your child']);
  });

  it('addresses each row to the step it would reopen', () => {
    // What makes a row tappable later: it carries the step and the child it is
    // about, so nothing has to be inferred from where it sits on the screen.
    const held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    const rows = questionList(held).flatMap((section) => section.rows);

    expect(rows.slice(0, 3).map((row) => [row.step, row.child])).toEqual([
      ['child-first', 0],
      ['child-last', 0],
      ['child-grade', 0],
    ]);
    expect(rows[3]).toMatchObject({ step: 'guardian-first', child: null });
  });
});


/**
 * Tapping a question in the list to fix it.
 *
 * The repair a parent actually needs, and the one Back could not give them: the
 * row somebody wants is usually a banked child's, three screens behind, and
 * Back un-banks its way there so fixing one letter meant walking the whole run
 * forwards again.
 */
describe('reopening a question', () => {
  /** One child and an adult, stopped on the phone question. */
  function atThePhone(): RegistrationState {
    let held = addChild(start(), 'Chidi', 'Okonkwoo', 4 as Grade);
    held = advance(typeText(held, 'Ngozi'));
    return advance(held);
  }

  it('opens the question with its own answer, on the child it belongs to', () => {
    const held = reopen(atThePhone(), 'child-last', 0);

    expect(held).toMatchObject({
      step: 'child-last',
      buffer: 'Okonkwoo',
      editing: 0,
      resume: { step: 'guardian-phone', buffer: '' },
    });
    // Lower case, because the next press is a correction to a word that is
    // already there rather than the start of a new one.
    expect(held.shift).toBe('off');
  });

  it('writes the fix back to that child and returns where the parent was', () => {
    let held = reopen(atThePhone(), 'child-last', 0);
    held = advance(typeText(applyKey(held, { kind: 'clear' }), 'Okonkwo'));

    expect(held.children[0]!.lastName).toBe('Okonkwo');
    // Not forward through everything they had already answered — five screens
    // of re-confirming, in front of a queue, to fix one letter.
    expect(held).toMatchObject({ step: 'guardian-phone', editing: null, resume: null });
  });

  it('leaves the other answers alone', () => {
    let held = reopen(atThePhone(), 'child-first', 0);
    held = advance(typeText(applyKey(held, { kind: 'clear' }), 'Chidiebere'));

    expect(held.children[0]).toEqual({
      firstName: 'Chidiebere',
      lastName: 'Okonkwoo',
      grade: 4,
      allergies: '',
    });
    expect(held.guardian.firstName).toBe('Ngozi');
  });

  it('takes a grade off the grid, for the child being fixed', () => {
    let held = reopen(atThePhone(), 'child-grade', 0);
    expect(held.gradePicked).toBe(true);

    held = advance(chooseGrade(held, 7 as Grade));

    expect(held.children[0]!.grade).toBe(7);
    expect(held.step).toBe('guardian-phone');
  });

  it('is "never mind" when the parent backs out of it', () => {
    const held = goBack(reopen(atThePhone(), 'child-first', 0))!;

    expect(held).toMatchObject({ step: 'guardian-phone', editing: null, resume: null });
    expect(held.children[0]!.firstName).toBe('Chidi');
  });

  it('carries a half-given answer back with them', () => {
    /*
     * A parent taps a row *while* answering something — ten digits typed and
     * not yet committed — because that is when they notice the typo. Coming
     * back to an empty box would lose work they can see on the screen, and
     * their own half-answer is on no record to be read back off.
     */
    const typing = typeText(atThePhone(), '5550149911');
    let held = reopen(typing, 'child-last', 0);
    expect(held.buffer).toBe('Okonkwoo');

    held = advance(typeText(applyKey(held, { kind: 'clear' }), 'Okonkwo'));

    expect(held).toMatchObject({ step: 'guardian-phone', buffer: '5550149911', shift: 'off' });
    expect(canAdvance(held)).toBe(true);
  });

  it('keeps it through a change of mind, too', () => {
    const typing = typeText(atThePhone(), '5550149911');

    expect(goBack(reopen(typing, 'child-last', 0))!).toMatchObject({
      step: 'guardian-phone',
      buffer: '5550149911',
    });
  });

  it('marks the question it will put them back on', () => {
    const rows = questionList(reopen(atThePhone(), 'child-last', 0)).flatMap(
      (section) => section.rows,
    );

    expect(rows.find((row) => row.resumeHere)).toMatchObject({
      step: 'guardian-phone',
      state: 'todo',
    });
    expect(rows.find((row) => row.state === 'now')).toMatchObject({ step: 'child-last' });
  });

  it('offers only the questions that have been answered', () => {
    /*
     * Jumping forward to a question nobody has reached would leave a hole in
     * the run and a blank on the confirm, and there is nothing there to fix.
     */
    const rows = questionList(atThePhone()).flatMap((section) => section.rows);

    expect(rows.filter((row) => row.canReopen).map((row) => row.step)).toEqual([
      'child-first',
      'child-last',
      'child-grade',
      'guardian-first',
      'guardian-last',
    ]);
  });

  it('keeps the run’s own place while a question is open', () => {
    // The list is drawn from where the parent is in the run, not from the
    // question they have jumped to — otherwise their half-answered child would
    // read as finished.
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = addGuardian(held, 'Dana', 'Rivera', '5550103344');
    held = advance(typeText(addAnotherChild(held), 'Byron'));
    expect(held.step).toBe('child-last');

    const open = reopen(held, 'child-first', 0);
    const second = questionList(open).find((section) => section.title === 'Child 2')!;

    expect(second.rows.map((row) => row.state)).toEqual(['done', 'todo', 'todo']);
    expect(second.rows[1]!.resumeHere).toBe(true);
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

  it('will not leave the question until a chip has been pressed', () => {
    /*
     * The draft opens on a grade, so the record cannot say whether anybody
     * picked it. While a chip was the only way off the step that did not
     * matter; now the step carries a Next like every other, and without this a
     * parent could press past the question and file a year they never chose.
     */
    let held = advance(typeText(start(), 'Robin'));
    held = advance(typeText(applyKey(held, { kind: 'clear' }), 'Fields'));
    expect(held.step).toBe('child-grade');
    expect(held.draft.grade).toBe(9);

    expect(canAdvance(held)).toBe(false);
    expect(advance(held)).toBe(held);

    expect(canAdvance(chooseGrade(held, 4 as Grade))).toBe(true);
  });

  it('reads the chosen year back, and nothing before one is chosen', () => {
    let held = advance(typeText(start(), 'Robin'));
    held = advance(typeText(applyKey(held, { kind: 'clear' }), 'Fields'));

    expect(readoutFor(held)).toBe('');
    expect(readoutFor(chooseGrade(held, 4 as Grade))).toBe('4th');
    expect(readoutFor(chooseGrade(held, 0 as Grade))).toBe('Kindergarten');
    expect(readoutFor(chooseGrade(held, null))).toBe('No grade');
  });

  it('takes "no grade" as an answer and moves on', () => {
    const held = addChild(start(true), 'Robin', 'Fields', null);
    expect(held.step).toBe('guardian-first');
    expect(held.children[0]!.grade).toBeNull();
  });
});

describe('going back into the last child', () => {
  it('reopens the allergies question where the gathering asks one', () => {
    let held = initialState({ registrationId: 'r-1', requiresCheckOut: false, allergiesSupported: true });
    held = advance(typeText(held, 'Ada'));
    held = advance(typeText(applyKey(held, { kind: 'clear' }), 'Lovelace'));
    held = advance(chooseGrade(held, 4 as Grade));
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

  it('sends a sibling run back to the child rather than to a parent nobody asked about', () => {
    /*
     * A sibling run has no adult half — the family is already registered, and
     * the parent's details came off the existing record. Backing out of the
     * confirm has to land on the only question that run asked.
     */
    const held = addChild(
      initialState({ registrationId: 'r-1', requiresCheckOut: false, mode: 'sibling' }),
      'Byron',
      'Lovelace',
      1 as Grade,
    );
    expect(held.step).toBe('confirm');

    expect(goBack(held)).toMatchObject({ step: 'child-grade', buffer: '', shift: 'on' });
  });

  it('un-banks the child on the way, rather than reopening a nameless one', () => {
    /*
     * `bankChild` commits the draft and mints a blank one, so a parent who
     * answered their child's last question and then pressed Back used to
     * reopen a child with no name — and pressing on banked that blank for
     * real. The callable refuses it on `parseName`, so what a family met for
     * changing their mind once was "We could not save that just now — please
     * see a leader."
     */
    const held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    expect(held.step).toBe('guardian-first');

    const back = goBack(held)!;

    expect(back.step).toBe('child-grade');
    expect(back.children).toEqual([]);
    expect(back.draft).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      grade: 4,
      allergies: '',
    });
    // And pressing on again banks the family that was always there — once, not
    // twice, and not one and a half times.
    expect(advance(chooseGrade(back, 4 as Grade)).children).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', grade: 4, allergies: '' },
    ]);
  });

  it('un-banks on the sibling path too, where the confirm is what follows', () => {
    const held = addChild(
      initialState({ registrationId: 'r-1', requiresCheckOut: false, mode: 'sibling' }),
      'Byron',
      'Lovelace',
      1 as Grade,
    );

    const back = goBack(held)!;

    expect(back.children).toEqual([]);
    expect(back.draft).toEqual({
      firstName: 'Byron',
      lastName: 'Lovelace',
      grade: 1,
      allergies: '',
    });
  });

  it('leaves the earlier children alone, and only the last one on the draft', () => {
    let held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);
    held = addGuardian(held, 'Dana', 'Rivera', '5550103344');
    held = addChild(addAnotherChild(held), 'Byron', 'Lovelace', 1 as Grade);

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
     * with the name in it, rather than stopping somewhere that has forgotten
     * which child it is talking about.
     */
    const held = addChild(start(), 'Ada', 'Lovelace', 4 as Grade);

    const back = goBack(goBack(held)!)!;

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

  it('skips the adult entirely — the child’s questions, and nothing else', () => {
    const held = addChild(sibling(), 'Ada', 'Lovelace', 4 as Grade);

    // Straight to the confirm. The family is already identified by the digits
    // they searched with, and the household upstream already holds their
    // parent — asking again is three questions to learn nothing.
    expect(held.step).toBe('confirm');
    expect(held.children).toHaveLength(1);
  });

  it('still loops, for the parent adding two at once', () => {
    let held = addChild(sibling(), 'Ada', 'Lovelace', 4 as Grade);
    held = addChild(addAnotherChild(held), 'Byron', 'Lovelace', 1 as Grade);

    expect(held.step).toBe('confirm');
    expect(held.children.map((child) => child.firstName)).toEqual(['Ada', 'Byron']);
  });

  it('goes back to the child rather than to an adult who was never asked about', () => {
    const held = addChild(sibling(), 'Ada', 'Lovelace', 4 as Grade);

    expect(goBack(held)!.step).toBe('child-grade');
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
    return advance(chooseGrade(held, 4 as Grade));
  }

  it('is only asked when the binding says the answer can land', () => {
    expect(throughGrade(startAsking()).step).toBe('child-allergies');
    // The default is silence: a binding written before the flag existed, or a
    // backend that cannot carry the note, and the wizard is exactly as short
    // as it was.
    expect(throughGrade(start()).step).toBe('guardian-first');
  });

  it('records nothing on one tap, which is the common answer', () => {
    const asked = throughGrade(startAsking());
    expect(canAdvance(asked)).toBe(true);
    const answered = advance(asked);
    expect(answered.step).toBe('guardian-first');
    expect(answered.children[0]!.allergies).toBe('');
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
    held = addGuardian(held, 'Dana', 'Rivera', '5550103344');
    held = advance(typeText(addAnotherChild(held), 'Byron'));
    held = advance(held); // prefilled surname
    held = advance(chooseGrade(held, 1 as Grade));
    held = advance(held); // no allergies for Byron

    expect(held.step).toBe('confirm');
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
    expect(answered.step).toBe('guardian-first');
    expect(answered.children[0]!.allergies).toBe('');
  });

  it('starts each child unticked, so one answer cannot serve two', () => {
    let held = advance(toggleNoAllergies(throughGrade(startAsking())));
    held = addGuardian(held, 'Dana', 'Rivera', '5550103344');
    held = advance(typeText(addAnotherChild(held), 'Byron'));
    held = advance(held); // prefilled surname
    held = advance(chooseGrade(held, 1 as Grade));

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
