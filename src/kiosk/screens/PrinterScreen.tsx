/**
 * The label printer, for whoever set the kiosk up.
 *
 * Reached from the event chooser, which is already behind the staff gate — the
 * two-second hold on the search screen's Clear key — deliberately reusing that
 * gate rather than inventing a second gesture nobody would be told about.
 * Everything here is staff-facing: a parent never sees this screen, and a parent
 * never sees a printer error anywhere else either.
 *
 * Two things decide what a badge comes out as — which printer, and what is on
 * its spindle — and the printer answers both when it is connected. `Connect a
 * printer` reads the model off the USB product string and the roll off a status
 * packet, sets the kiosk to them, and says what it did. `Check the printer`
 * does the same afterwards, which is what somebody who has just changed a roll
 * presses.
 *
 * Neither answer is certain, so both stay editable and the notice above the
 * settings says which was a guess:
 *
 * **The model** is the name the device puts on the bus. Right on every QL this
 * has met and unplaceable on one the library does not carry, in which case the
 * list is still somebody's to answer and the notice says so.
 *
 * **The media** is sensed, but 62mm tape is both `62` and `62red` and the
 * packet cannot tell them apart. The plainer roll is taken, every match is
 * offered as a chip, and the notice names the one that was chosen.
 *
 * The test print goes through the real path — worker, rasteriser, transport — so
 * a label coming out proves the whole chain rather than just that the device
 * answers.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { haptic } from '@/lib/utils';
import { useTap, useTapGuard } from '../components/tapGuard';
import { useOverflowFade } from '../components/useOverflowFade';
import type { KioskPrinting } from '../KioskApp';
// Type-only. Every value this screen needs from the library arrives through the
// `printing` handle, because this component is referenced statically by KioskApp
// and a direct import would put the transport into the first-paint graph.
import type { AgeStrings } from '../printing';
import type {
  Label,
  PrintedLabel,
  PrinterConfig,
  PrinterDetection,
  PrinterNote,
  PrinterState,
} from '../printing';
import { useLocale, useTranslations } from 'use-intl';
import { usePrinterNote } from '../printerNote';

/**
 * The printer screen's translator, as a type.
 *
 * The two describers below are pure functions of a state and a detection —
 * that is how they stay readable beside the module they report on — so they
 * take it as an argument rather than reaching for a hook.
 */
type PrinterTranslator = ReturnType<typeof useTranslations<'Printer'>>;

/** The models this was built against, offered first. */
const PREFERRED_MODELS = ['QL-810W', 'QL-800', 'QL-820NWB'];

/** How many of the printer's recent events the fold shows; the copy carries them all. */
const MAX_EVENTS_SHOWN = 40;

/** How long "Copied" stays up. */
const COPY_FEEDBACK_MS = 2500;

type CopyState = 'idle' | 'copied' | 'failed';

function orderedModels(printing: KioskPrinting): string[] {
  const all = printing.modelIdentifiers();
  const preferred = PREFERRED_MODELS.filter((model) => all.includes(model));
  return [...preferred, ...all.filter((model) => !preferred.includes(model))];
}

/**
 * What a kiosk set up with a printer it cannot find is told to do.
 *
 * The Android sentence is there because on Android it is the whole story: a
 * printer that lost power or its cable, however briefly, is one the browser
 * can no longer match to its grant, and only the chooser brings it back. See
 * docs/label-printing.md.
 */
function stateLine(
  t: PrinterTranslator,
  note: (note: PrinterNote | null | undefined) => string,
  state: PrinterState,
  detection: PrinterDetection | null,
): { text: string; tone: string } {
  switch (state.kind) {
    case 'ready':
      /*
       * Connected, and not called *ready*.
       *
       * It said "Connected and ready." on a printer nothing had been through
       * yet — green, with the model beside it — and the only line in this
       * direction that says anything is outstanding appeared *after* a test
       * label. So the state that most needed telling a volunteer they were not
       * finished was the one that read as finished, and walking away from it
       * cost zero presses. What the bus can prove is that it answered and what
       * it said; the proof that a sticker comes out is the button below.
       */
      if (detection && !detection.modelFromPrinter)
        return { text: t('connectedGuessedModel'), tone: 'text-warn-400' };
      if (detection && detection.matched.length !== 1)
        return { text: t('connectedGuessedRoll'), tone: 'text-warn-400' };
      return { text: t('connectedReadOff'), tone: 'text-present-400' };
    case 'unpaired':
      // Set up with a printer, which is what makes this different from `idle`
      // below: the browser is not listing the one this kiosk was given.
      return state.searching
        ? { text: t('looking'), tone: 'text-ink-300' }
        : { text: t('notConnected'), tone: 'text-warn-400' };
    case 'unsupported':
      return { text: note(state.message), tone: 'text-warn-400' };
    case 'trouble':
      /*
       * Message and advice on one line, and the head keeps nothing else.
       *
       * The advice used to be a second centred line and the follow-up a third,
       * so the head overhung the 672px column the rest of the screen is built
       * in and left a centred orphan under it. One line here is also what holds
       * the primary at the same y in every configured state — no padded band,
       * and it survives a language whose sentences wrap differently.
       */
      return {
        text: [note(state.message), note(state.advice)].filter(Boolean).join(' '),
        tone: 'text-warn-400',
      };
    default:
      return { text: t('noPrinter'), tone: 'text-ink-300' };
  }
}

