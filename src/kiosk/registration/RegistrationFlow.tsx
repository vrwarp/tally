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
import { memo, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { gradeDescription, haptic, NO_GRADE } from '@/lib/utils';
import { GRADES, PRE_K, type Grade, type RegisterFamilyResult } from '@/types';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import type { KioskBinding } from '../binding';
import { PhonePad } from './PhonePad';
import { useTap } from '../components/tapGuard';
import {
  addAnotherChild,
  advance,
  applyKey,
  canAdvance,
  chooseGrade,
  formatPhone,
  goBack,
  initialState,
  isTypingStep,
  MAX_CHILDREN,
  questionList,
  readoutFor,
  reopen,
  type QuestionListState,
  type QuestionRow,
  toggleNoAllergies,
  type DraftChild,
  type RegistrationMode,
  type RegistrationState,
  type StepKind,
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
  | { type: 'add-child' }
  | { type: 'reopen'; step: StepKind; child: number | null }
  | { type: 'no-allergies' }
  | { type: 'submitting' }
  | { type: 'submitted'; result: RegisterFamilyResult }
  | { type: 'failed' };

/*
 * A plain function, not a factory. It used to close over `requiresCheckOut` for
 * the fork's sake; the gathering's grade default now lives on the state, where
 * banking a child can reach it.
 */
function reduce(state: RegistrationState, action: Action): RegistrationState {
  switch (action.type) {
    case 'key':
      return applyKey(state, action.key);
    case 'next':
      return advance(state);
    case 'back':
      return goBack(state) ?? state;
    case 'grade':
      return chooseGrade(state, action.grade);
    case 'add-child':
      return addAnotherChild(state);
    case 'reopen':
      return reopen(state, action.step, action.child);
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
  /* Stable, so the list's memo holds across a keystroke. */
  const reopenRow = useCallback((step: StepKind, child: number | null) => {
    haptic(8);
    dispatch({ type: 'reopen', step, child });
  }, []);
  const tap = useTap();

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

  /* Whose questions are on screen: the child being added, or — when a row has
     been tapped to fix it — the child that row belongs to. */
  const childNumber = (state.editing ?? state.children.length) + 1;
  /* Every step that asks a question: the list above, the console below. */
  const showsList = isTypingStep(state.step) || state.step === 'child-grade';

  /*
   * A long family scrolls, and the end of the list is what a parent wants —
   * the child they are entering now, against the question they are answering.
   * Per step rather than per keystroke: nothing in the list changes while a
   * name is being typed.
   */
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.step, state.children.length]);

  return (
    /* The column is the glass, never its widest item. A name typed to
        NAME_MAX_LENGTH sits truncated in the readout, and truncation clips a
        box whose minimum is still the whole name — which, as the minimum of
        an auto track, widened the header, the body and the keys past a phone.
        See the same rule on the search screen's root for the mechanism. */
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto]">
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

      {/*
        * The body is the run, written out.
        *
        * One question on the glass and nothing else left a 664px hole on an
        * upright tablet — half the screen — between the question and the keys
        * that answer it. What fills it is the list: what has been answered,
        * what is being answered now, and what is still to come. It replaced the
        * "Anybody else?" screen's job of forewarning and the line that stood in
        * for it, and it gives a parent somewhere to look that is not a void.
        *
        * The list scrolls and the question does not: `questionFor` is a sibling
        * of the scroll box, not a child of it, so it stays against the console
        * however long a family gets.
        */}
      <div className="flex min-h-0 flex-col px-6">
        {showsList ? (
          <>
            <div
              ref={listRef}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scroll-touch"
            >
              {/* `mt-auto` rather than `justify-end`: an auto margin collapses
                  to nothing once the content is taller than the box, where
                  end-justified content would push its own top out of reach. */}
              <div className="mx-auto mt-auto flex w-full max-w-2xl flex-col gap-2 pt-2 pb-1">
                <QuestionStack
                  step={state.step}
                  roster={state.children}
                  draft={state.draft}
                  guardian={state.guardian}
                  allergiesSupported={state.allergiesSupported}
                  mode={state.mode}
                  editing={state.editing}
                  resume={state.resume}
                  onReopen={reopenRow}
                />
              </div>
            </div>
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
            <div className="mx-auto w-full max-w-2xl pt-2">
              <button
                type="button"
                tabIndex={-1}
                role="checkbox"
                aria-checked={state.noAllergies}
                {...tap(() => {
                  haptic();
                  dispatch({ type: 'no-allergies' });
                })}
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

            {/*
              * The question, against the keys that answer it.
              *
              * It was at the top of this region, which on a portrait tablet put
              * it six hundred pixels above the thing a parent presses to answer
              * it. Said here as well as in the list above — deliberately: the
              * row in the list is the index, saying where somebody is in the
              * run and what they can go back and fix; this is the question, in
              * the same glance as the thumb.
              */}
            <div className="mx-auto w-full max-w-2xl pt-3 pb-1 text-center text-2xl font-semibold text-ink-100 kiosk:text-3xl">
              {questionFor(state)}
            </div>
          </>
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-3 pb-2">
          {state.step === 'confirm' && (
            /* Against the commit, not stranded a screen above it. This is the
               last thing a parent reads before a record goes upstream, and on a
               portrait tablet the list of their own children sat a thousand
               pixels from the button that files it. */
            <div className="mt-auto flex flex-col gap-2 pt-2">
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
        )}
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

      {/* The bottom row: the readout and whatever fills it — letters, digits or
          the grade chips — with the action that ends the step above them. The
          same object on every question, which is what keeps the rule above it
          from moving between steps. */}
      {showsList ? (
        <div className="flex flex-col gap-1.5">
          <div className="px-2 pt-2">
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
              {/* The answer so far, however it is being given — typed, dialled
                  or tapped off a chip. Empty until there is one: the search
                  screen teaches a parent two taps earlier that the bold word
                  above the keys is what *they* entered, and a placeholder
                  sitting in that slot read as something a previous family had
                  already put there. What the box is for is said above it. */}
              {readoutFor(state) && (
                <span className="truncate text-3xl font-semibold tracking-wide text-ink-50 kiosk:text-4xl">
                  {readoutFor(state)}
                </span>
              )}
              {/* Where the next letter lands, so the band reads as a live field
                  rather than as a gap. Only where something is typed — a grade
                  is chosen off a grid, and a caret blinking beside it would
                  promise a keyboard that is not there. See `.kiosk-caret`. */}
              {isTypingStep(state.step) && (
                <span
                  aria-hidden
                  data-testid="readout-caret"
                  className={`kiosk-caret${state.noAllergies ? ' kiosk-caret--still' : ''}`}
                />
              )}
            </div>
          </div>
          {/* The one question that is a number gets the shape everybody already
              knows for one; the one that is a year gets a grid of years. Both
              stand where the keyboard stands, in the keyboard's own footprint,
              because they are that question's keys. */}
          {state.step === 'guardian-phone' ? (
            <PhonePad onKey={onKey} />
          ) : state.step === 'child-grade' ? (
            <GradeChips
              grade={state.draft.grade}
              picked={state.gradePicked}
              onPick={(grade) => dispatch({ type: 'grade', grade })}
            />
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
        <div className="flex flex-col gap-2 p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))]">
          {/*
            * The offer the fork used to carry, in the shape it carried it —
            * the quiet button above the brand one, so a parent who learned that
            * pair on the old screen meets the same pair here.
            *
            * It belongs on this screen rather than on one of its own: "anybody
            * else?" cannot be answered from memory, and this is where the
            * family is written out. A parent notices a missing child by reading
            * the list, not by being asked about it four screens earlier.
            */}
          <Big
            label="Add another child"
            disabled={state.children.length >= MAX_CHILDREN}
            onPick={() => dispatch({ type: 'add-child' })}
          />
          <Big
            label={state.children.length === 1 ? 'Check in' : 'Check in everyone'}
            tone="brand"
            onPick={runSubmit}
          />
          {state.children.length >= MAX_CHILDREN && (
            <p className="text-center text-base text-ink-500">
              That is as many as one go takes — a leader can add the rest.
            </p>
          )}
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
  const tap = useTap();

  return (
    /*
     * Three slots, not a centred title with two controls floated over it.
     *
     * Absolutely positioned, Back and Cancel were outside the title's layout,
     * so a long title simply painted across them: "Does this look right?" needs
     * 282px on a 390px phone and the gap between the two controls is 238, which
     * obliterated the last two letters of **Back** and the first two of
     * **Cancel**. That is the confirm step — the last screen before a family
     * record goes upstream and cannot be taken back — and Back is the only
     * repair a parent who spots a wrong name has. A control that reads as
     * broken at the moment it is needed is worse than one that is not there.
     *
     * The side columns are reserved now and the title wraps inside what is
     * left, which is what the search header already does with a long gathering
     * name.
     */
    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-1 px-2 pt-[max(0.75rem,var(--spacing-safe-top))] pb-2">
      <button
        type="button"
        tabIndex={-1}
        {...tap(onBack)}
        className="h-12 rounded-lg px-3 text-sm text-ink-400 active:bg-ink-800"
      >
        ← Back
      </button>
      <div className="min-w-0 pt-1 text-center">
        <div className="text-2xl font-semibold text-balance text-ink-100 kiosk:text-3xl">{title}</div>
        <div className="truncate text-base text-ink-500 kiosk:text-lg">{subtitle}</div>
      </div>
      {/* The same ink as Back. They are peers — two ways out of the same flow —
          and a step apart made Cancel read as the less available of the two,
          which it is not. The slot stays reserved while the call is in flight
          so the title does not reflow when the button goes. */}
      <button
        type="button"
        tabIndex={-1}
        {...tap(() => {
          if (canClose) onClose();
        })}
        className={`h-12 rounded-lg px-3 text-sm text-ink-400 active:bg-ink-800 ${
          canClose ? '' : 'invisible'
        }`}
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * The run, written out beside the question being answered.
 *
 * Memoised on what it draws and nothing else — see `QuestionListState`. A
 * keystroke changes the buffer and the shift state, and neither is here, so
 * this subtree does not re-render while a name is being typed. That is the
 * discipline the keyboard already keeps, for the same reason: the work in a
 * keystroke is the thing this file guards hardest.
 */
const QuestionStack = memo(function QuestionStack({
  step,
  roster,
  draft,
  guardian,
  allergiesSupported,
  mode,
  editing,
  resume,
  onReopen,
}: Omit<QuestionListState, 'children'> & {
  roster: QuestionListState['children'];
  onReopen: (step: StepKind, child: number | null) => void;
}) {
  const sections = questionList({
    step,
    children: roster,
    draft,
    guardian,
    allergiesSupported,
    mode,
    editing,
    resume,
  });

  return (
    <>
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1.5">
          <div className="px-1 pt-1 text-sm tracking-[0.14em] text-ink-500 uppercase kiosk:text-base">
            {section.title}
          </div>
          {section.rows.map((row) => (
            <QuestionRowView key={row.id} row={row} onReopen={onReopen} />
          ))}
        </div>
      ))}
    </>
  );
});

/**
 * One question in the list.
 *
 * Three states and each is a different claim. Answered is filled, because it
 * holds something; the one being answered wears the accent, because it is where
 * the parent is; and one still to come is an outline, because an empty filled
 * row reads as an answer somebody failed to give.
 */
function QuestionRowView({
  row,
  onReopen,
}: {
  row: QuestionRow;
  onReopen: (step: StepKind, child: number | null) => void;
}) {
  const tap = useTap();
  const shell = `flex h-14 w-full items-center justify-between gap-3 rounded-xl px-5 text-left kiosk:h-16 ${
    row.state === 'now'
      ? 'bg-brand-600/15 ring-2 ring-brand-500/50'
      : row.state === 'done'
        ? 'bg-ink-900'
        : row.resumeHere
          ? 'ring-2 ring-ink-600'
          : 'ring-1 ring-ink-800/70'
  }`;
  const body = (
    <>
      <span
        className={`truncate text-base kiosk:text-lg ${
          row.state === 'now'
            ? 'font-semibold text-brand-300'
            : row.state === 'done'
              ? 'text-ink-500'
              : 'text-ink-600'
        }`}
      >
        {row.label}
      </span>
      {row.answer !== '' && (
        <span className="truncate text-lg font-semibold text-ink-100 kiosk:text-xl">
          {row.answer}
        </span>
      )}
      {/* Where Next puts them back, said on the row itself rather than in a
          sentence somewhere else on the screen. */}
      {row.resumeHere && (
        <span className="shrink-0 text-sm tracking-[0.08em] text-ink-500 uppercase kiosk:text-base">
          back to this
        </span>
      )}
    </>
  );

  /*
   * A question already answered is a button; one nobody has reached is not.
   * Jumping forward to an unanswered question would leave a hole in the run and
   * a confirm screen with a blank on it, and there is nothing there to fix.
   */
  if (!row.canReopen) {
    return (
      <div data-testid={`question-${row.id}`} data-state={row.state} className={shell}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      tabIndex={-1}
      data-testid={`question-${row.id}`}
      data-state={row.state}
      aria-label={`${row.label}: ${row.answer}. Change it.`}
      {...tap(() => onReopen(row.step, row.child))}
      className={`${shell} active:bg-ink-700`}
    >
      {body}
    </button>
  );
}

/**
 * The grade grid, standing where the keyboard stands.
 *
 * Four across rather than three, which is what lets fifteen chips land in four
 * rows instead of five — and four rows of `h-[4.375rem]` are the keyboard's
 * five rows to the pixel, at both of the key heights `Keyboard` uses. So the
 * console is the same height on this question as on every other, and the rule
 * above it does not move when the question changes.
 */
function GradeChips({
  grade,
  picked,
  onPick,
}: {
  grade: Grade | null;
  picked: boolean;
  onPick: (grade: Grade | null) => void;
}) {
  return (
    <div className="mx-auto grid w-full grid-cols-4 gap-1.5 p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))] lg:max-w-5xl lg:px-0">
      {GRADES.map((year) => (
        <GradeChip
          key={year}
          label={gradeChipLabel(year)}
          hint={gradeDescription(year)}
          selected={picked && grade === year}
          onPick={() => onPick(year)}
        />
      ))}
      {/* Last, because it is the one chip here that is not an answer. In
          reading position one, styled like the fourteen real values, it reads
          as the default — and what it produces is a grade-less record for the
          core team to adjudicate. */}
      <GradeChip label={NO_GRADE} selected={picked && grade === null} onPick={() => onPick(null)} />
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
  const tap = useTap();

  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      {...tap(() => {
        if (disabled) return;
        haptic();
        onPick();
      })}
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

function GradeChip({
  label,
  hint,
  selected,
  onPick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPick: () => void;
}) {
  const tap = useTap();

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={hint ?? label}
      aria-pressed={selected}
      {...tap(() => {
        haptic();
        onPick();
      })}
      className={`flex h-[4.375rem] items-center justify-center rounded-xl text-xl font-semibold tall:h-20 ${
        selected
          ? 'bg-brand-600/25 text-brand-200 ring-2 ring-brand-500'
          : 'bg-ink-800 text-ink-100 active:bg-ink-600'
      }`}
    >
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Words                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What one grade chip says.
 *
 * Bare digits rather than `gradeName`'s ordinals, because fourteen chips in a
 * three-wide grid are read by scanning and "4" lands before "4th" does — the
 * aria label still says "4th grade" for anyone hearing the screen instead.
 *
 * The two years with no number of their own get their names. Pre-K is the one
 * that matters: its number is Planning Center's `-1`, and spelling the label
 * as `String(grade)` right here put a chip reading "-1" at the top left of the
 * grid, in first reading position, in front of the parent of a four-year-old.
 */
function gradeChipLabel(grade: Grade): string {
  if (grade === PRE_K) return 'Pre-K';
  return grade === 0 ? 'K' : String(grade);
}

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
    /*
     * The typing steps name the field against the readout now, so this line
     * goes back to identity: a parent glancing up wants to know they are still
     * at the right gathering, not to read the same question twice at opposite
     * ends of the type ramp.
     */
    case 'child-first':
    case 'child-last':
      return binding.title;
    /*
     * The question moved down to the console, where the answer is given. These
     * two go back to identity with the rest: a parent glancing up wants to know
     * they are still at the right gathering, not to read the same sentence
     * twice at opposite ends of the type ramp.
     */
    case 'child-grade':
    case 'child-allergies':
      return binding.title;
    /*
     * The adult's two steps share one line, and it is context rather than a
     * label: the readout under it already says "Your first name". A subtitle
     * that repeated the placeholder would be the same words twice on a screen
     * with four lines of text on it.
     */
    case 'guardian-first':
    case 'guardian-last':
      return binding.title;
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
 * The question, said against the thing that answers it.
 *
 * The field's own name where a field is what it is, not "Type here" — which
 * repeated the shape of the screen back at somebody and named nothing. It
 * matters most on the two steps where the question and the answer could belong
 * to either person in the room: "Child's last name" and "Your last name" are
 * the same box until one of them says which.
 *
 * The grade and the allergy note ask a sentence rather than name a field,
 * because neither has a field to name — a year comes off a grid, and "any
 * allergies we should know about?" is deliberately an invitation to skip rather
 * than an interrogation. Both used to be said by the header instead; the header
 * carries the gathering on those steps now, which is what a parent glancing up
 * is checking.
 */
function questionFor(state: RegistrationState): string {
  switch (state.step) {
    case 'child-first':
      return "Child's first name";
    case 'child-last':
      return "Child's last name";
    case 'child-grade':
      return 'What grade are they in?';
    case 'child-allergies':
      return 'Any allergies we should know about?';
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
