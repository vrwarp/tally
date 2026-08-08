/**
 * "First time here?" — the other door off the search screen.
 *
 * Everything a family needs to join the roster, asked one question at a time in
 * the frame the search screen already uses: a header, a body, then the readout
 * and the kiosk's own keyboard together at the bottom. Nothing here focuses an
 * input, for the same reason nothing on the search screen does — the device's
 * native keyboard is slow to raise and covers half the questions when it does.
 *
 * The wizard is deliberately short. Three questions per child — four where the
 * church's database can hold an allergy note, and the fourth is one tap for
 * the families it does not apply to — three about one adult, and a confirm.
 * Emails and second guardians are still not here: this is the same bargain the
 * staff quick-add makes — enough to put somebody on the roster and reach their
 * family, with the incomplete profile as the handoff to whoever follows up. A
 * lobby form that asks for everything is a lobby form nobody finishes.
 *
 * The allergies question exists at all because the phone form that used to
 * collect it is retired; it is gated on the binding's `allergiesSupported`,
 * which is the same write-back check that form made before showing its field.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { gradeDescription, haptic, NO_GRADE } from '@/lib/utils';
import { GRADES, type Grade, type RegisterFamilyResult } from '@/types';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import type { KioskBinding } from '../binding';
import { PhonePad } from './PhonePad';
import {
  advance,
  answerAnother,
  applyKey,
  canAdvance,
  chooseGrade,
  familyOf,
  formatPhone,
  goBack,
  initialState,
  isTypingStep,
  MAX_CHILDREN,
  toggleNoAllergies,
  type DraftChild,
  type RegistrationMode,
  type RegistrationState,
} from './steps';

/**
 * How long a half-typed registration is left on the glass.
 *
 * A family who walks away mid-wizard — called into the service, distracted by a
 * toddler — must not leave their child's half-typed name greeting the next
 * person at the screen. Ninety seconds is well past a slow typist on one
 * question and well short of the queue behind them.
 */
const INACTIVITY_MS = 90_000;

/**
 * Longer than the check-in tick's four seconds, because this screen ends with a
 * number somebody has to remember.
 */
const SUCCESS_AUTO_RETURN_MS = 8_000;

type Action =
  | { type: 'key'; key: KioskKey }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'grade'; grade: Grade | null }
  | { type: 'another'; more: boolean }
  | { type: 'no-allergies' }
  | { type: 'submitting' }
  | { type: 'submitted'; result: RegisterFamilyResult }
  | { type: 'failed' };

function makeReducer(requiresCheckOut: boolean) {
  return function reduce(state: RegistrationState, action: Action): RegistrationState {
    switch (action.type) {
      case 'key':
        return applyKey(state, action.key);
      case 'next':
        return advance(state);
      case 'back':
        return goBack(state) ?? state;
      case 'grade':
        return chooseGrade(state, action.grade);
      case 'another':
        return answerAnother(state, action.more, requiresCheckOut);
      case 'no-allergies':
        return toggleNoAllergies(state);
      case 'submitting':
        return { ...state, step: 'submitting', message: '' };
      case 'submitted':
        return { ...state, step: 'success', last4: action.result.last4 };
      case 'failed':
        return {
          ...state,
          step: 'error',
          message: 'We could not save that just now — please see a leader.',
        };
    }
  };
}

export interface RegistrationFlowProps {
  binding: KioskBinding;
  /** Minted by the caller so a remount cannot re-mint it mid-run. */
  registrationId: string;
  /**
   * `sibling` when the parent got here from their own family's row, so the
   * adult's three questions are skipped and `anchors` says who they are.
   */
  mode?: RegistrationMode;
  /** The siblings already on the roster, in sibling mode. Named on the confirm. */
  anchors?: readonly { id: string; firstName: string; lastName: string }[];
  submit: (args: {
    registrationId: string;
    children: DraftChild[];
    guardian: { firstName: string; lastName: string; phone: string } | null;
    anchorStudentIds: string[];
  }) => Promise<RegisterFamilyResult>;
  /** Everybody registered and checked in — the caller greens their rows and prints. */
  onRegistered: (result: RegisterFamilyResult) => void;
  /** Back to search: cancelled, timed out, or finished. */
  onClose: () => void;
}

