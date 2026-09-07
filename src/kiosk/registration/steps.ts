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
import { gradeDescription, NO_GRADE, ordinalGrade } from '@/lib/utils';
import { PRE_K, type Grade } from '@/types';
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
 * `family` is a household nobody has met: three questions per child — four
 * where the church's database can hold an allergy note — three about the
 * adult, and a confirm.
 *
 * `sibling` is the common case the first design treated as impossible. A parent
 * whose second child is finally old enough found themselves by phone a moment
 * ago, so the kiosk already knows which family this is and the server can
 * verify it. Asking for the adult again would be three questions to learn
 * nothing and one more chance to mistype a name onto a second household. So a
 * sibling run is the child's own questions and nothing else: first name, last
 * name, grade, and the allergy note where it is asked at all.
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
   * Whether this gathering hands children back, which decides what a fresh
   * draft's grade opens on.
   *
   * On the state rather than closed over by the reducer because banking a child
   * — which mints the next draft — now happens inside `advance`, where the only
   * thing in scope is this object.
   */
  requiresCheckOut: boolean;
  /**
   * Which question the confirm screen was reached from, so Back reopens it.
   *
   * The confirm has two ways in and they cannot be told apart after the fact: a
   * family arrives from the adult's number, and a parent who came back for
   * another child arrives from that child's last question — with the adult's
   * answers still on the state either way. Inferring it from `guardian.phone`
   * would send a parent who has just typed their second child back to their own
   * phone number, on the one screen where Back is the only repair.
   */
  backFromConfirm: StepKind;
  /**
   * Whether the allergies question exists in this run at all.
   *
   * From the binding, which carried it from the server: true exactly when the
   * church's people backend can hold the answer. Asking without that would be
   * collecting a family's medical note into a screen that silently drops it —
   * the retired phone form made the same check before showing its field. On
   * On the state rather than threaded as a parameter, because it decides where
   * a child's last question leads and half this file needs to know.
   */
  allergiesSupported: boolean;
  /**
   * Whether this child's grade has been chosen, as opposed to defaulted.
   *
   * The draft opens on a grade — the middle of the band, or none where children
   * are handed back — so the record always holds one and cannot say whether
   * anybody picked it. That could stay unsaid while a chip was the only way off
   * the step. Now that the step carries a **Next** like every other one the
   * difference matters: without this a parent could press past the question and
   * file a grade they never chose, and "No grade" is an answer here rather than
   * a blank somebody fills in later.
   *
   * One child's worth of lifetime, like `noAllergies`: a fresh draft starts
   * unpicked, and a child un-banked back onto the step starts picked, because
   * they answered it once already.
   */
  gradePicked: boolean;
  /**
   * Which banked child the buffer is filling, when a parent has tapped a row
   * to fix it. Null in the ordinary forward run, where the buffer fills the
   * draft.
   *
   * The row somebody most wants to fix is usually a banked one: they are on the
   * phone question and they notice their child's surname is wrong, three
   * screens back and already committed. So the record the buffer targets has to
   * be addressable rather than always the draft.
   */
  editing: number | null;
  /**
   * Where **Next** goes after a question was reopened out of order, and null in
   * the ordinary forward run.
   *
   * A parent who fixes question two from question six wants question six back,
   * not five screens of re-confirming what they already answered. Stored rather
   * than derived because the run's own position is exactly what reopening a row
   * throws away — `step` is the reopened question now, and nothing else
   * remembers where they were.
   */
  resume: StepKind | null;
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
    requiresCheckOut: args.requiresCheckOut,
    // Replaced the moment anything routes to the confirm; never read before.
    backFromConfirm: 'guardian-phone',
    registrationId: args.registrationId,
    allergiesSupported: args.allergiesSupported === true,
    noAllergies: false,
    gradePicked: false,
    editing: null,
    resume: null,
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

/** Whether a step is one of the questions a child is asked. */
export function isChildStep(step: StepKind): boolean {
  return (
    step === 'child-first' ||
    step === 'child-last' ||
    step === 'child-grade' ||
    step === 'child-allergies'
  );
}

