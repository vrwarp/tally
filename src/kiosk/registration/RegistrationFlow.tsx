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
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { haptic } from '@/lib/utils';
import { gradeDescription, type GradeStrings } from '@/lib/grades';
import { useGrades } from '@/hooks/usePureStrings';
import { GRADES, PRE_K, type Grade, type RegisterFamilyResult } from '@/types';
import { Keyboard, type KioskKey } from '../components/Keyboard';
import type { KioskBinding } from '../binding';
import { PhonePad } from './PhonePad';
import { useTap } from '../components/tapGuard';
import {
  addAnotherChild,
  advance,
  answerNoAllergies,
  applyKey,
  canAdvance,
  chooseGrade,
  goBack,
  initialState,
  isTypingStep,
  MAX_CHILDREN,
  questionList,
  readoutFor,
  reopen,
  type QuestionListState,
  type QuestionRow,
  type DraftChild,
  type RegistrationMode,
  type QuestionStrings,
  type RegistrationState,
  type StepKind,
} from './steps';

/**
 * The wizard's translator, as a type.
 *
 * `titleFor`, `subtitleFor`, `questionFor`, `commitLabel` and `welcomeLine`
 * are pure functions of the state — that is what makes them testable beside the
 * reducer — so they take it as an argument rather than reaching for a hook.
 */
type RegisterTranslator = ReturnType<typeof useTranslations<'Register'>>;

/**
 * The words `steps.ts` needs to write the run out, in the shape it takes.
 *
 * Memoised on the two translators, so `QuestionStack`'s memo still holds
 * across a keystroke — the whole point of that component.
 */
function useQuestionStrings(): QuestionStrings {
  const t = useTranslations('Register');
  const grades = useGrades();
  return useMemo(() => ({ t: t as unknown as QuestionStrings['t'], grades }), [t, grades]);
}

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

/**
 * How long the first bar takes, and — if the callable has not answered by then
 * — when the name tags go anyway.
 *
 * Five seconds is not a guess about the call; it is the length of wait at which
 * a screen with nothing moving on it stops reading as *working* and starts
 * reading as *broken*. A save that comes back inside it never spends it: the
 * bar completes early and the second one is never drawn, so the common evening
 * is unchanged and the risk of a sticker outrunning its registration is
 * confined to the calls that were already slow.
 */
export const PROCESSING_MS = 5_000;

/**
 * The completion beat.
 *
 * Long enough for a bar to be seen arriving at its end, short enough not to be
 * a wait. Without it a fast save paints a bar at a fifth of its width and then
 * takes the screen away, and progress that vanishes part-drawn reads as
 * *cancelled* — the exact impression the bar is there to prevent.
 */
export const SNAP_MS = 300;

/**
 * Where the saving screen is, which is not quite where the run is.
 *
 * `state.step` says `submitting` for the whole window; this says which half of
 * it. `processing` is the first bar, `saving` is the second — reached only by a
 * call that has already cost a parent five seconds, and the point at which
 * their name tags are printed. `finishing` is the beat above.
 */
type SavePhase = 'processing' | 'saving' | 'finishing';

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
  | { type: 'failed'; cause: FailureCause };

/**
 * Which of the two ways a submit ends badly, because they want different
 * sentences and — once a sticker has already come out — different instructions.
 *
 * `refused` is the server saying no: it read the request and would not do it,
 * and nothing was written. `gave-up` is the SDK's own seventy-second deadline
 * with the call still in the air. They used to be the same generic line, which
 * was safe while a failure meant no sticker existed. It is not safe now: the
 * deadline is a client giving up, not a cancellation — the function runs to its
 * own hundred and twenty seconds — so at the moment this screen paints, whether
 * the family was written is genuinely unknown, and the family is holding name
 * tags. Claiming failure there would be a lie half the time.
 */
type FailureCause = 'refused' | 'gave-up';

/**
 * What the SDK calls its own timeout. Prefixed `functions/` on the error, which
 * is why this is matched with `includes` — the same idiom `onConfirm` uses on
 * `permission-denied`.
 */
const DEADLINE_EXCEEDED = 'deadline-exceeded';