export function RegistrationFlow({
  binding,
  registrationId,
  mode = 'family',
  anchors,
  submit,
  onRegistered,
  onClose,
}: RegistrationFlowProps) {
  // Absent on a binding written before the flag existed, and absent means no.
  const tracksCheckOut = binding.requiresCheckOut ?? false;
  const reduce = useMemo(() => makeReducer(tracksCheckOut), [tracksCheckOut]);
  const [state, dispatch] = useReducer(
    reduce,
    {
      registrationId,
      requiresCheckOut: tracksCheckOut,
      mode,
      // Absent on a binding written before the flag existed, and absent means
      // "don't ask" — the question is only safe where the answer can land.
      allergiesSupported: binding.allergiesSupported ?? false,
    },
    initialState,
  );
  const anchorIds = useMemo(() => (anchors ?? []).map((sibling) => sibling.id), [anchors]);

  const onKey = useCallback((key: KioskKey) => dispatch({ type: 'key', key }), []);

  /* ---- Walked away ------------------------------------------------------- */

  useEffect(() => {
    // Never while the call is in flight, and never on the screen teaching the
    // family their digits — that one returns on its own clock below.
    if (state.step === 'submitting' || state.step === 'success') return;
    const timer = setTimeout(onClose, INACTIVITY_MS);
    return () => clearTimeout(timer);
  }, [state, onClose]);

  /* ---- The call ---------------------------------------------------------- */

  const submittedRef = useRef(false);
  const runSubmit = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    haptic();
    dispatch({ type: 'submitting' });
    void submit({
      registrationId: state.registrationId,
      children: state.children,
      // Null in sibling mode, and the server refuses that unless the anchors
      // it verifies say which family this is.
      guardian: state.mode === 'sibling' ? null : state.guardian,
      anchorStudentIds: state.mode === 'sibling' ? anchorIds : [],
    })
      .then((result) => {
        // A retry re-sends the same registrationId, which is what makes the
        // callable answer rather than create a second family.
        submittedRef.current = false;
        dispatch({ type: 'submitted', result });
        onRegistered(result);
      })
      .catch(() => {
        submittedRef.current = false;
        dispatch({ type: 'failed' });
      });
  }, [
    submit,
    state.registrationId,
    state.children,
    state.guardian,
    state.mode,
    anchorIds,
    onRegistered,
  ]);

  useEffect(() => {
    if (state.step !== 'success') return;
    const timer = setTimeout(onClose, SUCCESS_AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, [state.step, onClose]);

  /* ---- Render ------------------------------------------------------------ */

  const family = familyOf(state);
  const childNumber = state.children.length + 1;

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto_auto]">
      <Header
        title={titleFor(state, childNumber)}
        subtitle={subtitleFor(state, binding)}
        onBack={() => {
          haptic(8);
          if (goBack(state) === null) onClose();
          else dispatch({ type: 'back' });
        }}
        canClose={state.step !== 'submitting'}
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain scroll-touch px-6">
        {/*
          * On a typing step the body hangs from the bottom of its region
          * rather than the top, so that what a step puts here — today, the
          * "No allergies" tick — stays against the readout it belongs to.
          * The readout moved down to the keyboard (see below) and this is the
          * half of that move that keeps the step whole: a question, its answer
          * and the keys in one block under the hand, instead of one control
          * marooned under the header.
          *
          * `mt-auto` rather than `justify-end`, because this region scrolls:
          * an auto margin collapses to nothing once the content is taller than
          * the box, where end-justified content would push its own top out of
          * reach.
          */}
        <div
          className={`mx-auto flex w-full max-w-2xl flex-col gap-3 pb-2 ${
            isTypingStep(state.step) ? 'mt-auto' : ''
          }`}
        >
          {/*
            * The question, where the search screen puts "Type a name" and for
            * the same reasons.
            *
            * It lived only in the header: fourteen pixels of `ink-500` — 4.24:1,
            * under the AA floor — at the opposite end of the screen from the
            * hand, and it was the single thing distinguishing step two of this
            * wizard from step five. Six steps run in sequence with the same
            * frame, the same keyboard and the same empty readout; a parent who
            * loses the thread in a dim lobby types a guardian's name into a
            * child's last-name field, and that lands in the review queue for a
            * leader to judge.
            *
            * The field's own name rather than the header's conversational
            * question, because that is the half that is specific: "So we know
            * who brought them" does not say whose last name this is, and "Your
            * last name" does.
            */}
          {isTypingStep(state.step) && (
            <div className="pb-2 text-center text-3xl font-semibold text-ink-100 kiosk:text-4xl">
              {placeholderFor(state)}
            </div>
          )}
          {state.step === 'child-grade' && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              <GradeChip label={NO_GRADE} onPick={() => dispatch({ type: 'grade', grade: null })} />
              {GRADES.map((grade) => (
                <GradeChip
                  key={grade}
                  label={grade === 0 ? 'K' : String(grade)}
                  hint={gradeDescription(grade)}
                  onPick={() => dispatch({ type: 'grade', grade })}
                />
              ))}
            </div>
          )}

          {state.step === 'child-allergies' && (
            /*
              * The way to say "nothing", where the typing would have started.
              *
              * Directly above the readout on purpose — the body hangs from the
              * bottom on typing steps so that it lands there. **Next** already
              * offers the same answer, but a parent reading "any allergies we
              * should know about?" is looking at the readout and the keys, not
              * at a button above them — which is why the field was collecting
              * "None", "N/A" and "no allergies" as though they were medical
              * notes. Three spellings of a blank, bound for the church's
              * database.
              *
              * A checkbox rather than a third button: it reports a state the
              * parent can see they are in, and a button that had already been
              * pressed would look exactly like one that had not.
              */
            <div className="pt-2">
              <button
                type="button"
                tabIndex={-1}
                role="checkbox"
                aria-checked={state.noAllergies}
                onPointerDown={() => {
                  haptic();
                  dispatch({ type: 'no-allergies' });
                }}
                className={`flex h-16 w-full items-center gap-4 rounded-xl px-5 text-left text-xl font-semibold ${
                  state.noAllergies
                    ? 'bg-brand-600/15 text-brand-300 ring-1 ring-brand-500/40'
                    : 'bg-ink-900 text-ink-200 active:bg-ink-700'
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg ${
                    state.noAllergies
                      ? 'bg-brand-500 text-white'
                      : 'ring-2 ring-ink-600'
                  }`}
                >
                  {state.noAllergies ? '✓' : ''}
                </span>
                No allergies
              </button>
            </div>
          )}

          {state.step === 'another' && (
            <div className="flex flex-col gap-3 pt-2">
              {/*
                * Who is on the list so far, above the two buttons.
                *
                * The question is "anybody else?", and a parent cannot answer it
                * against their own memory of what they typed forty seconds ago
                * — least of all the parent of four, which is exactly the parent
                * this loop exists for. Naming them also catches the mistake
                * this screen is otherwise the last chance to catch: a child
                * entered twice, or the one whose name went in wrong.
                */}
              <div className="flex flex-col gap-2">
                {family.map((child, index) => (
                  <ChildRow key={`${child.firstName}-${child.lastName}-${index}`} child={child} />
                ))}
              </div>
              <Big
                label="Add another child"
                disabled={family.length >= MAX_CHILDREN}
                onPick={() => dispatch({ type: 'another', more: true })}
              />
              <Big label="That's everyone" tone="brand" onPick={() => dispatch({ type: 'another', more: false })} />
              {family.length >= MAX_CHILDREN && (
                <p className="text-center text-base text-ink-500">
                  That is as many as one go takes — a leader can add the rest.
                </p>
              )}
            </div>
          )}

          {state.step === 'confirm' && (
            <div className="flex flex-col gap-2 pt-2">
              {state.children.map((child, index) => (
                <ChildRow key={`${child.firstName}-${child.lastName}-${index}`} child={child} />
              ))}
              {state.mode === 'sibling' ? (
                /*
                  Who this child is being added to. The kiosk guessed the family
                  from four digits (see family.ts for how much of a guess that
                  is), so the guess goes on the glass above the button rather
                  than staying in the request — a parent looking at a stranger's
                  children in their own confirmation cannot miss it.
                */
                <p className="px-1 pt-1 text-base text-ink-400">
                  {anchors && anchors.length > 0
                    ? `Joining ${anchors.map((sibling) => sibling.firstName).join(', ')}.`
                    : 'Joining your family.'}
                </p>
              ) : (
                <div className="flex h-16 items-center justify-between rounded-xl bg-ink-900/60 px-5">
                  <span className="truncate text-lg text-ink-300">
                    {state.guardian.firstName} {state.guardian.lastName}
                  </span>
                  <span className="pl-3 text-base whitespace-nowrap text-ink-500">
                    {formatPhone(state.guardian.phone)}
                  </span>
                </div>
              )}
            </div>
          )}

          {state.step === 'submitting' && (
            <p className="pt-10 text-center text-xl text-ink-400">Saving…</p>
          )}

          {state.step === 'success' && (
            <div className="flex flex-col items-center gap-4 pt-6 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-present-600/20 text-5xl">
                ✓
              </div>
              <p className="text-2xl font-semibold text-ink-100">{welcomeLine(state.children)}</p>
              {/* The whole handoff, in one sentence: this is how they find
                  themselves next week without anybody's help. */}
              <p className="text-xl text-ink-400">
                Next time, just type{' '}
                <span className="font-semibold tracking-widest text-ink-100">{state.last4}</span> —
                the last 4 digits of your phone.
              </p>
            </div>
          )}

          {state.step === 'error' && (
            <div className="flex flex-col gap-4 pt-6 text-center">
              <p className="text-xl text-ink-200">{state.message}</p>
              <Big label="Try again" tone="brand" onPick={runSubmit} />
            </div>
          )}
        </div>
      </div>

      {/*
        * The same rule the search screen draws, because it is a property of the
        * console rather than of that screen. Below it: the action, the readout
        * and the keys. A parent learns to read that object as the thing they
        * operate, and one tap later it used to dissolve — the two screens
        * differ only in their bottom third, so a missing edge was the most
        * noticeable change between them, and it made the step a parent had just
        * chosen look less structured than the screen they chose it from.
        */}
      <div className="border-t border-ink-800/70" />

      {/* The bottom row: the readout and the keyboard where something is being
          typed, the one action that ends the step where it is not. */}
      {isTypingStep(state.step) ? (
        <div className="flex flex-col gap-1.5">
          <div className="px-2">
            {/*
              * Always "Next" on the allergies step, now that the tick above
              * the keyboard says "No allergies".
              *
              * This button used to carry that label itself while the box was
              * empty, which made one answer into two controls a hand's width
              * apart — and put the quieter of them under forty keys, where a
              * parent reading the question is not looking. The tick took the
              * job because it took the better place; leaving the label here as
              * well would only ask which one is the real one.
              *
              * An empty box still means none, ticked or not: this is an
              * optional question and pressing Next past it has always been an
              * answer rather than a skip.
              */}
            <Big
              label="Next"
              tone="brand"
              disabled={!canAdvance(state)}
              onPick={() => dispatch({ type: 'next' })}
            />
          </div>
          {/*
            * The readout, between the button that ends the step and the keys
            * that fill it. A div, never an input.
            *
            * It sat under the header until now, which put a parent's eyes and
            * a parent's hands at opposite ends of an upright screen: they type
            * a child's name at the bottom edge and it appears four hundred
            * pixels away, so the letters they are checking cannot be seen
            * without looking up off the keys. Here it is where every phone
            * puts it — on top of the keyboard, in the same glance as the
            * thumb.
            *
            * No fill, no border, no rounded corners, for the same reason the
            * search screen's has none: a box on a touchscreen is a text field,
            * and a parent taps a text field before typing into it. There is
            * nothing here to focus and nothing would happen. Bare text says
            * "this is where the letters land" without promising a press.
            *
            * It also lands between the big brand-coloured **Next** and the top
            * row of keys, which is the one place on this screen a thumb
            * reaching for '1' could commit the step by accident. An inert band
            * is a good thing to have there.
            */}
          <div
            className={`px-6 pb-1 ${
              // Ticked "No allergies" empties the readout and puts it out of
              // use. Dimming rather than hiding: the question was asked and
              // answered in the negative, and a readout that vanished would
              // read as a question that went away.
              state.noAllergies ? 'opacity-40' : ''
            }`}
          >
            <div className="mx-auto flex h-16 max-w-2xl items-center justify-center px-4">
              {/* Letters only, and empty until there are some. The search screen
                  teaches a parent two taps earlier that the bold word above the
                  keys is what *they* typed; a placeholder sitting in that slot
                  read as something a previous family had already entered. What
                  the box is for is said above it, at size. */}
              {state.buffer && (
                <span className="truncate text-3xl font-semibold tracking-wide text-ink-50 kiosk:text-4xl">
                  {state.step === 'guardian-phone' ? formatPhone(state.buffer) : state.buffer}
                </span>
              )}
            </div>
          </div>
          {/* The one question on this screen that is a number gets the shape
              everybody already knows for one. See PhonePad. */}
          {state.step === 'guardian-phone' ? (
            <PhonePad onKey={onKey} />
          ) : (
            /*
              * Greyed and inert while "No allergies" is ticked. The keys stay
              * where they are rather than leaving: this file's geometry does
              * not move under a thumb, and a keyboard that vanished mid-step
              * would take the parent's place on the screen with it.
              */
            <div
              className={state.noAllergies ? 'pointer-events-none opacity-40' : undefined}
              aria-hidden={state.noAllergies || undefined}
            >
              <Keyboard onKey={onKey} shift={state.shift} />
            </div>
          )}
        </div>
      ) : state.step === 'confirm' ? (
        <div className="p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))]">
          <Big
            label={state.children.length === 1 ? 'Check in' : 'Check in everyone'}
            tone="brand"
            onPick={runSubmit}
          />
        </div>
      ) : state.step === 'success' ? (
        <div className="p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))]">
          <Big label="Done" onPick={onClose} />
        </div>
      ) : (
        <div className="h-4" />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function Header({
  title,
  subtitle,
  onBack,
  canClose,
  onClose,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  canClose: boolean;
  onClose: () => void;
}) {
  return (
    <div className="relative px-6 pt-[max(1rem,var(--spacing-safe-top))] pb-2 text-center">
      <button
        type="button"
        tabIndex={-1}
        onPointerDown={onBack}
        className="absolute top-[max(0.75rem,var(--spacing-safe-top))] left-4 h-12 rounded-lg px-3 text-base text-ink-400 active:bg-ink-800"
      >
        ← Back
      </button>
      {canClose && (
        <button
          type="button"
          tabIndex={-1}
          onPointerDown={onClose}
          className="absolute top-[max(0.75rem,var(--spacing-safe-top))] right-4 h-12 rounded-lg px-3 text-base text-ink-500 active:bg-ink-800"
        >
          Cancel
        </button>
      )}
      <div className="text-lg font-semibold text-ink-200">{title}</div>
      <div className="text-sm text-ink-400 kiosk:text-base">{subtitle}</div>
    </div>
  );
}

/** One child as the wizard has them: the name, the grade, and any note. */
function ChildRow({ child }: { child: DraftChild }) {
  return (
    <div className="flex min-h-16 flex-col justify-center rounded-xl bg-ink-900 px-5 py-2.5">
      <div className="flex items-center justify-between">
        <span className="truncate text-xl font-semibold text-ink-100">
          {child.firstName} {child.lastName}
        </span>
        <span className="pl-3 text-base whitespace-nowrap text-ink-400">
          {child.grade === null ? NO_GRADE : gradeDescription(child.grade)}
        </span>
      </div>
      {/*
        * On the roster rows a warn-tone dot is all the kiosk shows; here the
        * note itself is printed, because this list is the family checking
        * their own typing — the one moment the person reading it is the
        * person who wrote it, before it becomes a record a reviewer acts on.
        */}
      {child.allergies !== '' && (
        <div className="truncate text-base text-warn-400">Allergies: {child.allergies}</div>
      )}
    </div>
  );
}

function Big({
  label,
  onPick,
  tone,
  disabled,
}: {
  label: string;
  onPick: () => void;
  tone?: 'brand';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      onPointerDown={() => {
        if (disabled) return;
        haptic();
        onPick();
      }}
      className={`flex h-16 w-full items-center justify-center rounded-xl text-xl font-semibold ${
        disabled
          ? 'bg-ink-900 text-ink-600'
          : tone === 'brand'
            ? 'bg-brand-600 text-white active:bg-brand-500'
            : 'bg-ink-800 text-ink-100 active:bg-ink-600'
      }`}
    >
      {label}
    </button>
  );
}

function GradeChip({ label, hint, onPick }: { label: string; hint?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={hint ?? label}
      onPointerDown={() => {
        haptic();
        onPick();
      }}
      className="flex h-16 items-center justify-center rounded-xl bg-ink-800 text-xl font-semibold text-ink-100 active:bg-ink-600"
    >
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Words                                                                       */
/* -------------------------------------------------------------------------- */

function titleFor(state: RegistrationState, childNumber: number): string {
  switch (state.step) {
    case 'child-first':
    case 'child-last':
    case 'child-grade':
    case 'child-allergies':
      return state.mode === 'sibling' && childNumber === 1
        ? // Not "their brother or sister". The kiosk infers kinship from four
          // phone digits, and this wizard is reached from the screen that
          // exists for everyone that inference is wrong about — a cousin, a
          // neighbour's boy, a child on a different number. The same words as
          // the button that started this, which is the only relationship the
          // kiosk can actually vouch for: they are arriving together.
          'Another child'
        : childNumber === 1
          ? 'Your child'
          : `Child ${childNumber}`;
    case 'another':
      return 'Anybody else?';
    case 'guardian-first':
    case 'guardian-last':
    case 'guardian-phone':
      return 'And you';
    case 'confirm':
      return 'Does this look right?';
    case 'submitting':
      return 'One moment';
    case 'success':
      return 'All done';
    case 'error':
      return 'Something went wrong';
  }
}

function subtitleFor(state: RegistrationState, binding: KioskBinding): string {
  switch (state.step) {
    case 'child-first':
      return 'What is their first name?';
    case 'child-last':
      return 'And their last name?';
    case 'child-grade':
      return 'What grade are they in?';
    case 'child-allergies':
      // "we should know about" and not "do they have": a parent whose child's
      // hay fever is nobody's business at a check-in desk is being invited to
      // skip, not interrogated.
      return 'Any allergies we should know about?';
    case 'another':
      return 'You can add the whole family in one go.';
    /*
     * The adult's two steps share one line, and it is context rather than a
     * label: the readout under it already says "Your first name". A subtitle
     * that repeated the placeholder would be the same words twice on a screen
     * with four lines of text on it.
     */
    case 'guardian-first':
    case 'guardian-last':
      return 'So we know who brought them.';
    case 'guardian-phone':
      // Said before the number is typed rather than after: a parent wants to
      // know why it is being asked for while they decide whether to give it.
      return 'This is how you check in next time.';
    case 'confirm':
      return binding.title;
    default:
      return '';
  }
}

/**
 * What the empty readout says.
 *
 * The field's own name, not "Type here" — which repeated the shape of the
 * screen back at somebody and named nothing. It matters most on the two steps
 * where the question above and the answer below could belong to either person
 * in the room: "Child's last name" and "Your last name" are the same box until
 * one of them says which.
 */
function placeholderFor(state: RegistrationState): string {
  switch (state.step) {
    case 'child-first':
      return "Child's first name";
    case 'child-last':
      return "Child's last name";
    case 'child-allergies':
      return 'Allergies';
    case 'guardian-first':
      return 'Your first name';
    case 'guardian-last':
      return 'Your last name';
    case 'guardian-phone':
      return 'Your phone number';
    default:
      return '';
  }
}

/**
 * "Robin, Sam and Alex are checked in. Welcome!"
 *
 * Built as one string rather than assembled from JSX so the sentence is one
 * text node — a family reads it as a sentence, and so does anything testing
 * that it says what it should.
 */
function welcomeLine(children: readonly DraftChild[]): string {
  const names = children.map((child) => child.firstName);
  const list =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? 'is' : 'are'} checked in. Welcome!`;
}