/** Whether a step is one of the three the adult is asked. */
export function isAdultStep(step: StepKind): boolean {
  return (
    step === 'guardian-first' ||
    step === 'guardian-last' ||
    step === 'guardian-phone'
  );
}

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
  // Stryker disable next-line MethodExpression: a key's value is one character
  // — the keyboard emits one per press — and trimming either end of a single
  // character is the same operation. `trimStart` is which end this is *about*.
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
  // Stryker disable next-line ConditionalExpression: the step check is
  // redundant with the flag — `bankChild` and `goBack` both clear
  // `noAllergies` on the way out of this question, so it is never set on any
  // other step. It stays because that invariant lives in three other functions
  // and this one should not have to trust them.
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
  // A chip has to have been pressed — see `gradePicked`.
  if (state.step === 'child-grade') return state.gradePicked;
  // An empty allergies buffer is not an unanswered question — it is the
  // answer most families give.
  if (state.step === 'child-allergies') return true;
  // Stryker disable next-line MethodExpression: `typeInto` refuses a leading
  // space and collapses the rest, so the buffer never consists only of
  // whitespace and the trim can only ever remove a single trailing space from
  // a non-empty answer. The trim is here to say what "answered" means.
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

/** The last question a child is asked, which the allergies gate decides. */
function lastChildQuestion(state: RegistrationState): StepKind {
  return state.allergiesSupported ? 'child-allergies' : 'child-grade';
}

/**
 * Where a child's last question leads.
 *
 * Three situations, two destinations. A family run that has not met the adult
 * yet goes to meet them; a sibling run never does, because the household
 * upstream already holds their parent; and a family run whose parent came back
 * from the confirm for another child has already answered those three
 * questions and wants the confirm again.
 *
 * `guardian.phone` is only load-bearing inside `mode === 'family'`, and the
 * mode check is what makes that safe: on a sibling run the phone is empty for
 * the whole run and always will be, so alone it would read as "not asked yet"
 * forever.
 */
function stepAfterChildQuestions(state: RegistrationState): StepKind {
  return state.mode === 'sibling' || state.guardian.phone !== ''
    ? 'confirm'
    : 'guardian-first';
}

/**
 * The child the buffer is filling: the draft, or a banked one being fixed.
 *
 * Every child question reads and writes through this pair rather than touching
 * `draft` directly, which is the whole of what makes a row tappable.
 */
function currentChild(state: RegistrationState): DraftChild {
  // Stryker disable next-line OptionalChaining: `editing` is only ever set to
  // an index `reopen` read off a row it built out of `children`.
  return state.editing === null ? state.draft : state.children[state.editing]!;
}

function withChild(state: RegistrationState, child: DraftChild): RegistrationState {
  if (state.editing === null) return { ...state, draft: child };
  return {
    ...state,
    children: state.children.map((banked, index) => (index === state.editing ? child : banked)),
  };
}

/** What a step opens with in the buffer — its own answer, ready to be edited. */
function bufferFor(state: RegistrationState, step: StepKind): string {
  const child = currentChild(state);
  switch (step) {
    case 'child-first':
      return child.firstName;
    case 'child-last':
      return child.lastName;
    case 'child-allergies':
      return child.allergies;
    case 'guardian-first':
      return state.guardian.firstName;
    case 'guardian-last':
      return state.guardian.lastName;
    case 'guardian-phone':
      return state.guardian.phone;
    // Stryker disable next-line StringLiteral: the grade has no buffer — it is
    // chosen off a grid — and no other step is reachable here.
    default:
      return '';
  }
}

/** The buffer written into whichever field the step on screen names. */
function commitAnswer(state: RegistrationState, value: string): RegistrationState {
  const child = currentChild(state);
  switch (state.step) {
    case 'child-first':
      return withChild(state, { ...child, firstName: value });
    case 'child-last':
      return withChild(state, { ...child, lastName: value });
    case 'child-allergies':
      // The tick and an empty box record the same answer, and the tick wins
      // where they could disagree: it is the one the parent can see.
      return withChild(state, { ...child, allergies: state.noAllergies ? '' : value });
    case 'guardian-first':
      return { ...state, guardian: { ...state.guardian, firstName: value } };
    case 'guardian-last':
      return { ...state, guardian: { ...state.guardian, lastName: value } };
    case 'guardian-phone':
      return { ...state, guardian: { ...state.guardian, phone: value } };
    // Stryker disable next-line StringLiteral: the grade is already on the
    // record — a chip put it there — and no other step reaches this.
    default:
      return state;
  }
}

