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
  });
});

describe('the loop', () => {
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