/**
 * What connecting could *not* settle, as the sentence a volunteer needs.
 *
 * Under the primary rather than in a panel above it, and only when there is
 * something outstanding: the clean read-off used to be stated here as well as
 * in the state line and again in the model row — the same two values three
 * times, loudest where they were least use. What survives is the half that is
 * a question, which is the half a volunteer has to answer.
 *
 * `label` is the *current* selection rather than the detected one, so the line
 * stays true after somebody takes the other roll.
 */
function detectionAccount(
  t: PrinterTranslator,
  detection: PrinterDetection,
  label: string,
  nameOf: (entry: Label) => string,
): string | null {
  // The printer did not answer. The state line at the top of the screen is
  // already saying why, and saying it twice helps nobody.
  if (!detection.status) return null;

  const media =
    detection.status.mediaType === 'die-cut'
      ? t('mediaDieCut', { width: detection.status.mediaWidthMm })
      : t('mediaContinuous', { width: detection.status.mediaWidthMm });

  if (!detection.modelFromPrinter)
    return t('modelUnknown', { model: detection.config.model });
  if (detection.matched.length === 0) return t('mediaUnknown', { media });
  if (detection.matched.length > 1) {
    const chosen = detection.matched.find((entry) => entry.identifier === label);
    return t('mediaAmbiguous', { media, label: nameOf(chosen ?? detection.matched[0]) });
  }
  return null;
}

