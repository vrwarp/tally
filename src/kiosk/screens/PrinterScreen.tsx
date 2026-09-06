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
import { useCallback, useEffect, useState } from 'react';
import { haptic } from '@/lib/utils';
import { useTap, useTapGuard } from '../components/tapGuard';
import { useOverflowFade } from '../components/useOverflowFade';
import type { KioskPrinting } from '../KioskApp';
// Type-only. Every value this screen needs from the library arrives through the
// `printing` handle, because this component is referenced statically by KioskApp
// and a direct import would put the transport into the first-paint graph.
import type {
  Label,
  PrintedLabel,
  PrinterConfig,
  PrinterDetection,
  PrinterState,
} from '../printing';

/** The models this was built against, offered first. */
const PREFERRED_MODELS = ['QL-810W', 'QL-800', 'QL-820NWB'];

function orderedModels(printing: KioskPrinting): string[] {
  const all = printing.modelIdentifiers();
  const preferred = PREFERRED_MODELS.filter((model) => all.includes(model));
  return [...preferred, ...all.filter((model) => !preferred.includes(model))];
}

function stateLine(state: PrinterState): { text: string; tone: string } {
  switch (state.kind) {
    case 'ready':
      return { text: 'Connected and ready.', tone: 'text-present-400' };
    case 'unpaired':
      return { text: 'No printer connected yet.', tone: 'text-ink-400' };
    case 'unsupported':
      return { text: state.message, tone: 'text-warn-400' };
    case 'trouble':
      return { text: state.message, tone: 'text-warn-400' };
    default:
      return { text: 'No printer set up on this kiosk.', tone: 'text-ink-400' };
  }
}

/**
 * What the printer just told us, as the sentence a volunteer needs.
 *
 * Above the settings rather than inside them, because the settings are folded:
 * a roll that had to be guessed is exactly the thing somebody would never open
 * a `details` to discover.
 *
 * `label` is the *current* selection rather than the detected one, so the line
 * stays true after somebody takes the other chip.
 */
function detectionNotice(
  detection: PrinterDetection,
  label: string,
  nameOf: (entry: Label) => string,
): { lines: string[]; tone: string } | null {
  // The printer did not answer. The state line at the top of the screen is
  // already saying why, and saying it twice helps nobody.
  if (!detection.status) return null;

  const media = `${detection.status.mediaWidthMm}mm ${
    detection.status.mediaType === 'die-cut' ? 'die-cut' : 'continuous'
  }`;
  const lines: string[] = [];
  let tone = 'text-ink-400';

  if (!detection.modelFromPrinter) {
    lines.push(
      `The printer did not say which model it is — check that ${detection.config.model} is right.`,
    );
    tone = 'text-warn-400';
  }

  const chosen = detection.matched.find((entry) => entry.identifier === label);
  if (detection.matched.length === 0) {
    lines.push(`${media} is loaded, and no roll this printer takes is that size.`);
    tone = 'text-warn-400';
  } else if (detection.matched.length > 1) {
    lines.push(
      `${media} is loaded, which is more than one roll. Set to ${nameOf(
        chosen ?? detection.matched[0],
      )} — change it below if that is not what is on the spindle.`,
    );
    tone = 'text-warn-400';
  } else {
    lines.push(
      `Read off the printer: ${detection.config.model}, ${nameOf(detection.matched[0])}.`,
    );
  }

  return { lines, tone };
}