/** Arriving at a question: its own answer in the buffer, ready to be changed. */
function landOn(
  state: RegistrationState,
  step: StepKind,
): Pick<RegistrationState, 'step' | 'buffer' | 'shift' | 'noAllergies' | 'gradePicked'> {
  const buffer = bufferFor(state, step);
  return {
    step,
    buffer,
    // A number pad has no capitals to offer; everything else opens where the
    // answer it is holding leaves off.
    shift: step === 'guardian-phone' ? 'off' : autoShiftAfter(buffer),
    // Reopened unticked whatever was answered: an empty box is the honest
    // reopening of "none", and it is one tap from ticked again.
    noAllergies: false,
    // A grade being reopened was answered once already, so Next is not dead.
    gradePicked: step === 'child-grade' ? true : state.gradePicked,
  };
}

/**
 * A question tapped in the list, reopened.
 *
 * The repair a parent actually needs. They are on the phone question and they
 * notice the surname is wrong — three screens back, already committed to a
 * banked child. Before this the only way there was Back four times, and Back
 * un-banks its way backwards, so fixing one letter meant walking the whole run
 * again forwards.
 *
 * Where they were is remembered rather than walked: `resume` brings **Next**
 * straight back, and Back on a reopened question is "never mind" — it returns
 * without committing. Only answered questions can be reopened; a question
 * nobody has reached is not a place to jump to, it is a hole.
 */
export function reopen(
  state: RegistrationState,
  step: StepKind,
  child: number | null,
): RegistrationState {
  const editing = child !== null && child < state.children.length ? child : null;
  if (step === state.step && editing === state.editing) return state;
  const moved = { ...state, editing, resume: state.resume ?? state.step };
  return { ...moved, ...landOn(moved, step) };
}

/** A child nobody has typed into yet, opened on this gathering's default. */
function blankDraft(state: RegistrationState): DraftChild {
  return {
    firstName: '',
    lastName: '',
    grade: defaultGrade(state.requiresCheckOut),
    allergies: '',
  };
}

/**
 * Commits the child on the draft and moves on.
 *
 * This used to be the "Anybody else?" screen's job. That screen asked every
 * family a question most of them answer "no" to, on a list the confirm screen
 * shows again four screens later — so it has gone, and the offer it carried now
 * stands beside the commit, where a parent looking at their own family is best
 * placed to notice somebody missing.
 */
function bankChild(state: RegistrationState, draft: DraftChild): RegistrationState {
  const step = stepAfterChildQuestions(state);
  return {
    ...state,
    children: [...state.children, draft],
    draft: blankDraft(state),
    step,
    backFromConfirm: step === 'confirm' ? lastChildQuestion(state) : state.backFromConfirm,
    buffer: '',
    shift: 'on',
    // Each child answers for themselves — see `noAllergies` and `gradePicked`.
    noAllergies: false,
    gradePicked: false,
  };
}

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

  /*
   * A question reopened out of order goes back where the parent was, with the
   * answer committed. Walking forward from here would make them re-confirm
   * every screen between the typo and the question they were on — five of them,
   * in front of a queue, to fix one letter.
   */
  if (state.resume !== null) {
    const committed = { ...commitAnswer(state, value), editing: null, resume: null };
    return { ...committed, ...landOn(committed, state.resume) };
  }

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
      return state.allergiesSupported
        ? {
            ...state,
            step: 'child-allergies',
            buffer: '',
            shift: 'on',
            // Each child answers for themselves — see `noAllergies`.
            noAllergies: false,
          }
        : bankChild(state, state.draft);
    case 'child-allergies':
      // The tick and an empty box record the same answer, and the tick wins
      // where they could disagree: it is the one the parent can see.
      return bankChild(state, {
        ...state.draft,
        allergies: state.noAllergies ? '' : value,
      });
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
        backFromConfirm: 'guardian-phone',
        buffer: '',
        shift: 'on',
      };
    // Stryker disable next-line ConditionalExpression: `canAdvance` is false for
    // every step this would catch — the confirm screen, the error —
    // so nothing reaches here. It is the same statement the guard at the top
    // makes, kept because the switch is over a union that will grow.
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

