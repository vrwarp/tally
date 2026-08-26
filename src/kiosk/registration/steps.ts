/**
 * The registration wizard's state machine, with no React in it.
 *
 * One question per screen, because the alternative on a lobby tablet is a form
 * with six boxes and an on-screen keyboard that can only fill one of them at a
 * time — a parent tapping between fields, losing their place in a queue. The
 * screens are the same frame the search screen uses (header, buffer, keyboard),
 * so a keystroke still changes only text.
 *
 * Kept pure and separate for the usual two reasons: the geometry rules and the
 * validation are worth testing without rendering anything, and this file is the
 * one place that knows what 'done' means for each question.
 */
import type { Grade } from '@/types';
import type { KioskKey, ShiftState } from '../components/Keyboard';

/** The most children one run of the wizard may add. Mirrors the server's cap. */
export const MAX_CHILDREN = 6;

/** Long enough for any real name; the same ceiling the callable enforces. */
export const NAME_MAX_LENGTH = 40;

/** Room for a real note; the same ceiling the callable enforces. */
export const ALLERGIES_MAX_LENGTH = 200;

export const PHONE_LENGTH = 10;

export type StepKind =
  | 'child-first'
  | 'child-last'
  | 'child-grade'
  | 'child-allergies'
  | 'another'
  | 'guardian-first'
  | 'guardian-last'
  | 'guardian-phone'
  | 'confirm'
  | 'submitting'
  | 'success'
  | 'error';

/**
 * Which of the two journeys this run is.
 *
 * `family` is a household nobody has met: three questions per child, three
 * about the adult, a confirm — six for one child.
 *
 * `sibling` is the common case the first design treated as impossible. A parent
 * whose second child is finally old enough found themselves by phone a moment
 * ago, so the kiosk already knows which family this is and the server can
 * verify it. Asking for the adult again would be three questions to learn
 * nothing and one more chance to mistype a name onto a second household. Two
 * questions, then.
 */
export type RegistrationMode = 'family' | 'sibling';

export interface DraftChild {
  firstName: string;
  lastName: string;
  grade: Grade | null;
  /** The allergy note as typed, or '' for none — which is the common answer. */
  allergies: string;
}

export interface RegistrationState {
  mode: RegistrationMode;
  step: StepKind;
  /**
   * Whether the allergies question exists in this run at all.
   *
   * From the binding, which carried it from the server: true exactly when the
   * church's people backend can hold the answer. Asking without that would be
   * collecting a family's medical note into a screen that silently drops it —
   * the retired phone form made the same check before showing its field. On
   * the state rather than threaded as a parameter, because `chooseGrade`
   * advances internally and every caller would have to carry it.
   */
  allergiesSupported: boolean;
  /**
   * Whether "No allergies" is ticked on the allergies step.
   *
   * An empty buffer already means none, so this is not what *records* the
   * answer — it is what stops the answer being typed. A medical field with a
   * keyboard under it and no visible way to say "nothing" invites "None",
   * "N/A" and "no allergies" as free text, three spellings of a blank that
   * then travel to the church's database as though they were notes. The tick
   * sits where the typing would have started and empties the box instead.
   *
   * One child's worth of lifetime: every entry to the step clears it, so the
   * second child is never silently answered by the first.
   */
  noAllergies: boolean;
  /** Minted once per run and re-sent on every retry — see the callable. */
  registrationId: string;
  /** Children whose three questions are answered. */
  children: DraftChild[];
  /** The child being typed in now. */
  draft: DraftChild;
  guardian: { firstName: string; lastName: string; phone: string };
  /** What the keyboard is filling in, for whichever step is showing. */
  buffer: string;
  /**
   * Whether the next letter is a capital.
   *
   * Auto-capitalised at the start of a name and after each space, hyphen and
   * apostrophe — the boundaries a name actually has — so the common case needs
   * no thought, and the shift key is there for the names no rule gets right.
   */
  shift: ShiftState;
  /** Set on `success`: the digits to teach the family. */
  last4: string;
  /** Set on `error`: what to put on the screen. */
  message: string;
}

/**
 * What the grade question opens on — the same judgement the staff quick-add
 * makes, restated rather than imported because that module pulls the whole main
 * app's design system in with it.
 *
 * A youth gathering opens on the middle of its band, which is one fewer tap for
 * most families. A gathering that hands children back opens on no grade at all:
 * a nursery child has none, and 'No grade' is an answer rather than a blank.
 */
export function defaultGrade(requiresCheckOut: boolean): Grade | null {
  return requiresCheckOut ? null : (9 as Grade);
}