/** "6:41 PM", the way every other time on this device is written. */
function clockTime(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function PrinterScreen({
  printing,
  config,
  printedTonight,
  onReprint,
  onReprintByName,
  onDone,
}: {
  printing: KioskPrinting;
  config: PrinterConfig;
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
  onDone: () => void;
}) {
  const [state, setState] = useState<PrinterState>(() => printing.currentState());
  const [model, setModel] = useState(config.model);
  const [label, setLabel] = useState(config.label);
  const [detection, setDetection] = useState<PrinterDetection | null>(null);
  const [busy, setBusy] = useState(false);
  const rowTap = useTapGuard(onReprint);
  const tap = useTap();
  const { regionRef, contentRef, overflowing, fadeVars } = useOverflowFade();

  useEffect(() => printing.subscribe(setState), [printing]);

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

  const onModelChange = (nextModel: string) => {
    setModel(nextModel);
    const fits = printing.labelsForModel(nextModel);
    const nextLabel = fits.some((entry) => entry.identifier === label)
      ? label
      : (fits[0]?.identifier ?? label);
    setLabel(nextLabel);
    void apply({ model: nextModel, label: nextLabel });
  };

  const onLabelChange = (nextLabel: string) => {
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
    setDetection(found);
    setModel(found.config.model);
    setLabel(found.config.label);
  };

  const check = async () => {
    setBusy(true);
    try {
      adopt(await printing.checkPrinter());
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      adopt(await printing.pairPrinter({ model, label }));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (entry: Label) => printing.labelName(entry);
  const notice = detection ? detectionNotice(detection, label, nameOf) : null;
  const line = stateLine(state);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="pb-4 text-center">
        <div className="text-lg font-medium text-ink-400 kiosk:text-xl">Label printer</div>
        <div className={`pt-1 text-sm kiosk:text-base ${line.tone}`}>{line.text}</div>
        {state.kind === 'trouble' && state.advice && (
          <div className="pt-1 text-sm text-ink-500 kiosk:text-base">{state.advice}</div>
        )}
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
        * Stacked rather than gridded at narrow widths, so the slack of a quiet
        * evening falls *below* both blocks rather than between them: a `1fr` row
        * for the list put five names in a 750px card and left a matching hole
        * under the doors.
        */}
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-4 lg:grid lg:max-w-5xl lg:grid-cols-2 lg:grid-rows-1 lg:gap-6">
        {/* The card is the height of the evening, not the height of the track. */}
        <div className="flex max-h-full min-h-0 flex-col rounded-xl bg-ink-900 p-4 lg:self-start">
          {/* Named for what the group holds rather than for how the rows in it
              ended: under "Printed tonight" the amber row reading *Did not
              print* is an exception to its own heading, and that row is the one
              a volunteer is here for. */}
          <div className="shrink-0 px-4 pb-3 text-sm text-ink-400 kiosk:text-base">
            Name tags tonight
          </div>
          {printedTonight.length === 0 ? (
            <div className="px-4 text-sm text-ink-500 kiosk:text-base">
              Nothing has printed on this kiosk tonight.
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
                         on the right edge of a five-row list. */
                      entry.failed ? 'ring-1 ring-warn-500/40' : ''
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
                      {entry.failed ? 'Did not print' : clockTime(entry.atMs)}
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

        <div className="flex shrink-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
          {/*
            * What connecting just found out, outside the fold.
            *
            * The two settings below it are answered by the printer now, so the
            * job of this column is no longer to ask — it is to show the answers
            * and be honest about the one of them that is a guess. A roll chosen
            * for somebody because the packet could not choose is the sentence
            * this screen most owes a volunteer, and it cannot live inside a
            * `details` nobody has a reason to open.
            */}
          {notice && (
            <div className="shrink-0 rounded-xl bg-ink-900 p-4">
              {notice.lines.map((text) => (
                <div key={text} className={`text-sm kiosk:text-base ${notice.tone}`}>
                  {text}
                </div>
              ))}
            </div>
          )}

          {/*
            * Settings chosen once at unboxing, folded to what they are set to.
            * `details` rather than a state flag: the browser already owns this
            * and the kiosk bundle has a budget.
            */}
          <details className="shrink-0 rounded-xl bg-ink-900">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 text-base text-ink-200 kiosk:text-lg [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">
                {model} · {printing.labelName(available.find((entry) => entry.identifier === label) ?? available[0])}
              </span>
              {/* Quieter than the summary in colour, not in size: this is the
                  affordance that opens the row, read at arm's length. */}
              <span className="shrink-0 text-sm text-ink-400 kiosk:text-lg">Change</span>
            </summary>
            <div className="flex flex-col gap-4 px-4 pb-4">
              <label className="flex flex-col gap-1">
                <span className="text-sm text-ink-400 kiosk:text-base">Printer model</span>
                <select
                  aria-label="Printer model"
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
                <span className="text-xs text-ink-500 kiosk:text-sm">
                  Filled in from the printer when it was connected. It has to match the machine on
                  the shelf, so change it if it does not.
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm text-ink-400 kiosk:text-base">Loaded label</span>
                <select
                  aria-label="Loaded label"
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
                <span className="text-xs text-ink-500 kiosk:text-sm">
                  What is in the printer now, sensed when it was connected. Events describe what the
                  label says, never its size.
                </span>
              </label>

              {/* Only when the packet could not choose. One match is already the
                  answer in the select above, and a chip saying "use what you
                  are using" is a control that does nothing. */}
              {detection && detection.matched.length > 1 && (
                <div className="rounded-xl bg-ink-950 p-4">
                  <div className="pb-2 text-sm text-ink-400 kiosk:text-base">
                    The printer cannot tell these two apart. Which is on the spindle?
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detection.matched.map((entry) => (
                      <button
                        key={entry.identifier}
                        type="button"
                        tabIndex={-1}
                        onClick={() => onLabelChange(entry.identifier)}
                        className={`rounded-lg px-4 py-2 text-ink-100 ${
                          entry.identifier === label ? 'bg-brand-600' : 'bg-ink-800'
                        }`}
                      >
                        {printing.labelName(entry)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {detection && detection.status && detection.status.errors.length > 0 && (
                <div className="rounded-xl bg-ink-950 p-4 text-sm text-warn-400 kiosk:text-base">
                  {detection.status.errors.map((flag) => (
                    <div key={`${flag.byte}:${flag.bit}`}>{flag.message}</div>
                  ))}
                </div>
              )}
            </div>
          </details>

          {/*
            * The saturated control on a screen about reprinting used to be
            * **Choose a different printer** — the one that unbinds the printer —
            * and a hurried volunteer aims at colour. It is the by-name reprint
            * instead: the door this screen is now open for.
            *
            * Not gated on the device, unlike its two neighbours. This is the
            * one control in the column that goes to another screen rather than
            * talking to the printer, and a door disabled because a transport is
            * not claimed is a door that refuses the errand the reprint screen
            * exists to report on.
            */}
          {onReprintByName && (
            <button
              type="button"
              tabIndex={-1}
              {...tap(() => {
                haptic();
                onReprintByName();
              })}
              className="flex h-16 w-full shrink-0 items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white active:bg-brand-500 kiosk:h-20 kiosk:text-xl"
            >
              Reprint a name tag
            </button>
          )}

          {/* One size across the three secondary doors, and let colour do the
              ranking on its own: `text-base text-ink-300` on the unbind against
              `text-sm text-ink-100` on its two siblings made the largest of the
              three also the dimmest — size saying *more important*, colour
              saying *less available*, on the one control here that takes the
              printer away from the kiosk. */}
          <div className="grid shrink-0 grid-cols-2 gap-3">
            <button
              type="button"
              tabIndex={-1}
              disabled={busy || state.kind !== 'ready'}
              onClick={() => void check()}
              className="rounded-xl bg-ink-800 p-4 text-sm text-ink-100 disabled:opacity-50 kiosk:text-lg"
            >
              Check the printer
            </button>
            <button
              type="button"
              tabIndex={-1}
              disabled={busy || state.kind !== 'ready'}
              onClick={() => printing.testPrint()}
              className="rounded-xl bg-ink-800 p-4 text-sm text-ink-100 disabled:opacity-50 kiosk:text-lg"
            >
              Print a test label
            </button>
          </div>

          {/* The one place requestDevice is called, and the reason this is a
              real click: the browser only opens its chooser for a gesture. */}
          <button
            type="button"
            tabIndex={-1}
            disabled={busy}
            onClick={() => void connect()}
            className="shrink-0 rounded-xl bg-ink-800 p-4 text-sm text-ink-300 disabled:opacity-50 kiosk:text-lg"
          >
            {state.kind === 'ready' ? 'Choose a different printer' : 'Connect a printer'}
          </button>
        </div>
      </div>

      {/* The way out, at the weight of a way out. A full-width slab carrying the
          largest type on the screen made the terminal exit outweigh the blue
          door this screen was reorganised to expose — and it is the same control
          the reprint screen already draws as a pill in its console row.

          Sixteen pixels above a stack whose own rhythm is twelve is not a
          category break, it is a fifth item in a list of four. Both kiosk shapes
          get the break from the column boundary; the phone has to get it from
          the gap. */}
      <div className="mx-auto flex w-full max-w-2xl justify-center pt-7 pb-[max(1rem,var(--spacing-safe-bottom))] lg:max-w-5xl lg:pt-4">
        <button
          type="button"
          tabIndex={-1}
          {...tap(onDone)}
          className="flex h-14 items-center justify-center rounded-xl bg-ink-800 px-10 text-base font-semibold whitespace-nowrap text-ink-100 active:bg-ink-700 tall:h-16 kiosk:text-lg"
        >
          Done
        </button>
      </div>
    </div>
  );
}