/**
 * The grade chips. `null` is 'No grade' — an answer, not a skip.
 *
 * A chip selects rather than advancing, now that the step carries **Next** and
 * the readout like every other one. It costs a tap per child and buys two
 * things: a console that is the same object on every screen, so the rule above
 * it never moves between questions, and a parent who can see the year they
 * picked before it is committed to a roster and a sticker.
 */
export function chooseGrade(
  state: RegistrationState,
  grade: Grade | null,
): RegistrationState {
  if (state.step !== 'child-grade') return state;
  return { ...withChild(state, { ...currentChild(state), grade }), gradePicked: true };
}

/**
 * 'Add another child' — the loop that makes this worth doing at a kiosk at all.
 *
 * A parent with three children walks it three times rather than queueing three
 * times. It is offered from the confirm screen, which is where the family is
 * written out and therefore where somebody missing is noticed; the run comes
 * back to the confirm when the new child's last question is answered.
 */
export function addAnotherChild(state: RegistrationState): RegistrationState {
  if (state.step !== 'confirm') return state;
  // The kiosk's cap and the server's. A seventh child is a leader's job.
  if (state.children.length >= MAX_CHILDREN) return state;
  return {
    ...state,
    draft: blankDraft(state),
    step: 'child-first',
    buffer: '',
    shift: 'on',
    gradePicked: false,
  };
}

/**
 * Back into the last child's own questions, which means un-banking them.
 *
 * `bankChild` commits the draft into `children` and mints a blank one, so every
 * step reachable *through* it stands on a state whose draft is empty. Walking
 * back without undoing that would reopen the allergy question of a child with
 * no name, and pressing on would bank that blank for real — the callable
 * refuses it on `parseName`, so a family who changed their mind once met "We
 * could not save that just now — please see a leader."
 *
 * So the way back is the exact inverse of the way forward: the last banked
 * child returns to the draft it was made from, with its own answer in the
 * buffer, and Back keeps walking from there into the name that was mistyped.
 */
function reopenLastChild(state: RegistrationState): RegistrationState {
  const banked = state.children[state.children.length - 1];
  // Stryker disable next-line ConditionalExpression,OptionalChaining: nothing
  // is reached from in front of the child questions without having banked a
  // child — `bankChild` is the only door and it always commits one. The
  // fallback is here so the function is total rather than resting on that.
  const undo = banked === undefined;
  const children = undo ? state.children : state.children.slice(0, -1);
  const draft = banked ?? state.draft;
  return state.allergiesSupported
    ? {
        ...state,
        children,
        draft,
        step: 'child-allergies',
        // The note as answered, reopened for editing — the same contract every
        // other reopened question keeps. Unticked whatever was answered: an
        // empty box is the honest reopening of "none", and it is one tap from
        // ticked again.
        buffer: draft.allergies,
        shift: autoShiftAfter(draft.allergies),
        noAllergies: false,
      }
    : {
        ...state,
        children,
        draft,
        step: 'child-grade',
        buffer: '',
        shift: 'on',
        // They answered it once; Next should not be dead on the way back.
        gradePicked: true,
      };
}


/* -------------------------------------------------------------------------- */
/* The list the wizard draws                                                   */
/* -------------------------------------------------------------------------- */

/** One question in the run, as the list shows it. */
export interface QuestionRow {
  /** Stable within a run — a React key, and the address of a tap. */
  id: string;
  /** The step this row is about; what reopening it would land on. */
  step: StepKind;
  /** Which child it belongs to, or null for the adult's three. */
  child: number | null;
  label: string;
  /** The committed answer. Empty on any row not answered yet. */
  answer: string;
  state: 'done' | 'now' | 'todo';
  /** Whether tapping it reopens the question. Only answered ones can be. */
  canReopen: boolean;
  /** The question the parent was on when they tapped away — where Next returns. */
  resumeHere: boolean;
}

export interface QuestionSection {
  title: string;
  rows: QuestionRow[];
}

