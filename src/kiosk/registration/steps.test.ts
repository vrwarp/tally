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
      { firstName: 'Ada', lastName: 'Lovelace', grade: 4 },
      { firstName: 'Byron', lastName: 'Lovelace', grade: 1 },
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