/**
 * Which sentence a failure gets, as a key rather than as the sentence.
 *
 * The two are genuinely different instructions — one says nothing was written,
 * the other says nobody knows and the family is holding name tags — and that
 * distinction is a decision this module makes. What it may not do is *say* it:
 * a reducer is a pure function shared with the tests and cannot reach a
 * translator, so it names the sentence and the error step reads it out. Same
 * split as the server's `ServerCode`; see `src/lib/serverCodes.ts`.
 */
const FAILURE_KEYS = {
  'gave-up': 'saveTakingLonger',
  refused: 'couldNotSave',
} as const satisfies Record<FailureCause, string>;

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
      return answerNoAllergies(state);
    case 'submitting':
      return { ...state, step: 'submitting', message: '' };
    case 'submitted':
      return { ...state, step: 'success', last4: action.result.last4 };
    case 'failed':
      return {
        ...state,
        step: 'error',
        // The cause travels; the words are chosen where there is a translator.
        message: '',
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
  /**
   * Everybody registered and checked in — the caller greens their rows and
   * prints.
   *
   * `notes` is the allergy answer as the parent typed it, index-aligned with
   * `result.children` — the server echoes the request's own order, so the two
   * cannot drift. It rides beside the result rather than inside it because it
   * never went upstream and came back: it is the one thing on a kiosk sticker
   * the kiosk was *told* rather than having to ask, and the ask cannot succeed
   * for a child this new. See `rememberAllergyNote`.
   */
  onRegistered: (result: RegisterFamilyResult, notes: readonly string[]) => void;
  /**
   * Print the name tags now, without waiting to hear whether the family was
   * written — `PROCESSING_MS` into a call that has not answered.
   *
   * Called at most once per run. The caller keys the labels by the run and
   * adopts the real ids when the response lands, so a sticker that outran its
   * registration is still the same sticker afterwards.
   */
  onEarlyPrint: (registrationId: string, children: readonly DraftChild[]) => void;
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
  onEarlyPrint,
  onClose,
}: RegistrationFlowProps) {
  const t = useTranslations('Register');
  const locale = useLocale();
  const questionStrings = useQuestionStrings();
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

  /* ---- Walked away ------------------------------------------------------- */

  useEffect(() => {
    // Never while the call is in flight, and never on the screen teaching the
    // family their digits — that one returns on its own clock below.
    if (state.step === 'submitting' || state.step === 'success') return;
    const timer = setTimeout(onClose, INACTIVITY_MS);
    return () => clearTimeout(timer);
  }, [state, onClose]);

  /* ---- The call ---------------------------------------------------------- */

  const [savePhase, setSavePhase] = useState<SavePhase>('processing');
  /**
   * Whether this run's name tags have already gone.
   *
   * Separate from the phase because it survives it: once the tags are out the
   * second meter stays on the screen through `finishing`, and the first one
   * keeps saying so.
   */
  const [tagsOut, setTagsOut] = useState(false);
  /** Which way the last attempt ended badly, for the header above the sentence. */
  const [failure, setFailure] = useState<FailureCause | null>(null);
  /** The completion beat's timer, cleared if this screen goes first. */
  const finishRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(finishRef.current), []);
  const submittedRef = useRef(false);
  const runSubmit = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    haptic();
    setSavePhase('processing');
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
        /*
         * The roster half now, the screen half a beat later.
         *
         * `onRegistered` is what greens their rows, makes them searchable and —
         * unless the saving screen already did it — prints. None of that waits
         * for an animation. What waits is the step change: the bar is given
         * `SNAP_MS` to be seen arriving at its end, because a bar that is
         * replaced part-drawn reads as a thing that stopped rather than a thing
         * that finished.
         */
        onRegistered(
          result,
          state.children.map((child) => child.allergies),
        );
        setSavePhase('finishing');
        finishRef.current = setTimeout(() => dispatch({ type: 'submitted', result }), SNAP_MS);
      })
      .catch((error: { code?: string }) => {
        submittedRef.current = false;
        /*
         * The cause, and nothing else off the error.
         *
         * The server's refusals are written for this screen — "We could not
         * find that family. Please register as a new family, or see a leader."
         * — but not all of them are: the same `invalid-argument` carries
         * "allergies must line up with children." and "anchorStudentIds must be
         * a list.", which are developer grammar and only reachable from a
         * malformed request. A lobby is the wrong place to find out which one
         * came back, so the sentence is chosen here from the shape of the
         * failure rather than relayed from the wire.
         */
        const cause: FailureCause = error.code?.includes(DEADLINE_EXCEEDED)
          ? 'gave-up'
          : 'refused';
        setFailure(cause);
        dispatch({ type: 'failed', cause });
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

  /* ---- Five seconds in, with nothing back ---------------------------------- */

  /*
   * The handoff: the first bar ends, the name tags go, and the second bar takes
   * over for however long the call still needs.
   *
   * Armed on entering `submitting` and disarmed by leaving it, so a save that
   * answers first never reaches this and the tags print the ordinary way, from
   * `onRegistered`, against ids the server has already given. Only a call that
   * has held a parent for five seconds prints ahead of its own answer — which
   * is also the case where the tags in their hand are the only thing on this
   * screen that is certainly true.
   */
  useEffect(() => {
    if (state.step !== 'submitting' || savePhase !== 'processing') return;
    const timer = setTimeout(() => {
      onEarlyPrint(state.registrationId, state.children);
      setTagsOut(true);
      setSavePhase('saving');
    }, PROCESSING_MS);
    return () => clearTimeout(timer);
  }, [state.step, state.registrationId, state.children, savePhase, onEarlyPrint]);

  useEffect(() => {
    if (state.step !== 'success') return;
    const timer = setTimeout(onClose, SUCCESS_AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, [state.step, onClose]);

  /* ---- Render ------------------------------------------------------------ */

  /* Whose questions are on screen: the child being added, or — when a row has
     been tapped to fix it — the child that row belongs to. */
  const childNumber = (state.editing ?? state.children.length) + 1;
  /*
   * Every step that draws the run above the console — which now includes the
   * confirm.
   *
   * The confirm used to replace the body with a receipt of the same facts in a
   * different shape, at the one moment a parent is asked to check them. So the
   * screen they had been reading for ninety seconds vanished exactly when it
   * was needed, and its rows — buttons on every other step — stopped being
   * buttons here, which made repair hardest at the moment it is asked for.
   *
   * Keeping the list means the body does not move at all between the last
   * question and the confirm: only the console changes, and it changes
   * completely. It also puts the confirm inside the scroll region, which the
   * receipt never had — six children on one confirm is more than the glass
   * holds.
   */
  const showsList =
    isTypingStep(state.step) || state.step === 'child-grade' || state.step === 'confirm';

  /*
   * A long family scrolls, and two things want the glass: the end of the run,
   * and the question being asked right now.
   *
   * The end alone is what shipped, and on the shortest glass it hid the one row
   * the step is about. A first registration opens with seven rows and two
   * headings on it — four for the child, three for the adult — which a phone
   * cannot hold, so the list settled at the phone number and "Child's first
   * name" was asked above the fold, with the accent that says *here* scrolled
   * out of sight. The same thing happens to any row reopened from the top of a
   * long family.
   *
   * So the end is still where the list settles — what has just been typed
   * belongs on the glass — and the row wearing the accent is then pulled back
   * if that settling took it off. `nearest` is deliberate: it is the smallest
   * movement that satisfies both, so a row already visible does not jump.
   *
   * Per step rather than per keystroke, and `editing` is in the list because
   * reopening a row is how the accent moves without the step changing. Nothing
   * in the list changes while a name is being typed, and a list that re-scrolled
   * under a thumb would undo a parent who had scrolled up to check an earlier
   * answer.
   */
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    /*
     * Found through the DOM rather than by threading a ref down: the accent is
     * already on the glass as `data-state`, the list is a memo over a pure
     * list-builder, and a ref per row would have to survive that memo. The
     * confirm has no such row and wants the end of the run anyway, which is
     * what it gets.
     */
    list.querySelector('[data-state="now"]')?.scrollIntoView({ block: 'nearest' });
  }, [state.step, state.editing, state.children.length]);

  return (
    /* The column is the glass, never its widest item. A name typed to
        NAME_MAX_LENGTH sits truncated in the readout, and truncation clips a
        box whose minimum is still the whole name — which, as the minimum of
        an auto track, widened the header, the body and the keys past a phone.
        See the same rule on the search screen's root for the mechanism. */
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto]">
      <Header
        /*
         * "Something went wrong" is right for a refusal and wrong for a
         * deadline: the body below it says we do not know what happened, and a
         * header that has already decided contradicts it in larger type.
         */
        title={
          state.step === 'error' && failure === 'gave-up'
            ? t('takingAWhile')
            : titleFor(t, state, childNumber)
        }
        subtitle={subtitleFor(t, state, binding)}
        onBack={() => {
          haptic(8);
          if (goBack(state) === null) onClose();
          else dispatch({ type: 'back' });
        }}
        /*
         * Both controls go while the call is in the air, and Back is the one
         * that mattered: `goBack` has no case for `submitting`, so it answered
         * null and this handler read null as "there is nowhere back, close the
         * wizard" — which dropped a parent on the search screen mid-flight. The
         * registration still landed and the stickers still came out, because
         * `onRegistered` belongs to `KioskApp` and outlives this unmount; what
         * the parent lost was the screen with their four digits on it, which is
         * the only thing this whole run is for.
         */
        canBack={state.step !== 'submitting'}
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
      <div className="flex min-h-0 flex-col">
        {showsList ? (
          <>
            {/*
              * The `px-6` gutter is on the scrolling box rather than around it,
              * which is where the other kiosk lists keep theirs — `SearchScreen`,
              * `SiblingScreen`, `ReprintScreen` — and it is not tidiness: a box
              * that scrolls clips on *both* axes (CSS has no "scroll down, spill
              * sideways") and it clips at its padding edge. With the gutter
              * outside, the rows ran the full width of that edge and the ring,
              * which a browser draws as a shadow *outside* the border box, was
              * shaved off down both sides — so every unanswered field lost its
              * left and right strokes and the list read as a stack of
              * open-ended lines rather than boxes. The question below and the
              * screens that stand in for the list carry the same gutter, so
              * nothing moved but the clip.
              */}
            <div
              ref={listRef}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scroll-touch px-6"
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
                {state.step === 'confirm' && state.mode === 'sibling' && (
                  /*
                    Who this child is being added to. The kiosk guessed the
                    family from four digits (see family.ts for how much of a
                    guess that is), so the guess goes on the glass rather than
                    staying in the request — a parent looking at a stranger's
                    children in their own confirmation cannot miss it.
                  */
                  <p className="px-1 pt-1 text-base text-ink-400">
                    {anchors && anchors.length > 0
                      ? t('joiningNamed', {
                          names: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                            anchors.map((sibling) => sibling.firstName),
                          ),
                        })
                      : t('joiningYourFamily')}
                  </p>
                )}
              </div>
            </div>
            {/*
              * The question, against the keys that answer it.
              *
              * It was at the top of this region, which on a portrait tablet put
              * it six hundred pixels above the thing a parent presses to answer
              * it. Said here as well as in the list above — deliberately: the
              * row in the list is the index, saying where somebody is in the
              * run and what they can go back and fix; this is the question, in
              * the same glance as the thumb.
              *
              * Not on the confirm: there the header carries the question and
              * the console carries the fork, and a third line saying the same
              * thing a third time would only ask which one to answer.
              */}
            {state.step !== 'confirm' && (
              <div className="px-6 pt-3 pb-1">
                <div className="mx-auto w-full max-w-2xl text-center text-2xl font-semibold text-ink-100 kiosk:text-3xl">
                  {questionFor(t, state)}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-3 px-6 pb-6">
          {state.step === 'submitting' && (
            <SavingScreen roster={state.children} phase={savePhase} tagsOut={tagsOut} />
          )}

          {state.step === 'success' && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-present-600/20 text-5xl">
                ✓
              </div>
              <p className="text-2xl font-semibold text-ink-100">
                {welcomeLine(t, locale, state.children)}
              </p>
              {/* The whole handoff, in one sentence: this is how they find
                  themselves next week without anybody's help. */}
              <p className="text-xl text-ink-400">
                {t.rich('nextTime', {
                  last4: state.last4,
                  digits: (chunks) => (
                    <span className="font-semibold tracking-widest text-ink-100">{chunks}</span>
                  ),
                })}
              </p>
            </div>
          )}

          {state.step === 'error' && (
            <div className="flex flex-col gap-5 text-center">
              <p className="text-xl text-ink-200">
                {state.message || t(FAILURE_KEYS[failure ?? 'refused'])}
              </p>
              <Big label={t('tryAgain')} tone="brand" onPick={runSubmit} />
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
          from moving between steps.

          The confirm is tested first because it draws the same body as a
          question and a different console: it is the one step where the run
          stays still and this whole region changes. */}
      {state.step === 'confirm' ? (
        <ConfirmConsole
          roster={state.children}
          onAdd={() => dispatch({ type: 'add-child' })}
          onCommit={runSubmit}
        />
      ) : showsList ? (
        <div className="flex flex-col gap-1.5">
          {/*
            * The band is drawn on the body's own measure — `max-w-2xl` inside
            * `px-6`, the pair the question list is laid out on — rather than
            * on the width of the glass. A button wider than the boxes it
            * commits reads as belonging to something else, and on a 1280-wide
            * kiosk it ran three hundred pixels past them on either side.
            *
            * The keyboard below it is the exception and stays full-bleed: it
            * is not part of the run, it is the thing under the thumbs.
            */}
          <div className="px-6 pt-2">
            <div className="mx-auto flex w-full max-w-2xl gap-2">
              {/*
                * The allergies step answers in two ways, so it shows two ways —
                * side by side, in the band **Next** already had, so the console
                * keeps its height and the rule above it does not move.
                *
                * "None" is what most families have to say, and a medical field
                * with forty keys under it and no visible way to say it collects
                * "None", "N/A" and "no allergies" as free text: three spellings
                * of a blank, bound for the church's database as though they
                * were notes. This is that answer, in one press, spelled the
                * same way every time.
                *
                * The colour says which one is being offered rather than the
                * position: while the box is empty **No allergies** is the live
                * answer and Next is dead, because there is nothing yet to press
                * Next with. Type one letter and they trade — Next takes the
                * brand and the blank goes quiet. Two lit buttons would only ask
                * which is the real one, which is what a tick beside a keyboard
                * was already asking.
                */}
              {state.step === 'child-allergies' && (
                <div className="flex-1">
                  <Big
                    label={t('noAllergies')}
                    tone={state.buffer === '' ? 'brand' : undefined}
                    onPick={() => dispatch({ type: 'no-allergies' })}
                  />
                </div>
              )}
              <div className="flex-1">
                <Big
                  label={t('next')}
                  tone="brand"
                  disabled={!canAdvance(state)}
                  onPick={() => dispatch({ type: 'next' })}
                />
              </div>
            </div>
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
          <div className="px-6 pb-1">
            <div className="mx-auto flex h-16 max-w-2xl items-center justify-center px-4">
              {/* The answer so far, however it is being given — typed, dialled
                  or tapped off a chip. Empty until there is one: the search
                  screen teaches a parent two taps earlier that the bold word
                  above the keys is what *they* entered, and a placeholder
                  sitting in that slot read as something a previous family had
                  already put there. What the box is for is said above it. */}
              {readoutFor(questionStrings, state) && (
                <span
                  data-testid="readout"
                  className="truncate text-3xl font-semibold tracking-wide text-ink-50 kiosk:text-4xl"
                >
                  {readoutFor(questionStrings, state)}
                </span>
              )}
              {/* Where the next letter lands, so the band reads as a live field
                  rather than as a gap. Only where something is typed — a grade
                  is chosen off a grid, and a caret blinking beside it would
                  promise a keyboard that is not there. See `.kiosk-caret`. */}
              {isTypingStep(state.step) && (
                <span aria-hidden data-testid="readout-caret" className="kiosk-caret" />
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
            <Keyboard onKey={onKey} shift={state.shift} />
          )}
        </div>
      ) : state.step === 'success' ? (
        <div className="px-6 py-2 pb-[max(0.5rem,var(--spacing-safe-bottom))]">
          <div className="mx-auto w-full max-w-2xl">
            <Big label={t('done')} onPick={onClose} />
          </div>
        </div>
      ) : (
        <div className="h-4" />
      )}
    </div>
  );
}

/**
 * How long the second meter is drawn to run for.
 *
 * Not a prediction — the callable's own deadline is seventy seconds and this is
 * just past it, so the bar is still moving whenever there is anything to wait
 * for. The easing is what carries the meaning: it decelerates hard, so the
 * distance left never closes and the meter cannot promise an arrival it does
 * not know about.
 */
const SLOW_METER_MS = 75_000;

/** Where a meter starts, so it reads as a bar rather than as an empty track. */
const METER_FLOOR = 0.03;

/**
 * One meter, and what it is a meter of.
 *
 * `running` is the phase's own curve; `full` is the completion beat. The arm is
 * two frames rather than one because a transition set in the same paint as its
 * starting value does not run — the browser has nothing to interpolate from.
 */
function Meter({
  label,
  mode,
  slow,
}: {
  label: string;
  mode: 'running' | 'full';
  slow: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const first = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(first);
  }, []);

  const scale =
    mode === 'full' ? 1 : !armed ? METER_FLOOR : slow ? 0.985 : 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="kiosk-meter">
        <div
          data-testid="save-meter-fill"
          className={`kiosk-meter-fill ${mode === 'full' ? 'kiosk-meter-done' : ''}`}
          style={{
            transform: `scaleX(${scale})`,
            transitionDuration:
              mode === 'full' ? `${SNAP_MS}ms` : slow ? `${SLOW_METER_MS}ms` : `${PROCESSING_MS}ms`,
            // Linear where the end is known and near, and a hard deceleration
            // where it is neither.
            transitionTimingFunction:
              mode === 'full' ? 'ease-out' : slow ? 'cubic-bezier(0, 0.55, 0.1, 1)' : 'linear',
          }}
        />
      </div>
      <p className="text-center text-lg text-ink-400 kiosk:text-xl">{label}</p>
    </div>
  );
}

/**
 * The screen a family looks at while the callable is in the air.
 *
 * It used to be the word "Saving…" under the word "One moment" on an otherwise
 * empty screen — two phrasings of the same idea, nothing moving, and four
 * fifths of a lobby tablet blank. A screen with nothing happening on it is
 * indistinguishable from a screen that has crashed, and the parent's own answer
 * to that is to press something.
 *
 * So it shows the two things it actually knows. The family, because the wait is
 * *about* them and the names are the one content this screen can be certain of
 * — the same rows the confirm just showed, held still so the last thing a
 * parent read is still there. And the progress, in the only honest shape
 * available: a first meter that ends where the name tags print, and — for the
 * saves slow enough to need it — a second that keeps moving without ever
 * claiming to arrive.
 *
 * The two meters stack rather than replace one another. A single track running
 * to its end and starting again at nothing reads as progress lost, whatever the
 * label says; two rows, the first one finished and staying finished, read as a
 * thing with a step behind it. What makes that legible rather than decorative
 * is that the step between them is real: the name tags come out.
 */
function SavingScreen({
  roster,
  phase,
  tagsOut,
}: {
  roster: readonly DraftChild[];
  phase: SavePhase;
  tagsOut: boolean;
}) {
  const t = useTranslations('Register');
  const grades = useGrades();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        {roster.map((child, index) => (
          <div
            key={index}
            data-testid="saving-child"
            className="flex h-14 items-center justify-between gap-3 rounded-xl bg-ink-900 px-5 kiosk:h-16"
          >
            <span className="truncate text-lg font-semibold text-ink-100 kiosk:text-xl">
              {`${child.firstName} ${child.lastName}`.trim()}
            </span>
            {child.grade !== null && (
              <span className="shrink-0 text-base text-ink-500 kiosk:text-lg">
                {gradeDescription(grades, child.grade)}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-7">
        <Meter
          label={tagsOut ? t('tagsPrinting') : t('checkingThemIn')}
          mode={phase === 'processing' ? 'running' : 'full'}
          slow={false}
        />
        {/* Only for the saves that earned it. Most evenings this is never
            drawn, and the screen is one meter that fills and is gone. */}
        {tagsOut && (
          <Meter label={t('saving')} mode={phase === 'finishing' ? 'full' : 'running'} slow />
        )}
      </div>
    </div>
  );
}

/**
 * The confirm's console: the fork, and the commit.
 *
 * Its own component because it is the one console that is not a question's —
 * the body above it is the same list the last question drew, and everything
 * that changes when a parent arrives here changes in this box.
 */
function ConfirmConsole({
  roster,
  onAdd,
  onCommit,
}: {
  roster: readonly DraftChild[];
  onAdd: () => void;
  onCommit: () => void;
}) {
  const t = useTranslations('Register');
  return (
    <div className="px-6 py-2 pb-[max(0.5rem,var(--spacing-safe-bottom))]">
      {/* The family's own measure, as above — these buttons commit the rows
          they sit under. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {/*
          * The fork, asked where it is answered.
          *
          * The header asks whether the typing is right; these two buttons
          * answer whether anybody is missing, which is a different question,
          * and for a while the screen only asked the first one. Both belong,
          * and they belong in different places: the header keeps the question
          * whose failure is expensive and silent — a misspelt name becomes a
          * roster row, a sticker and a record upstream, and nobody catches it
          * until a weekday, next to the duplicate it caused — while this one
          * sits on top of the buttons that answer it. The same move the typing
          * steps make with `questionFor`.
          *
          * Not phrased as a yes and a no. A yes/no pair reads as two answers
          * of equal weight and these are not: a second child is rare, the
          * quiet/brand contrast already says which one a parent is here for,
          * and "No, check them in" would put back exactly the ambiguity
          * `commitLabel` exists to remove.
          *
          * A fixed band above a fixed pair, present from first paint, so
          * nothing here moves when a child is added.
          */}
        <p className="pt-1 pb-2 text-center text-xl text-ink-400">{t('anyoneElseToAdd')}</p>
        {/*
          * The offer the fork screen used to carry, in the shape it carried it
          * — the quiet button above the brand one, so a parent who learned
          * that pair on the old screen meets the same pair here. It belongs on
          * this screen rather than on one of its own: a parent notices a
          * missing child by reading the list, not by being asked about it four
          * screens earlier.
          */}
        <Big
          label={t('addAnotherChild')}
          disabled={roster.length >= MAX_CHILDREN}
          onPick={onAdd}
        />
        <Big label={commitLabel(t, roster)} tone="brand" onPick={onCommit} />
        {roster.length >= MAX_CHILDREN && (
          <p className="text-center text-base text-ink-500">{t('maxChildren')}</p>
        )}
      </div>
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
  canBack,
  canClose,
  onClose,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  canBack: boolean;
  canClose: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('Register');
  const tCommon = useTranslations('Common');
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
      {/* Reserved rather than removed while the call is in flight, the same way
          Cancel opposite is, and for the same reason: the title is centred on
          what is left between the two slots, so dropping one would shift it. */}
      <button
        type="button"
        tabIndex={-1}
        {...tap(() => {
          if (canBack) onBack();
        })}
        className={`h-12 rounded-lg px-3 text-sm text-ink-400 active:bg-ink-800 ${
          canBack ? '' : 'invisible'
        }`}
      >
        {t('back')}
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
        {tCommon('cancel')}
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
  const strings = useQuestionStrings();
  const sections = questionList(strings, {
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
  const t = useTranslations('Register');
  const tap = useTap();
  /*
   * `scroll-mt-10` is what the layout effect above scrolls this row *to*: forty
   * pixels is the section heading and the gap under it, so a row pulled back
   * into view arrives with "YOUR CHILD" or "AND YOU" above it rather than flush
   * against a cut edge, which is the same row with no answer to "whose?".
   */
  const shell = `flex h-14 w-full scroll-mt-10 items-center justify-between gap-3 rounded-xl px-5 text-left kiosk:h-16 ${
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
          {t('backToThis')}
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
      aria-label={t('reopenAria', { label: row.label, answer: row.answer })}
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
  const grades = useGrades();
  return (
    <div className="mx-auto grid w-full grid-cols-4 gap-1.5 p-2 pb-[max(0.5rem,var(--spacing-safe-bottom))] lg:max-w-5xl lg:px-0">
      {GRADES.map((year) => (
        <GradeChip
          key={year}
          label={gradeChipLabel(grades, year)}
          hint={gradeDescription(grades, year)}
          selected={picked && grade === year}
          onPick={() => onPick(year)}
        />
      ))}
      {/* Last, because it is the one chip here that is not an answer. In
          reading position one, styled like the fourteen real values, it reads
          as the default — and what it produces is a grade-less record for the
          core team to adjudicate. */}
      <GradeChip
        label={grades('none')}
        selected={picked && grade === null}
        onPick={() => onPick(null)}
      />
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
      {/* Truncating, because one of these labels is written from a family's own
          names now — two long ones would otherwise push the button's minimum
          past the glass, the same way the readout used to widen the header. */}
      <span className="min-w-0 truncate px-4">{label}</span>
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
/**
 * The chip's face: `Pre-K`, `K`, or the bare numeral.
 *
 * Not `gradeName`, which would print an English ordinal ("9th") the chip has no
 * room for — a grid of four columns wants the number alone. Only the two grades
 * that are words rather than positions come out of the catalogue.
 */
function gradeChipLabel(grades: GradeStrings, grade: Grade): string {
  if (grade === PRE_K) return grades('preK');
  return grade === 0 ? grades('shortK') : String(grade);
}

function titleFor(t: RegisterTranslator, state: RegistrationState, childNumber: number): string {
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
          t('titleAnotherChild')
        : childNumber === 1
          ? t('titleYourChild')
          : t('titleChildNumber', { number: childNumber });
    case 'guardian-first':
    case 'guardian-last':
    case 'guardian-phone':
      return t('titleGuardian');
    case 'confirm':
      return t('titleConfirm');
    case 'submitting':
      return t('titleSubmitting');
    case 'success':
      return t('titleSuccess');
    case 'error':
      return t('titleError');
  }
}

function subtitleFor(
  t: RegisterTranslator,
  state: RegistrationState,
  binding: KioskBinding,
): string {
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
      return t('subtitlePhone');
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
function questionFor(t: RegisterTranslator, state: RegistrationState): string {
  switch (state.step) {
    case 'child-first':
      return t('placeholderChildFirst');
    case 'child-last':
      return t('placeholderChildLast');
    case 'child-grade':
      return t('subtitleGrade');
    case 'child-allergies':
      return t('subtitleAllergies');
    case 'guardian-first':
      return t('placeholderYourFirst');
    case 'guardian-last':
      return t('placeholderYourLast');
    case 'guardian-phone':
      return t('placeholderPhone');
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
/**
 * What the commit button says, which is what it does.
 *
 * It used to say "Check in everyone" over a list whose last row is the adult —
 * and the adult is never checked in. The callable writes one attendance row per
 * child and only per child; a guardian's name and number live on the review
 * record, TTL'd, and travel upstream as a household contact. So "everyone"
 * named a set the kiosk does not act on, in front of the family it named.
 *
 * Naming the subject removes the ambiguity and has nowhere to put it back.
 * Names up to two, because two is the whole of the multi-child case in
 * practice and six of them would not fit the button; a count beyond that. The
 * one- and two-child forms are the sentence the success screen already speaks,
 * so the button promises exactly what the next screen confirms.
 */
function commitLabel(t: RegisterTranslator, children: readonly DraftChild[]): string {
  const names = children.map((child) => child.firstName);
  if (names.length === 1) return t('checkInOne', { name: names[0]! });
  if (names.length === 2) return t('checkInTwo', { first: names[0]!, second: names[1]! });
  return t('checkInMany', { count: names.length });
}

function welcomeLine(
  t: RegisterTranslator,
  locale: string,
  children: readonly DraftChild[],
): string {
  const names = children.map((child) => child.firstName);
  const list =
    names.length <= 1
      ? (names[0] ?? '')
      : new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
  return t('welcomeLine', { names: list, count: names.length });
}