const CHILD_STEPS = ['child-first', 'child-last', 'child-grade', 'child-allergies'] as const;
const CHILD_LABELS = ['First name', 'Last name', 'Grade', 'Allergies'] as const;
const ADULT_STEPS = ['guardian-first', 'guardian-last', 'guardian-phone'] as const;
const ADULT_LABELS = ['First name', 'Last name', 'Phone'] as const;

/** The grade as a row shows it — short, because the row is labelled "Grade". */
function gradeAnswer(grade: Grade | null): string {
  if (grade === null) return NO_GRADE;
  // `gradeDescription` says "4th grade", which under a label reading "Grade" is
  // the word twice. The two years with no number of their own keep their names.
  return grade === PRE_K || grade === 0 ? gradeDescription(grade) : ordinalGrade(grade);
}

function childAnswer(child: DraftChild, step: StepKind): string {
  switch (step) {
    case 'child-first':
      return child.firstName;
    case 'child-last':
      return child.lastName;
    case 'child-grade':
      return gradeAnswer(child.grade);
    // Stryker disable next-line StringLiteral: callers walk `CHILD_STEPS`, so
    // the only step that reaches here is the allergy note. Written out because
    // the union will grow.
    default:
      return child.allergies === '' ? 'None' : child.allergies;
  }
}

function adultAnswer(guardian: RegistrationState['guardian'], step: StepKind): string {
  switch (step) {
    case 'guardian-first':
      return guardian.firstName;
    case 'guardian-last':
      return guardian.lastName;
    // Stryker disable next-line StringLiteral: as `childAnswer` — callers walk
    // `ADULT_STEPS` and nothing else arrives.
    default:
      return formatPhone(guardian.phone);
  }
}

/**
 * Where a section stands: the index of the question being answered inside it,
 * or a whole section behind the parent, or one still in front of them.
 *
 * The two words are not expressible as an index. A section nobody has reached
 * is every row `todo`, and no position produces that — 0 would make the first
 * row the one being answered, on a section the parent has not arrived at.
 */
type SectionAt = number | 'behind' | 'ahead';

function runState(at: SectionAt, position: number): QuestionRow['state'] {
  if (at === 'behind') return 'done';
  if (at === 'ahead') return 'todo';
  return position < at ? 'done' : position === at ? 'now' : 'todo';
}

/**
 * What the readout shows: the answer being built, however it is being built.
 *
 * A grade is tapped rather than typed, and it lands in the same band as every
 * other answer — which is what that band is for. Empty until a chip is pressed,
 * so the gathering's default never shows as something a parent chose.
 */
export function readoutFor(state: RegistrationState): string {
  if (state.step === 'child-grade') {
    return state.gradePicked ? gradeAnswer(currentChild(state).grade) : '';
  }
  if (state.step === 'guardian-phone') return formatPhone(state.buffer);
  return state.buffer;
}

/**
 * Every question in the run, in the order it is asked.
 *
 * The wizard put one question on the glass and nothing else, which on an
 * upright tablet left a 664px hole — half the screen — between the question and
 * the keys. This is what fills it: what has been answered, what is being
 * answered, and what is still to come. A parent can see the shape of the thing
 * they are half way through, and check the name they typed forty seconds ago
 * without pressing Back four times to reach it.
 *
 * ## Order
 *
 * Chronological, which is not the same as grouped by person. A second child is
 * added from the confirm screen — after the adult — so the run reads: the first
 * child, then you, then anybody added later. Grouping the children would mean
 * the list reordering itself mid-run, and a list that holds still while the
 * highlight travels down it is most of why this works: nothing moves under a
 * thumb.
 *
 * ## What counts as answered
 *
 * Only what is behind the parent. A row not yet reached shows no answer even
 * where the record already holds one — the draft opens on this gathering's
 * default grade, and printing that beside "Grade" would tell a family they had
 * answered a question nobody asked them.
 */
/** Everything the list reads. Deliberately not the buffer — see the component. */
export type QuestionListState = Pick<
  RegistrationState,
  | 'step'
  | 'children'
  | 'draft'
  | 'guardian'
  | 'allergiesSupported'
  | 'mode'
  | 'editing'
  | 'resume'
>;