export function initialState(args: {
  registrationId: string;
  requiresCheckOut: boolean;
  mode?: RegistrationMode;
  allergiesSupported?: boolean;
}): RegistrationState {
  return {
    mode: args.mode ?? 'family',
    step: 'child-first',
    registrationId: args.registrationId,
    allergiesSupported: args.allergiesSupported === true,
    noAllergies: false,
    children: [],
    draft: {
      firstName: '',
      lastName: '',
      grade: defaultGrade(args.requiresCheckOut),
      allergies: '',
    },
    guardian: { firstName: '', lastName: '', phone: '' },
    buffer: '',
    shift: 'on',
    last4: '',
    message: '',
  };
}

/* -------------------------------------------------------------------------- */
/* The buffer                                                                  */
/* -------------------------------------------------------------------------- */

/** Which steps the keyboard is typing into at all. */
export function isTypingStep(step: StepKind): boolean {
  return (
    step === 'child-first' ||
    step === 'child-last' ||
    step === 'child-allergies' ||
    step === 'guardian-first' ||
    step === 'guardian-last' ||
    step === 'guardian-phone'
  );
}

const NAME_CHARACTER = /[\p{L}' -]/u;

/**
 * What an allergy note may contain: everything the glass keyboard can produce.
 *
 * Wider than a name on purpose — digits are legitimate medical text ("Type 1
 * diabetes", "EpiPen 0.3") — and no wider, deliberately: the keyboard has no
 * comma or period, and growing it two keys would change its geometry on every
 * screen including search. "Peanuts tree nuts EpiPen in bag" reads fine to the
 * human this note is for, and the upstream editor refines it after approval.
 */
const ALLERGY_CHARACTER = /[\p{L}\p{N}' -]/u;

/**
 * Where a capital belongs in a name, if nobody says otherwise.
 *
 * The boundaries a name actually has: its start, and after each space, hyphen
 * and apostrophe. That is what makes Anne-Marie and O'Brien come out right
 * without anybody reaching for the shift key.
 *
 * It is a *default*, not a rule, which is the whole reason the shift key exists
 * beside it. No rule short of a dictionary gets McDonald, van der Berg and
 * O'Sullivan all right, and what is typed here goes on the roster, into the
 * church's database and onto a sticker a child wears. A parent can see the case
 * as they type it and fix it themselves.
 */
function autoShiftAfter(buffer: string): ShiftState {
  return buffer === '' || /[\s'-]$/.test(buffer) ? 'on' : 'off';
}

/**
 * The buffer with one keystroke appended.
 *
 * Two things happen here and both are about spaces. A leading one is refused,
 * because it is the one keystroke that would silently do nothing useful, and a
 * doubled one is collapsed, because `Mary  Jane` on a roster is a name nobody
 * can search for.
 */
function typeInto(buffer: string, value: string): string {
  /*
   * Stryker disable next-line MethodExpression: a key's value is one character
   * — the keyboard emits one per press — and trimming either end of a single
   * character is the same operation. `trimStart` is which end this is *about*.
   */
  const typed = buffer === '' ? value.trimStart() : value;
  return (buffer + typed).replace(/\s{2,}/g, ' ');
}

/** Off → on → lock → off, the cycle every phone keyboard's shift key has. */
function cycleShift(shift: ShiftState): ShiftState {
  return shift === 'off' ? 'on' : shift === 'on' ? 'lock' : 'off';
}

/**
 * One keystroke against the buffer, under the rules of the step showing.
 *
 * A name refuses digits outright rather than accepting and failing at submit:
 * the readout is the only feedback a parent gets, and a key that does nothing
 * says 'not that' faster than a sentence would. The phone takes digits only,
 * for the same reason in the other direction.
 *
 * The case of a letter is decided by the keyboard, not here — a key shows what
 * it will produce, and this appends what it was given. What this owns is what
 * the shift state becomes *next*, which is the part a keyboard cannot know.
 */
export function applyKey(
  state: RegistrationState,
  key: KioskKey,
): RegistrationState {
  if (!isTypingStep(state.step)) return state;
  /*
   * The box is inert while "No allergies" is ticked, and every key is — not
   * only the letters. Clearing or backspacing an empty greyed-out box is a
   * press that does nothing, and the screen says so by being grey rather than
   * by swallowing keystrokes silently. Untick to type.
   */
  /*
   * Stryker disable next-line ConditionalExpression: the step check is
   * redundant with the flag — `advance`, `answerAnother` and `goBack` all clear
   * `noAllergies` on the way out of this question, so it is never set on any
   * other step. It stays because that invariant lives in three other functions
   * and this one should not have to trust them.
   */
  if (state.step === 'child-allergies' && state.noAllergies) return state;
  if (key.kind === 'shift') return { ...state, shift: cycleShift(state.shift) };
  if (key.kind === 'clear') return { ...state, buffer: '', shift: 'on' };
  if (key.kind === 'backspace') {
    const buffer = state.buffer.slice(0, -1);
    return {
      ...state,
      buffer,
      shift: state.shift === 'lock' ? 'lock' : autoShiftAfter(buffer),
    };
  }

  if (state.step === 'guardian-phone') {
    if (!/^\d$/.test(key.value)) return state;
    if (state.buffer.length >= PHONE_LENGTH) return state;
    return { ...state, buffer: state.buffer + key.value };
  }

  if (state.step === 'child-allergies') {
    if (!ALLERGY_CHARACTER.test(key.value)) return state;
    const next = typeInto(state.buffer, key.value);
    if (next.length > ALLERGIES_MAX_LENGTH) return state;
    return {
      ...state,
      buffer: next,
      shift: state.shift === 'lock' ? 'lock' : autoShiftAfter(next),
    };
  }

  if (!NAME_CHARACTER.test(key.value)) return state;
  const next = typeInto(state.buffer, key.value);
  if (next.length > NAME_MAX_LENGTH) return state;
  return {
    ...state,
    buffer: next,
    // A held shift survives the letter; a one-shot one is spent by it, and the
    // next word boundary sets it again.
    shift: state.shift === 'lock' ? 'lock' : autoShiftAfter(next),
  };
}

/** Whether the question on screen has been answered well enough to move on. */
export function canAdvance(state: RegistrationState): boolean {
  if (state.step === 'guardian-phone')
    return state.buffer.length === PHONE_LENGTH;
  // An empty allergies buffer is not an unanswered question — it is the
  // answer most families give.
  if (state.step === 'child-allergies') return true;
  /*
   * Stryker disable next-line MethodExpression: `typeInto` refuses a leading
   * space and collapses the rest, so the buffer never consists only of
   * whitespace and the trim can only ever remove a single trailing space from
   * a non-empty answer. The trim is here to say what "answered" means.
   */
  if (isTypingStep(state.step)) return state.buffer.trim().length > 0;
  return true;
}

/** `5550103344` as `555-010-3344`, for the readout only. */
export function formatPhone(digits: string): string {
  const area = digits.slice(0, 3);
  const prefix = digits.slice(3, 6);
  const line = digits.slice(6, 10);
  return [area, prefix, line].filter((part) => part.length > 0).join('-');
}

/* -------------------------------------------------------------------------- */
/* Moving between questions                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Commits the buffer and moves to the next question.
 *
 * The prefills live here, and they are the difference between a family of three
 * typing one surname and typing it three times: the next child's last name
 * opens on the previous child's, and the parent's opens on the first child's.
 * Both are right far more often than they are wrong and are one Clear away when
 * they are not.
 */
export function advance(state: RegistrationState): RegistrationState {
  if (!canAdvance(state)) return state;
  const value = state.buffer.trim();

  switch (state.step) {
    case 'child-first':
      return {
        ...state,
        draft: { ...state.draft, firstName: value },
        step: 'child-last',
        // The surname the family has been typing, offered again.
        buffer: state.draft.lastName || lastNameSoFar(state),
        shift: autoShiftAfter(state.draft.lastName || lastNameSoFar(state)),
      };
    case 'child-last':
      return {
        ...state,
        draft: { ...state.draft, lastName: value },
        step: 'child-grade',
        buffer: '',
        shift: 'on',
      };
    case 'child-grade':
      return {
        ...state,
        step: state.allergiesSupported ? 'child-allergies' : 'another',
        buffer: '',
        shift: 'on',
        // Each child answers for themselves — see `noAllergies`.
        noAllergies: false,
      };
    case 'child-allergies':
      return {
        ...state,
        // The tick and an empty box record the same answer, and the tick wins
        // where they could disagree: it is the one the parent can see.
        draft: { ...state.draft, allergies: state.noAllergies ? '' : value },
        step: 'another',
        buffer: '',
        shift: 'on',
        noAllergies: false,
      };
    case 'guardian-first':
      return {
        ...state,
        guardian: { ...state.guardian, firstName: value },
        step: 'guardian-last',
        buffer: state.guardian.lastName || lastNameSoFar(state),
        shift: autoShiftAfter(state.guardian.lastName || lastNameSoFar(state)),
      };
    case 'guardian-last':
      return {
        ...state,
        guardian: { ...state.guardian, lastName: value },
        step: 'guardian-phone',
        buffer: state.guardian.phone,
        shift: 'off',
      };
    case 'guardian-phone':
      return {
        ...state,
        guardian: { ...state.guardian, phone: value },
        step: 'confirm',
        buffer: '',
        shift: 'on',
      };
    default:
      return state;
  }
}

function lastNameSoFar(state: RegistrationState): string {
  return state.children.length > 0
    ? state.children[state.children.length - 1]!.lastName
    : '';
}

/**
 * Ticks or unticks "No allergies", and empties the box when it goes on.
 *
 * Emptying is the point rather than a side effect: a parent who typed
 * "peanuts", thought better of it and ticked the box must not leave "peanuts"
 * behind a grey panel to be committed by the next press. Unticking does not
 * put it back — the box is the record of what will be sent, and a control that
 * resurrected text nobody could see while it was hidden would be worse.
 */
export function toggleNoAllergies(state: RegistrationState): RegistrationState {
  if (state.step !== 'child-allergies') return state;
  const noAllergies = !state.noAllergies;
  return { ...state, noAllergies, buffer: noAllergies ? '' : state.buffer, shift: 'on' };
}

/** The grade chips. `null` is 'No grade' — an answer, not a skip. */
export function chooseGrade(
  state: RegistrationState,
  grade: Grade | null,
): RegistrationState {
  if (state.step !== 'child-grade') return state;
  return advance({ ...state, draft: { ...state.draft, grade } });
}

/**
 * 'Anybody else?' — the loop that makes this worth doing at a kiosk at all.
 *
 * The child on the draft is banked either way; what `more` decides is whether
 * the wizard goes back to the top of the child questions or on to the adult.
 */
export function answerAnother(
  state: RegistrationState,
  more: boolean,
  requiresCheckOut: boolean,
): RegistrationState {
  if (state.step !== 'another') return state;
  const children = [...state.children, state.draft];

  if (more && children.length < MAX_CHILDREN) {
    return {
      ...state,
      children,
      draft: {
        firstName: '',
        lastName: '',
        grade: defaultGrade(requiresCheckOut),
        allergies: '',
      },
      step: 'child-first',
      buffer: '',
      shift: 'on',
    };
  }

  return {
    ...state,
    children,
    draft: {
      firstName: '',
      lastName: '',
      grade: defaultGrade(requiresCheckOut),
      allergies: '',
    },
    // A sibling registration has no adult to ask about: the family is already
    // identified, and the household upstream already holds their parent.
    step: state.mode === 'sibling' ? 'confirm' : 'guardian-first',
    buffer: '',
    shift: 'on',
  };
}

/**
 * One step back, for the parent who mistyped the question before.
 *
 * Deliberately shallow: it reopens the previous question with its answer in the
 * buffer, and it does not walk back into an earlier child. A family who typed
 * the wrong name three children ago starts over — the whole run is under a
 * minute, and a wizard that can be reversed arbitrarily is a wizard whose state
 * nobody can reason about at a door.
 */
export function goBack(state: RegistrationState): RegistrationState | null {
  switch (state.step) {
    /*
     * Stryker disable next-line StringLiteral: `default` answers null too, so
     * no test can tell this case from falling through to it. It is here because
     * "the first question has nowhere back" is the rule, and the default is the
     * catch-all for the steps that have no keyboard at all.
     */
    case 'child-first':
      return null;
    case 'child-last':
      return {
        ...state,
        step: 'child-first',
        buffer: state.draft.firstName,
        shift: autoShiftAfter(state.draft.firstName),
      };
    case 'child-grade':
      return {
        ...state,
        step: 'child-last',
        buffer: state.draft.lastName,
        shift: autoShiftAfter(state.draft.lastName),
      };
    case 'child-allergies':
      return { ...state, step: 'child-grade', buffer: '', shift: 'on' };
    case 'another':
      return state.allergiesSupported
        ? {
            ...state,
            step: 'child-allergies',
            // The note as answered, reopened for editing — the same contract
            // every other reopened question keeps. Unticked whatever was
            // answered: an empty box is the honest reopening of "none", and it
            // is one tap from ticked again.
            buffer: state.draft.allergies,
            shift: autoShiftAfter(state.draft.allergies),
            noAllergies: false,
          }
        : { ...state, step: 'child-grade', buffer: '', shift: 'on' };
    case 'guardian-first':
      return { ...state, step: 'another', buffer: '', shift: 'on' };
    case 'guardian-last':
      return {
        ...state,
        step: 'guardian-first',
        buffer: state.guardian.firstName,
        shift: autoShiftAfter(state.guardian.firstName),
      };
    case 'guardian-phone':
      return {
        ...state,
        step: 'guardian-last',
        buffer: state.guardian.lastName,
        shift: autoShiftAfter(state.guardian.lastName),
      };
    case 'confirm':
      return state.mode === 'sibling'
        ? { ...state, step: 'another', buffer: '', shift: 'on' }
        : {
            ...state,
            step: 'guardian-phone',
            buffer: state.guardian.phone,
            shift: 'off',
          };
    case 'error':
      return {
        ...state,
        step: 'confirm',
        buffer: '',
        shift: 'on',
        message: '',
      };
    default:
      return null;
  }
}

/** Everybody this run will register — the banked children plus the draft. */
export function familyOf(state: RegistrationState): DraftChild[] {
  return state.step === 'another'
    ? [...state.children, state.draft]
    : state.children;
}
