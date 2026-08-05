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
 * one place that knows what "done" means for each question.
 */
import type { Grade } from '@/types';
import type { KioskKey } from '../components/Keyboard';

/** The most children one run of the wizard may add. Mirrors the server's cap. */
export const MAX_CHILDREN = 6;

/** Long enough for any real name; the same ceiling the callable enforces. */
export const NAME_MAX_LENGTH = 40;

export const PHONE_LENGTH = 10;

export type StepKind =
  | 'child-first'
  | 'child-last'
  | 'child-grade'
  | 'another'
  | 'guardian-first'
  | 'guardian-last'
  | 'guardian-phone'
  | 'confirm'
  | 'submitting'
  | 'success'
  | 'duplicate'
  | 'error';

export interface DraftChild {
  firstName: string;
  lastName: string;
  grade: Grade | null;
}

export interface RegistrationState {
  step: StepKind;
  /** Minted once per run and re-sent on every retry — see the callable. */
  registrationId: string;
  /** Children whose three questions are answered. */
  children: DraftChild[];
  /** The child being typed in now. */
  draft: DraftChild;
  guardian: { firstName: string; lastName: string; phone: string };
  /** What the keyboard is filling in, for whichever step is showing. */
  buffer: string;
  /** Set on `success`: the digits to teach the family. */
  last4: string;
  /** Set on `duplicate` and `error`: what to put on the screen. */
  message: string;
}

/**
 * What the grade question opens on — the same judgement the staff quick-add
 * makes, restated rather than imported because that module pulls the whole main
 * app's design system in with it.
 *
 * A youth gathering opens on the middle of its band, which is one fewer tap for
 * most families. A gathering that hands children back opens on no grade at all:
 * a nursery child has none, and "No grade" is an answer rather than a blank.
 */
export function defaultGrade(requiresCheckOut: boolean): Grade | null {
  return requiresCheckOut ? null : (9 as Grade);
}

export function initialState(args: {
  registrationId: string;
  requiresCheckOut: boolean;
}): RegistrationState {
  return {
    step: 'child-first',
    registrationId: args.registrationId,
    children: [],
    draft: { firstName: '', lastName: '', grade: defaultGrade(args.requiresCheckOut) },
    guardian: { firstName: '', lastName: '', phone: '' },
    buffer: '',
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
    step === 'guardian-first' ||
    step === 'guardian-last' ||
    step === 'guardian-phone'
  );
}

const NAME_CHARACTER = /[\p{L}' -]/u;

/**
 * A name as it should be written down, from a keyboard that only has capitals.
 *
 * The kiosk's keyboard is one static uppercase layout — no shift, because a
 * shift key is a mode and a mode is a thing to get wrong at a door. That is
 * invisible for search, which folds case anyway, and very visible here: what a
 * parent types lands on the roster, goes upstream to the church's database, and
 * is printed on a sticker their child wears. "ROBIN FIELDS" is shouting.
 *
 * So the readout capitalises as it goes, the way a phone keyboard does, and
 * what a parent reads back is exactly what will be saved. Segments start after
 * a space, a hyphen and an apostrophe, which is what makes Anne-Marie and
 * O'Brien come out right. McDonald comes out as Mcdonald — one of a handful of
 * names no rule gets right without a dictionary, and an office correction that
 * a leader can make in the church's own system.
 */
export function titleCaseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_match, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

/**
 * One keystroke against the buffer, under the rules of the step showing.
 *
 * A name refuses digits outright rather than accepting and failing at submit:
 * the readout is the only feedback a parent gets, and a key that does nothing
 * says "not that" faster than a sentence would. The phone takes digits only,
 * for the same reason in the other direction.
 */
export function applyKey(state: RegistrationState, key: KioskKey): RegistrationState {
  if (!isTypingStep(state.step)) return state;
  if (key.kind === 'clear') return { ...state, buffer: '' };
  if (key.kind === 'backspace') return { ...state, buffer: state.buffer.slice(0, -1) };

  if (state.step === 'guardian-phone') {
    if (!/^\d$/.test(key.value)) return state;
    if (state.buffer.length >= PHONE_LENGTH) return state;
    return { ...state, buffer: state.buffer + key.value };
  }

  if (!NAME_CHARACTER.test(key.value)) return state;
  // A leading space is the one keystroke that would silently do nothing useful.
  const next = state.buffer + (state.buffer === '' ? key.value.trimStart() : key.value);
  if (next.length > NAME_MAX_LENGTH) return state;
  return { ...state, buffer: titleCaseName(next.replace(/\s{2,}/g, ' ')) };
}

/** Whether the question on screen has been answered well enough to move on. */
export function canAdvance(state: RegistrationState): boolean {
  if (state.step === 'guardian-phone') return state.buffer.length === PHONE_LENGTH;
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
      };
    case 'child-last':
      return { ...state, draft: { ...state.draft, lastName: value }, step: 'child-grade', buffer: '' };
    case 'child-grade':
      return { ...state, step: 'another', buffer: '' };
    case 'guardian-first':
      return {
        ...state,
        guardian: { ...state.guardian, firstName: value },
        step: 'guardian-last',
        buffer: state.guardian.lastName || lastNameSoFar(state),
      };
    case 'guardian-last':
      return {
        ...state,
        guardian: { ...state.guardian, lastName: value },
        step: 'guardian-phone',
        buffer: state.guardian.phone,
      };
    case 'guardian-phone':
      return { ...state, guardian: { ...state.guardian, phone: value }, step: 'confirm', buffer: '' };
    default:
      return state;
  }
}

function lastNameSoFar(state: RegistrationState): string {
  return state.children.length > 0 ? state.children[state.children.length - 1]!.lastName : '';
}

/** The grade chips. `null` is "No grade" — an answer, not a skip. */
export function chooseGrade(state: RegistrationState, grade: Grade | null): RegistrationState {
  if (state.step !== 'child-grade') return state;
  return advance({ ...state, draft: { ...state.draft, grade } });
}

/**
 * "Anybody else?" — the loop that makes this worth doing at a kiosk at all.
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
      draft: { firstName: '', lastName: '', grade: defaultGrade(requiresCheckOut) },
      step: 'child-first',
      buffer: '',
    };
  }

  return {
    ...state,
    children,
    draft: { firstName: '', lastName: '', grade: defaultGrade(requiresCheckOut) },
    step: 'guardian-first',
    buffer: '',
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
    case 'child-first':
      return null;
    case 'child-last':
      return { ...state, step: 'child-first', buffer: state.draft.firstName };
    case 'child-grade':
      return { ...state, step: 'child-last', buffer: state.draft.lastName };
    case 'another':
      return { ...state, step: 'child-grade', buffer: '' };
    case 'guardian-first':
      return { ...state, step: 'another', buffer: '' };
    case 'guardian-last':
      return { ...state, step: 'guardian-first', buffer: state.guardian.firstName };
    case 'guardian-phone':
      return { ...state, step: 'guardian-last', buffer: state.guardian.lastName };
    case 'confirm':
      return { ...state, step: 'guardian-phone', buffer: state.guardian.phone };
    case 'duplicate':
    case 'error':
      return { ...state, step: 'confirm', buffer: '', message: '' };
    default:
      return null;
  }
}

/** Everybody this run will register — the banked children plus the draft. */
export function familyOf(state: RegistrationState): DraftChild[] {
  return state.step === 'another' ? [...state.children, state.draft] : state.children;
}