/** "6:41 PM", the way every other time on this device is written. */
function clockTime(locale: string, atMs: number): string {
  return new Date(atMs).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * A sentence belonging to the control above it.
 *
 * Capped short of the control's own measure. Set to the full 672px these ran
 * 79–86 characters a line, which is past the point where a reader standing at
 * a shelf reliably finds the start of the next one — and the same register in
 * the chooser's foot runs 68. The left edge stays on the column so the prose
 * still hangs off the control it explains.
 *
 * `ink-100` is what the last press produced, `ink-300` a standing instruction,
 * `ink-400` a reference note.
 */
function Say({ tone = 'text-ink-300', children }: { tone?: string; children: ReactNode }) {
  return <div className={`max-w-xl shrink-0 text-sm kiosk:text-base ${tone}`}>{children}</div>;
}

/**
 * One control and its words, as a single object in the act group's rhythm.
 *
 * The group was a flat 12px stack of buttons and paragraphs, so nothing in the
 * spacing said which sentence belonged to which control — and a paragraph's own
 * leading is wider than a 12px gap, so two sentences about the primary sat
 * *further* apart than the lower one sat from a control it said nothing about.
 * Proximity was handing "Connecting opens a window…" to whichever grey row
 * happened to follow it. Eight binds, twenty-four separates.
 */
function Unit({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-col gap-2">{children}</div>;
}

export function PrinterScreen({
  printing,
  config,
  hasConfig,
  gatheringPrints = false,
  printedTonight,
  onReprint,
  onReprintByName,
  returnsTo = 'staff',
  onDone,
}: {
  printing: KioskPrinting;
  config: PrinterConfig;
  /**
   * Whether this kiosk has a printer stored, as opposed to being handed the
   * defaults `config` falls back to.
   *
   * What decides whether the screen says "plug one in first" and whether the
   * reprint door is live. It is a *fact* about the device rather than a reading
   * of the transport, which matters mid-evening: the door somebody came through
   * used to stay grey for the whole of the minute after they successfully
   * connected, because the prop it was gated on was only re-read on the way out.
   */
  hasConfig: boolean;
  /**
   * Whether the gathering this kiosk is bound to prints. Absent during setup,
   * where the kiosk is on no gathering at all.
   */
  gatheringPrints?: boolean;
  /** The evening's attempts, newest first. */
  printedTonight: readonly PrintedLabel[];
  /**
   * Opens the reprint confirm for this label — it never prints on its own.
   *
   * These rows used to print on `pointerdown`, in a pane that has to be scrolled
   * to reach the rest of itself, which meant the first touch of a scroll gesture
   * spent a label for whichever child the thumb happened to push off with. And
   * they were the *more* dangerous of the two doors onto the same act: the
   * by-name path has a confirm with a picture of the sticker on it, while two
   * children of one family sit here eight pixels apart with the same surname and
   * the same timestamp.
   */
  onReprint: (label: PrintedLabel) => void;
  /**
   * Absent during setup, which is the one time this screen is reached with the
   * kiosk on no gathering at all: there is nothing to search and nothing a
   * reprint could be aimed at, so the door is not drawn rather than drawn dead.
   */
  onReprintByName?: () => void;
  /**
   * Where **Done** goes, because the button has to say so.
   *
   * This screen has two ways in — the staff screen behind the hold on Clear,
   * and the amber dot on the check-in screen — and the way out follows the way
   * in. A volunteer who tapped the dot to find out what it meant is one tap
   * from the lobby's own screen again, and the button says as much rather than
   * making them find out by pressing it.
   */
  returnsTo?: 'staff' | 'check-in';
  onDone: () => void;
}) {
  const t = useTranslations('Printer');
  // The staff flow's own word for the way out, borrowed for the one entrance
  // that has one: the reprint screen has said it this way since it shipped.
  const tStaff = useTranslations('Staff');
  // The kiosk's language, for the log's clock times and the test label.
  const locale = useLocale();
  // The log's five ages, in the shape `describeAge` takes — see `AgeStrings`.
  const ages = t as unknown as AgeStrings;
  const printerNote = usePrinterNote();
  const [state, setState] = useState<PrinterState>(() => printing.currentState());
  const [model, setModel] = useState(config.model);
  const [label, setLabel] = useState(config.label);
  const [detection, setDetection] = useState<PrinterDetection | null>(null);
  const [busy, setBusy] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [copied, setCopied] = useState<CopyState>('idle');
  /**
   * The browser's device list came back with nothing picked.
   *
   * Every press has to change the screen, and this was the one that did not:
   * the chooser is the browser's, `pairPrinter` swallows a dismissal without
   * emitting a state, and the frame afterwards was identical to the frame
   * before — so a volunteer who fumbled the sheet pressed again, and again.
   *
   * What it may *say* is narrow. `NotFoundError` is what Chrome rejects with
   * for a dismissed list and an empty one alike, so the screen cannot know
   * which happened: it reports that nothing was picked, names the press that
   * recovers it first, and puts the cable second.
   */
  const [attemptFailed, setAttemptFailed] = useState(false);
  /** A test label has been sent since this screen last changed state. */
  const [tested, setTested] = useState(false);
  /**
   * The roll was chosen by hand, so the question below has been answered.
   *
   * Without this the instruction went on reading "pick it below" after the
   * picking — an instruction to do the thing just done, above the ring that
   * records having done it.
   */
  const [rollAnswered, setRollAnswered] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowTap = useTapGuard(onReprint);
  const tap = useTap();
  const { regionRef, contentRef, overflowing, fadeVars } = useOverflowFade();

  useEffect(
    () =>
      printing.subscribe((next) => {
        setState(next);
        // Any emission is an answer, so neither account outlives the thing it
        // was an account of.
        setAttemptFailed(false);
        if (next.kind !== 'ready') setTested(false);
      }),
    [printing],
  );
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const flash = (next: CopyState) => {
    setCopied(next);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied('idle'), COPY_FEEDBACK_MS);
  };

  /**
   * The record, onto the clipboard.
   *
   * Absent on http origins and inside a few in-app browsers. Say so rather than
   * doing nothing, and put the text on the screen where it can be selected by
   * hand — the same shape as the debug details in the main app.
   */
  const copyEvents = async () => {
    if (!navigator.clipboard) {
      flash('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(printing.printerLogText());
      flash('copied');
    } catch {
      flash('failed');
    }
  };

  const available = printing.labelsForModel(model);
  // A model change can leave the stored media unprintable on the new head —
  // 102mm rolls only fit the QL-1xxx — so the list is the authority and the
  // first entry is the fallback.
  const labelIsAvailable = available.some((entry) => entry.identifier === label);

  const apply = useCallback(
    async (next: PrinterConfig) => {
      setBusy(true);
      try {
        await printing.configure(next);
      } finally {
        setBusy(false);
      }
    },
    [printing],
  );

  /** Whatever the last press said about itself, cleared before the next one. */
  const forget = () => {
    setAttemptFailed(false);
    setTested(false);
  };

  const onModelChange = (nextModel: string) => {
    forget();
    setModel(nextModel);
    const fits = printing.labelsForModel(nextModel);
    const nextLabel = fits.some((entry) => entry.identifier === label)
      ? label
      : (fits[0]?.identifier ?? label);
    setLabel(nextLabel);
    void apply({ model: nextModel, label: nextLabel });
  };

  const onLabelChange = (nextLabel: string) => {
    forget();
    setRollAnswered(true);
    setLabel(nextLabel);
    void apply({ model, label: nextLabel });
  };

  /**
   * Take what the printer says about itself, on either of the two doors to it.
   *
   * The module has already written the config and set the kiosk to it, so this
   * is the screen catching up with a decision rather than making one — which is
   * why the selects are set from `found.config` and not from what was asked
   * for.
   */
  const adopt = (found: PrinterDetection | null) => {
    if (!found) return;
    // A fresh reading asks the question again: the roll on the spindle may be
    // the reason somebody pressed Check.
    setRollAnswered(false);
    setDetection(found);
    setModel(found.config.model);
    setLabel(found.config.label);
  };

  const check = async () => {
    forget();
    setBusy(true);
    try {
      adopt(await printing.checkPrinter());
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    forget();
    setBusy(true);
    try {
      const found = await printing.pairPrinter({ model, label });
      adopt(found);
      // Null is a dismissed or empty list — a failure the module deliberately
      // does not colour the screen for, which is why this screen has to.
      if (!found) setAttemptFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const testNow = () => {
    forget();
    // `testPrint` returns void and enqueues, so what is known at this instant is
    // that the label was sent — which is what the sentence under the button then
    // says. A line claiming one came out would be a claim about the tape,
    // painted before the rasteriser had run.
    printing.testPrint(locale);
    setTested(true);
  };

  /**
   * Look for the printer again without the chooser.
   *
   * The module reopens by itself after a dropped transfer and on a connect
   * event, so this is for the case neither covers: a volunteer who has just
   * pushed a cable back in and wants to know now, not on the next label.
   */
  const lookAgain = async () => {
    forget();
    setBusy(true);
    try {
      await printing.ready();
    } finally {
      setBusy(false);
    }
  };

  /* ---- Which screen this is, and what it offers ------------------------- */

  /** Setup, reached from the chooser: no evening to list, nothing to reprint. */
  const setup = !onReprintByName;
  /** The ten seconds of boot retries after a wake, or after a failed look. */
  const stillLooking = state.kind === 'unpaired' && state.searching;
  /**
   * Drawn in both values of `searching`, dimmed while it is true.
   *
   * It used to arrive only once the ladder settled — so a control materialised
   * under a thumb already on its way down, in the place the model row had been.
   */
  const canLookAgain = state.kind === 'trouble' || state.kind === 'unpaired';
  /**
   * Whether a reprint has anything to aim at.
   *
   * The *fact*, not the prop: `pairPrinter` writes the config and tells
   * `KioskApp` nothing, so a volunteer who came here because a sticker was
   * missing connected successfully, watched the two checks come alive, and
   * found the one door they came for still grey until they pressed Done and
   * walked back in through it.
   */
  const canReprint = Boolean(detection) || hasConfig || state.kind === 'ready';
  /**
   * Mid-evening, with a queue: the brand slot is the control that fixes the
   * evening rather than the one that cannot run without it.
   *
   * On a kiosk whose printer is working it stays Reprint — that is the door
   * this screen is open for, and a saturated *Connect* over a bound kiosk is
   * the browser's USB sheet one mis-aim away.
   */
  const connectLeads = !setup && gatheringPrints && state.kind !== 'ready';
  const rollAmbiguous = detection !== null && detection.matched.length > 1;

  const nameOf = (entry: Label) => printing.labelName(entry);
  const account = detection ? detectionAccount(t, detection, label, nameOf) : null;
  const line = stateLine(t, printerNote, state, detection);
  // Newest first, and read on every render rather than held in state: the
  // record moves whenever the state does, which is what re-renders this.
  const events = printing.printerLog().slice(-MAX_EVENTS_SHOWN).reverse();
  const now = Date.now();

  /**
   * The one saturated control, carrying the verb this state deserves.
   *
   * The set-up screen had none: *Connect a printer* was the dimmest of five
   * controls, fifth down, under two disabled buttons and an empty card, with a
   * bold **Done** as the loudest thing on a screen whose whole job was to get a
   * printer connected. One blue per state, and the word on it is what pressing
   * it does.
   */
  const primary = ((): { label: string; press: () => void } | null => {
    if (!setup && !connectLeads) {
      return onReprintByName
        ? {
            label: t('reprint'),
            press: () => {
              haptic();
              forget();
              onReprintByName();
            },
          }
        : null;
    }
    switch (state.kind) {
      case 'ready':
        // Unreachable mid-evening — `connectLeads` excludes it — so this is the
        // set-up screen's proof step.
        return { label: t('testPrint'), press: testNow };
      case 'trouble':
        return { label: t('lookAgain'), press: () => void lookAgain() };
      case 'unpaired':
        /*
         * The same verb in both values of `searching`. A control that reads
         * *Connect this printer again* while the kiosk is looking and something
         * else once it has settled is a button that changes its mind under a
         * finger, and the press is harmless either way: the chooser is filtered
         * to Brother devices, so picking the QL lands where the ladder was
         * going, a second or two sooner.
         */
        return { label: t('connectThisAgain'), press: () => void connect() };
      case 'unsupported':
        // A browser that cannot talk to USB will not start being able to
        // because somebody asked again. The line above says so; no button
        // pretends otherwise.
        return null;
      default:
        return { label: t('connectThePrinter'), press: () => void connect() };
    }
  })();

  /** Whether pressing the primary opens the browser's own device list. */
  const primaryOpensChooser =
    primary !== null &&
    (setup || connectLeads) &&
    (state.kind === 'idle' || state.kind === 'unpaired');

  /**
   * What the primary's press produced, or what it is about to.
   *
   * One slot, under the control it belongs to, in one order: the account of the
   * last press first, then the standing instruction. The post-test line used to
   * be rendered *above* the primary, which pushed it 36px down — so the
   * ordinary response to a blank label, pressing the same button again, landed
   * on prose.
   */
  const primarySays: ReactNode[] = [];
  if (primary !== null) {
    if (attemptFailed && state.kind !== 'ready') {
      primarySays.push(
        <Say key="cancelled" tone="text-ink-100">
          {t('selectionCancelled')}
        </Say>,
      );
    }
    if (state.kind === 'ready') {
      if (account !== null) {
        primarySays.push(
          <Say key="account" tone="text-ink-100">
            {account}
          </Say>,
        );
      }
      if (rollAmbiguous) {
        // A black-only test label comes out identically off either 62mm roll,
        // so the test cannot settle which is loaded — the spindle can, and the
        // question is now directly below. What the test *can* settle is that a
        // whole label comes out, which is what it is asked for here.
        primarySays.push(
          <Say key="roll">{rollAnswered ? t('rollPicked') : t('pickTheRoll')}</Say>,
        );
      } else if (tested) {
        primarySays.push(
          <Say key="sent" tone="text-ink-100">
            {t('testSent')}
          </Say>,
          <Say key="waiting">{t('stillWaiting')}</Say>,
        );
      } else if (setup) {
        primarySays.push(<Say key="be-sure">{t('testToBeSure')}</Say>);
      }
    } else if (state.kind === 'trouble') {
      primarySays.push(<Say key="then">{t('troubleThenLookAgain')}</Say>);
    } else {
      if (stillLooking) primarySays.push(<Say key="wait">{t('mayConnectItself')}</Say>);
      else if (state.kind === 'unpaired' && !attemptFailed)
        primarySays.push(<Say key="cable">{t('checkPowerAndCable')}</Say>);
      else if (!hasConfig) primarySays.push(<Say key="plug">{t('plugInFirst')}</Say>);
      if (primaryOpensChooser)
        primarySays.push(<Say key="window">{t('connectOpensWindow')}</Say>);
    }
  }

  /**
   * A control below the blue one: same family, no fill of its own to compete
   * with, and never the `disabled` attribute.
   *
   * `disabled` suppresses `:active`, so a dead control answers a press with
   * nothing at all — which on a lobby tablet is indistinguishable from a device
   * that has frozen. `aria-disabled` says the same thing to a reader, the press
   * still paints, and the line under the group says why.
   */
  const secondary = (
    key: string,
    label: string,
    press: () => void,
    dim = false,
  ): ReactNode => (
    <button
      key={key}
      type="button"
      tabIndex={-1}
      aria-disabled={dim || undefined}
      {...tap(() => {
        if (!dim) press();
      })}
      className={`rounded-xl bg-ink-800 p-4 text-sm text-ink-100 active:bg-ink-700 kiosk:text-lg ${
        dim ? 'opacity-50' : ''
      }`}
    >
      {label}
    </button>
  );

  const checksDim = busy || state.kind !== 'ready';
  const checkAndTest = (
    <div key="checks" className="grid shrink-0 grid-cols-2 gap-3">
      {secondary('check', t('checkPrinter'), () => void check(), checksDim)}
      {secondary('test', t('testPrint'), testNow, checksDim)}
    </div>
  );

  return (
    <div className="flex h-full flex-col p-6">
      {/*
        * The head, inside the column the rest of the screen is built in, and
        * holding two things: what this screen is, and what the printer is
        * doing. Everything else it used to carry — the advice, the Android
        * sentence — is prose, and prose belongs under the control it is about.
        *
        * That is also what holds the primary at one y across every configured
        * state without a padded band, which is what stops a control arriving
        * under a thumb when the boot ladder settles.
        */}
      <div
        className={`mx-auto w-full max-w-2xl pb-4 text-center ${setup ? '' : 'lg:max-w-5xl'}`}
      >
        <div className="text-lg font-medium text-ink-400 kiosk:text-xl">{t('title')}</div>
        <div className={`pt-1 text-sm kiosk:text-base ${line.tone}`}>
          {stillLooking ? (
            /* The app's own busy mark, so both screens say "working" the same
               way. Ten seconds of an ellipsis that never moves is a tablet a
               volunteer decides has frozen. */
            <span className="flex items-center justify-center gap-2">
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              {line.text}
            </span>
          ) : (
            line.text
          )}
        </div>
      </div>

      {/*
        * Two columns where there is width for them, one where there is not.
        *
        * On 1280x800 this screen used to spend a quarter of its track on two
        * selects that are chosen once at unboxing — each offering one real
        * option — cut the label list mid-row, and put all four buttons below the
        * fold, including the reprint door. What a volunteer could see was a list
        * of `Print again` chips, so that is what they pressed, and the
        * guess-the-last-label habit survived the redesign. Meanwhile 47% of the
        * width was empty page.
        *
        * The act group leads in both shapes, and the reference group is
        * anchored to the foot rather than trailing the act: the void then falls
        * between two masses instead of hanging off one, and nothing a thumb
        * aims at moves to buy it.
        */}
      <div
        className={`mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-8 ${
          setup
            ? 'overflow-y-auto'
            : 'lg:grid lg:max-w-5xl lg:grid-cols-2 lg:grid-rows-1 lg:gap-6'
        }`}
      >
        <div
          className={`flex shrink-0 flex-col gap-6 ${
            setup ? '' : 'lg:order-2 lg:min-h-0 lg:overflow-y-auto'
          }`}
        >
          {primary !== null && (
            <Unit>
              <button
                type="button"
                tabIndex={-1}
                {...tap(primary.press)}
                className="flex h-16 w-full shrink-0 items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white active:bg-brand-500 kiosk:h-20 kiosk:text-xl"
              >
                {primary.label}
              </button>
              {primarySays}
            </Unit>
          )}

          {/*
            * The roll question, in the act rather than under the fold.
            *
            * It lived at the bottom of a 570px `details` behind a 69px
            * *Change*, 500px below the sentence that said "pick it below" — so
            * the nearest control under that sentence was the one that re-pairs
            * the printer. On the one state whose whole subject is a question,
            * the question is the act.
            */}
          {rollAmbiguous && (
            <Unit>
              <div className="max-w-xl shrink-0 text-sm text-ink-300 kiosk:text-base">
                {t('whichOnSpindle')}
              </div>
              <div className="grid shrink-0 grid-cols-1 gap-3">
                {detection.matched.map((entry) => (
                  <button
                    key={entry.identifier}
                    type="button"
                    tabIndex={-1}
                    aria-pressed={entry.identifier === label}
                    {...tap(() => onLabelChange(entry.identifier))}
                    /* The app's own selected-tile treatment rather than a
                       second brand fill. Promoted to a 60px full-width row, a
                       `bg-brand-600` chip wore the primary's silhouette as well
                       as its colour 650px under a primary that had just taught
                       "blue is the thing to press" — and this blue is an answer
                       already given. */
                    className={`flex w-full items-center rounded-xl p-4 text-base kiosk:text-lg ${
                      entry.identifier === label
                        ? 'bg-brand-600/25 text-brand-200 ring-2 ring-brand-500'
                        : 'bg-ink-800 text-ink-100 active:bg-ink-700'
                    }`}
                  >
                    {printing.labelName(entry)}
                  </button>
                ))}
              </div>
            </Unit>
          )}

          {/* Set-up: whichever second control this state has, with the sentence
              that belongs to it. */}
          {setup && state.kind === 'trouble' && (
            <Unit>
              {secondary('connect-again', t('connectThisAgain'), () => void connect(), busy)}
              <Say>{t('connectOpensWindow')}</Say>
            </Unit>
          )}
          {setup && state.kind === 'unpaired' && (
            <Unit>
              {secondary('look-again', t('lookAgain'), () => void lookAgain(), busy || stillLooking)}
            </Unit>
          )}
          {setup && state.kind === 'ready' && (
            <Unit>
              {secondary('different', t('connectDifferent'), () => void connect(), busy)}
              {/* A dismissed list on a *working* kiosk. The rule is never amber
                  on green, not never an account on green: without this the one
                  press available here changed nothing at all. */}
              {attemptFailed && (
                <Say tone="text-ink-100">
                  {t('stillOnPrinter', { model: detection?.config.model ?? model })}
                </Say>
              )}
            </Unit>
          )}

          {/* Mid-evening: the doors this screen has always had, grouped so the
              reason sits with whatever is greyed. */}
          {!setup && (
            <Unit>
              <div className="flex shrink-0 flex-col gap-3">
                {connectLeads &&
                  onReprintByName &&
                  secondary(
                    'reprint',
                    t('reprint'),
                    () => {
                      haptic();
                      forget();
                      onReprintByName();
                    },
                    !canReprint,
                  )}
                {canLookAgain &&
                  connectLeads &&
                  (state.kind === 'trouble'
                    ? secondary('connect-again', t('connectThisAgain'), () => void connect(), busy)
                    : secondary('look-again', t('lookAgain'), () => void lookAgain(), busy || stillLooking))}
                {checkAndTest}
              </div>
              {!canReprint ? (
                <Say>{t('reprintNeedsPrinter')}</Say>
              ) : (
                checksDim && <Say>{t('checksNeedPrinter')}</Say>
              )}
            </Unit>
          )}
          {!setup && state.kind === 'ready' && (
            /* A full step below the benign pair, because it is the one control
               here that can re-bind a live kiosk — a thumb aimed at the bottom
               of *Print a test label* used to land 12px away on the browser's
               device sheet, over a queue. */
            <Unit>
              {secondary('different', t('connectDifferent'), () => void connect(), busy)}
              {attemptFailed && (
                <Say tone="text-ink-100">
                  {t('stillOnPrinter', { model: detection?.config.model ?? model })}
                </Say>
              )}
            </Unit>
          )}
        </div>

        <div
          className={`mt-auto flex min-h-0 shrink flex-col gap-3 ${
            setup ? '' : 'lg:order-1 lg:mt-0'
          }`}
        >
          {!setup && (
            /* The card is the height of the evening, not the height of the track. */
            <div className="flex max-h-full min-h-0 flex-col rounded-xl bg-ink-900 p-4 lg:self-start">
              {/* Named for what the group holds rather than for how the rows in it
                  ended: under "Printed tonight" the amber row reading *Did not
                  print* is an exception to its own heading, and that row is the one
                  a volunteer is here for. */}
              <div className="shrink-0 px-4 pb-3 text-sm text-ink-400 kiosk:text-base">
                {t('tagsTonight')}
              </div>
              {printedTonight.length === 0 ? (
                <div className="px-4 text-sm text-ink-500 kiosk:text-base">
                  {t('nothingPrinted')}
                </div>
              ) : (
                /* The card's own padding is the dead gutter the list stops against,
                   and the ramp is what stops a clipped row from being a row with
                   half a name on it flush against the next control. Both are worked
                   out on the search screen; neither was here. */
                <div
                  ref={regionRef}
                  className={`flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scroll-touch ${
                    overflowing ? 'kiosk-list-fade' : ''
                  }`}
                  style={{ touchAction: 'pan-y', ...fadeVars }}
                >
                  <div ref={contentRef} className="flex shrink-0 flex-col gap-2">
                    {printedTonight.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        tabIndex={-1}
                        {...rowTap(entry)}
                        className={`flex h-14 w-full shrink-0 items-center justify-between rounded-lg bg-ink-800 px-4 text-left active:bg-ink-700 kiosk:h-16 ${
                          /* The row a volunteer most wants — a label that never came
                             out — was distinguished by fourteen pixels of amber text
                             on the right edge of a five-row list.

                             Inset, because this list scrolls: a scrolling box clips
                             at its padding edge on both axes, and there is no gutter
                             between these rows and that edge — so an outer ring,
                             which a browser draws outside the border box, arrived
                             with its left and right strokes shaved off. The same
                             defect the register's question list had. */
                          entry.failed ? 'inset-ring-1 inset-ring-warn-500/40' : ''
                        }`}
                      >
                        <span className="min-w-0 truncate text-base font-semibold text-ink-100 kiosk:text-lg">
                          {entry.name}
                        </span>
                        <span
                          className={`shrink-0 pl-3 text-sm whitespace-nowrap kiosk:text-base ${
                            entry.failed ? 'font-semibold text-warn-400' : 'text-ink-500'
                          }`}
                        >
                          {entry.failed ? t('didNotPrint') : clockTime(locale, entry.atMs)}
                        </span>
                      </button>
                    ))}
                  </div>
                  {overflowing && (
                    <div aria-hidden className="shrink-0" style={{ height: 'var(--kiosk-fade)' }} />
                  )}
                </div>
              )}
            </div>
          )}

          {/*
            * Settings chosen once at unboxing, folded to what they are set to.
            * `details` rather than a state flag: the browser already owns this
            * and the kiosk bundle has a budget.
            *
            * Two reference rows, one value: this summary was a rung brighter
            * than the log's beside it, which made the closed disclosure of
            * reference data the brightest ink on the screen.
            */}
          {hasConfig || detection ? (
            <details className="shrink-0 rounded-xl bg-ink-900">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 text-base text-ink-300 kiosk:text-lg [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 truncate">
                  {model} ·{' '}
                  {printing.labelName(
                    available.find((entry) => entry.identifier === label) ?? available[0],
                  )}
                </span>
                {/* Quieter than the summary in colour, not in size: this is the
                    affordance that opens the row, read at arm's length. */}
                <span className="shrink-0 text-sm text-ink-400 kiosk:text-lg">Change</span>
              </summary>
              <div className="flex flex-col gap-4 px-4 pb-4">
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-ink-400 kiosk:text-base">{t('model')}</span>
                  <select
                    aria-label={t('model')}
                    value={model}
                    onChange={(event) => onModelChange(event.target.value)}
                    className="rounded-xl border-2 border-ink-800 bg-ink-900 p-4 text-lg text-ink-100"
                  >
                    {orderedModels(printing).map((identifier) => (
                      <option key={identifier} value={identifier}>
                        {identifier}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-ink-400 kiosk:text-sm">{t('modelHint')}</span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm text-ink-400 kiosk:text-base">{t('loadedLabel')}</span>
                  <select
                    aria-label={t('loadedLabel')}
                    value={labelIsAvailable ? label : (available[0]?.identifier ?? label)}
                    onChange={(event) => onLabelChange(event.target.value)}
                    className="rounded-xl border-2 border-ink-800 bg-ink-900 p-4 text-lg text-ink-100"
                  >
                    {available.map((entry) => (
                      <option key={entry.identifier} value={entry.identifier}>
                        {printing.labelName(entry)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-ink-400 kiosk:text-sm">{t('loadedLabelHint')}</span>
                </label>

                {detection && detection.status && detection.status.errors.length > 0 && (
                  <div className="rounded-xl bg-ink-950 p-4 text-sm text-warn-400 kiosk:text-base">
                    {detection.status.errors.map((flag) => (
                      <div key={`${flag.byte}:${flag.bit}`}>{flag.message}</div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          ) : (
            /* Nothing has been read off anything yet, so there is nothing to
               fold — and two selects full of invented defaults on a kiosk with
               no printer is the screen asserting answers it does not have. */
            <Say tone="text-ink-400">{t('modelPending')}</Say>
          )}

          {/*
            * What has happened to the printer lately.
            *
            * For whoever is standing here with a screen that says the printer
            * was unplugged and a cable that is still in. The record is the
            * module's — every state change, every device the browser listed or
            * lost, the browser's own name for each failure, and what the
            * transport saw on the wire — and this is the only place it is
            * read. Folded, because on an ordinary evening nobody needs it, and
            * copyable, because the person who can read it is usually not the
            * person standing here.
            */}
          <details
            className="shrink-0 rounded-xl bg-ink-900"
            onToggle={(event) => setEventsOpen((event.target as HTMLDetailsElement).open)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 text-base text-ink-300 kiosk:text-lg [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">{t('recentEvents')}</span>
              <span className="shrink-0 text-sm text-ink-400 kiosk:text-lg">
                {eventsOpen ? 'Hide' : 'Show'}
              </span>
            </summary>
            <div className="flex flex-col gap-3 px-4 pb-4">
              {events.length === 0 ? (
                <div className="text-sm text-ink-500 kiosk:text-base">{t('nothingWritten')}</div>
              ) : (
                <div
                  className="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain scroll-touch font-mono text-xs text-ink-400 kiosk:text-sm"
                  style={{ touchAction: 'pan-y' }}
                >
                  {events.map((entry, index) => (
                    <div key={`${entry.t}-${index}`} className="flex gap-3">
                      <span className="w-16 shrink-0 text-ink-500">
                        {printing.describeAge(ages, entry.t, now)}
                      </span>
                      <span className="min-w-0 break-all">{printing.describeEntry(entry)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  tabIndex={-1}
                  {...tap(() => void copyEvents())}
                  className="rounded-lg bg-ink-800 px-4 py-2 text-sm text-ink-100 active:bg-ink-700 kiosk:text-base"
                >
                  {copied === 'copied' ? 'Copied' : 'Copy'}
                </button>
                {copied === 'failed' && (
                  <span className="text-xs text-ink-500 kiosk:text-sm">{t('copyBlocked')}</span>
                )}
                <span aria-live="polite" className="sr-only">
                  {copied === 'copied' ? t('eventsCopied') : ''}
                </span>
              </div>
              {copied === 'failed' && (
                <textarea
                  readOnly
                  aria-label={t('events')}
                  rows={6}
                  value={printing.printerLogText()}
                  className="w-full rounded-lg bg-ink-950 p-3 font-mono text-xs text-ink-300"
                />
              )}
            </div>
          </details>

          {/* An errand for the person with the laptop on a Tuesday, so it sits
              with the reference rather than competing with the test label at
              9:03 on a Sunday. It is still the top cause of the state above. */}
          {state.kind === 'ready' && <Say tone="text-ink-400">{t('autoPowerOff')}</Say>}
        </div>
      </div>

      {/* The way out, at the weight of a way out. A full-width slab carrying the
          largest type on the screen made the terminal exit outweigh the blue
          door this screen was reorganised to expose — and it is the same control
          the reprint screen already draws as a pill in its console row.

          Promoted on the one frame where leaving *is* the next act: a volunteer
          who has just sent a test label has done the last thing this screen is
          for, and the sentence above names this button. */}
      <div className="mx-auto flex w-full max-w-2xl justify-center pt-7 pb-[max(1rem,var(--spacing-safe-bottom))] lg:max-w-5xl lg:pt-4">
        <button
          type="button"
          tabIndex={-1}
          {...tap(onDone)}
          /* `min-w-0 shrink truncate`, because this button has two labels now
             and the longer one names where it goes — the same shape the reprint
             screen's way out already wears for the same sentence. */
          className={`flex h-14 min-w-0 shrink items-center justify-center truncate rounded-xl px-10 text-base whitespace-nowrap tall:h-16 kiosk:text-lg ${
            setup && !tested
              ? 'bg-ink-900 font-medium text-ink-300 active:bg-ink-800'
              : 'bg-ink-800 font-semibold text-ink-100 active:bg-ink-700'
          }`}
        >
          {setup
            ? t('backToGatherings')
            : returnsTo === 'check-in'
              ? tStaff('doneBackToCheckIn')
              : t('done')}
        </button>
      </div>
    </div>
  );
}