export function questionList(state: QuestionListState): QuestionSection[] {
  /*
   * Where the run is, which is not where the screen is once a row has been
   * tapped: `step` is then the question being fixed, and `resume` is the place
   * the parent will be put back. The list is drawn from the run, and the
   * reopened question is painted over it afterwards.
   */
  const at = state.resume ?? state.step;
  const onChild = isChildStep(at);
  const onAdult = isAdultStep(at);
  /* The draft is the last child of the run while its own questions are up. */
  const roster = onChild ? [...state.children, state.draft] : state.children;
  const current = onChild ? roster.length - 1 : -1;
  const childSteps: readonly StepKind[] = state.allergiesSupported
    ? CHILD_STEPS
    : CHILD_STEPS.slice(0, 3);
  const childAt: SectionAt = onChild ? childSteps.indexOf(at) : 'behind';
  /*
   * Off the adult's own steps the phone settles the section: it is the last of
   * the three, so having it means all three were answered — which is the case
   * for every child added after the first, since they are added from the
   * confirm screen.
   */
  const adultAt: SectionAt = onAdult
    ? ADULT_STEPS.indexOf(at as (typeof ADULT_STEPS)[number])
    : state.guardian.phone !== ''
      ? 'behind'
      : 'ahead';

  const sections: QuestionSection[] = [];
  roster.forEach((child, index) => {
    sections.push({
      title: index === 0 ? 'Your child' : `Child ${index + 1}`,
      rows: childSteps.map((step, position) => {
        const rowState = runState(index === current ? childAt : 'behind', position);
        return {
          id: `child-${index}-${step}`,
          step,
          child: index,
          label: CHILD_LABELS[position]!,
          answer: rowState === 'done' ? childAnswer(child, step) : '',
          state: rowState,
          canReopen: rowState === 'done',
          resumeHere: false,
        };
      }),
    });
    // The adult sits after the first child and before any later one, because
    // that is where they are asked about. A sibling run never asks at all.
    if (index === 0 && state.mode === 'family') {
      sections.push({
        title: 'And you',
        rows: ADULT_STEPS.map((step, position) => {
          const rowState = runState(adultAt, position);
          return {
            id: `adult-${step}`,
            step,
            child: null,
            label: ADULT_LABELS[position]!,
            answer: rowState === 'done' ? adultAnswer(state.guardian, step) : '',
            state: rowState,
            canReopen: rowState === 'done',
            resumeHere: false,
          };
        }),
      });
    }
  });

  if (state.resume === null) return sections;

  /*
   * A row has been tapped. The question being fixed wears the accent, and the
   * one the parent was on is marked rather than lit — it is still unanswered,
   * and it is where **Next** will put them back.
   */
  const openChild = isChildStep(state.step) ? (state.editing ?? current) : null;
  const resumeChild = onChild ? current : null;
  return sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => {
      if (row.step === state.step && row.child === openChild) {
        return { ...row, state: 'now' as const, canReopen: false };
      }
      if (row.step === at && row.child === resumeChild) {
        return { ...row, state: 'todo' as const, canReopen: false, resumeHere: true };
      }
      return row;
    }),
  }));
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
  /*
   * "Never mind." Back out of a question that was reopened out of order and the
   * answer that was already on the record stays on it — the parent goes back to
   * where they were rather than into the run behind the question they tapped.
   */
  if (state.resume !== null) {
    const cancelled = { ...state, editing: null, resume: null };
    return { ...cancelled, ...landOn(cancelled, state.resume) };
  }

  switch (state.step) {
    case 'child-first':
      /*
       * The first question of a run has nowhere back and closes the wizard;
       * the first question of a child *added from the confirm* goes back to the
       * confirm, abandoning the half-typed child rather than the registration.
       */
      return state.children.length > 0
        ? { ...state, step: 'confirm', buffer: '', shift: 'on' }
        : null;
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
      return { ...state, step: 'child-grade', buffer: '', shift: 'on', gradePicked: true };
    case 'guardian-first':
      return reopenLastChild(state);
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
      // Whichever question was answered to get here — see `backFromConfirm`.
      return state.backFromConfirm === 'guardian-phone'
        ? {
            ...state,
            step: 'guardian-phone',
            buffer: state.guardian.phone,
            shift: 'off',
          }
        : reopenLastChild(state);
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

