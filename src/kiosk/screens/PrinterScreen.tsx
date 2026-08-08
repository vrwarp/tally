/**
 * The label printer, for whoever set the kiosk up.
 *
 * Reached from the event chooser, which is already behind the staff gate — the
 * three-second hold on the search screen's Clear key — deliberately reusing that
 * gate rather than inventing a second gesture nobody would be told about.
 * Everything here is staff-facing: a parent never sees this screen, and a parent
 * never sees a printer error anywhere else either.
 *
 * Two things have to be chosen by a person, because neither can be discovered:
 *
 * **The model.** `brother_ql` has no model detection and cannot have one. The
 * status packet carries a model byte documented as a bring-up hint, and the USB
 * product id is not a reliable map. So this is a list.
 *
 * **The media.** The printer does report the width and length it senses, and
 * `suggestLabels` maps that back onto the label table — but 62mm tape is both
 * `62` and `62red` and the packet cannot tell them apart, so detection is a
 * shortcut offered next to the list rather than a replacement for it.
 *
 * A third appears only for continuous tape: **the margins**. Die-cut media is
 * as long as it is and the text is centred in it, but tape is cut wherever the
 * renderer stops, so the blank strip above and below a name is a decision
 * nobody has made until somebody makes it — a badge holder wants a clear top
 * edge that a bare name sticker would only waste roll on. Hence steppers rather
 * than a text field: this is a touchscreen in a lobby and there is no keyboard
 * on this screen.
 *
 * The test print goes through the real path — worker, rasteriser, transport — so
 * a label coming out proves the whole chain rather than just that the device
 * answers.
 */
import { useCallback, useEffect, useState } from 'react';
import type { KioskPrinting } from '../KioskApp';
// Type-only. Every value this screen needs from the library arrives through the
// `printing` handle, because this component is referenced statically by KioskApp
// and a direct import would put the transport into the first-paint graph.
import type { PrinterConfig, PrinterState, PrinterStatus } from '../printing';

/** The models this was built against, offered first. */
const PREFERRED_MODELS = ['QL-810W', 'QL-800', 'QL-820NWB'];

function orderedModels(printing: KioskPrinting): string[] {
  const all = printing.modelIdentifiers();
  const preferred = PREFERRED_MODELS.filter((model) => all.includes(model));
  return [...preferred, ...all.filter((model) => !preferred.includes(model))];
}

/**
 * A margin as it is said out loud: `0.7 mm`, `3 mm`, never `3.0 mm`.
 *
 * The default is 0.7 — the renderer's own 8 dots — and rounding that to "1 mm"
 * on a screen whose steppers move in whole millimetres would be a number that
 * disagrees with the label coming out of the printer.
 */
function millimetres(value: number): string {
  return `${Number.parseFloat(value.toFixed(1))} mm`;
}

/**
 * One margin, changed by thumb.
 *
 * Whole millimetres, and a step lands on the whole millimetre it is heading
 * for rather than adding one to whatever fraction it started from: from the
 * 0.7mm default, **−** is 0 and **+** is 1, not −0.3 and 1.7.
 */
function MarginStepper({
  title,
  value,
  max,
  onChange,
}: {
  title: string;
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const step = (delta: number) => {
    const next = delta > 0 ? Math.floor(value) + 1 : Math.ceil(value) - 1;
    onChange(Math.min(max, Math.max(0, next)));
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-400">{title}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Less space ${title.toLowerCase()}`}
          disabled={value <= 0}
          onClick={() => step(-1)}
          className="h-12 w-12 rounded-lg bg-ink-800 text-2xl text-ink-100 disabled:opacity-40"
        >
          −
        </button>
        <span className="w-20 text-center text-lg tabular-nums text-ink-100">
          {millimetres(value)}
        </span>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`More space ${title.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => step(1)}
          className="h-12 w-12 rounded-lg bg-ink-800 text-2xl text-ink-100 disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * The sticker, roughly, so two numbers become a shape.
 *
 * Not a preview of the label — `LabelPreview` in the main app is that, and it
 * cannot come here: `PrinterScreen` is referenced statically by `KioskApp`, so
 * anything it imports is in the kiosk's first paint. This is divs, and it only
 * has to answer "which end is the big gap at".
 */
function MarginDiagram({ top, bottom, max }: { top: number; bottom: number; max: number }) {
  // Not to scale with the text, which would make a millimetre invisible. To
  // scale with each other, which is the only comparison being made.
  const band = (mm: number) => `${Math.round((mm / max) * 72)}px`;

  return (
    // A white sticker on a dark form needs an edge, or it reads as a hole —
    // the same ring `LabelPreview` puts round the real one in the main app.
    <div
      className="mx-auto w-40 overflow-hidden rounded-sm bg-white ring-1 ring-ink-700"
      aria-hidden="true"
    >
      <div style={{ height: band(top) }} />
      <div className="py-1 text-center text-sm font-semibold text-black">Ada L</div>
      <div style={{ height: band(bottom) }} />
    </div>
  );
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

export function PrinterScreen({
  printing,
  config,
  onDone,
}: {
  printing: KioskPrinting;
  config: PrinterConfig;
  onDone: () => void;
}) {
  const [state, setState] = useState<PrinterState>(() => printing.currentState());
  const [model, setModel] = useState(config.model);
  const [label, setLabel] = useState(config.label);
  const [marginTop, setMarginTop] = useState(
    config.marginTopMm ?? printing.DEFAULT_LABEL_MARGIN_MM,
  );
  const [marginBottom, setMarginBottom] = useState(
    config.marginBottomMm ?? printing.DEFAULT_LABEL_MARGIN_MM,
  );
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => printing.subscribe(setState), [printing]);

  const available = printing.labelsForModel(model);
  // A model change can leave the stored media unprintable on the new head —
  // 102mm rolls only fit the QL-1xxx — so the list is the authority and the
  // first entry is the fallback.
  const labelIsAvailable = available.some((entry) => entry.identifier === label);
  const chosenLabel = labelIsAvailable ? label : (available[0]?.identifier ?? label);
  // The margins are only a question on tape. Die-cut media is as long as it is,
  // so all a margin there could do is push a name off the centre of a label
  // somebody picked for its size.
  const entry = available.find((media) => media.identifier === chosenLabel);
  const continuous = entry ? printing.isEndless(entry) : false;

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

  /** The margins as they are stored, so every `apply` below carries them. */
  const margins = { marginTopMm: marginTop, marginBottomMm: marginBottom };

  const onModelChange = (nextModel: string) => {
    setModel(nextModel);
    const fits = printing.labelsForModel(nextModel);
    const nextLabel = fits.some((media) => media.identifier === label)
      ? label
      : (fits[0]?.identifier ?? label);
    setLabel(nextLabel);
    void apply({ model: nextModel, label: nextLabel, ...margins });
  };

  const onLabelChange = (nextLabel: string) => {
    setLabel(nextLabel);
    void apply({ model, label: nextLabel, ...margins });
  };

  // Kept even while a die-cut roll is loaded rather than cleared: swapping to
  // 62x29 for an afternoon should not cost the setting the tape had.
  const onMarginChange = (edge: 'top' | 'bottom', next: number) => {
    const nextMargins = {
      ...margins,
      [edge === 'top' ? 'marginTopMm' : 'marginBottomMm']: next,
    };
    if (edge === 'top') setMarginTop(next);
    else setMarginBottom(next);
    void apply({ model, label, ...nextMargins });
  };

  const detect = async () => {
    setBusy(true);
    try {
      const read = await printing.readStatus();
      setStatus(read);
    } finally {
      setBusy(false);
    }
  };

  const suggested = status ? printing.suggestLabels(status, model) : [];
  const line = stateLine(state);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="pb-4 text-center">
        <div className="text-lg font-medium text-ink-400">Label printer</div>
        <div className={`pt-1 text-sm ${line.tone}`}>{line.text}</div>
        {state.kind === 'trouble' && state.advice && (
          <div className="pt-1 text-sm text-ink-500">{state.advice}</div>
        )}
      </div>

      <div className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-400">Printer model</span>
            <select
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
            <span className="text-xs text-ink-500">
              There is no way to detect this — it has to match the printer on the shelf.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-400">Loaded label</span>
            <select
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
            <span className="text-xs text-ink-500">
              What is in the printer now. Events describe what the label says, never its size.
            </span>
          </label>

          {/*
            * Continuous tape only, and absent rather than disabled on die-cut:
            * a control that cannot do anything on the roll in the printer is
            * one more thing for somebody to try.
            */}
          {continuous && (
            <div className="flex flex-col gap-3 rounded-xl bg-ink-900 p-4">
              <div className="text-sm text-ink-400">Blank tape around the text</div>
              {/* Above, sticker, below — the order they come out in. */}
              <MarginStepper
                title="Above"
                value={marginTop}
                max={printing.MAX_LABEL_MARGIN_MM}
                onChange={(next) => onMarginChange('top', next)}
              />
              <MarginDiagram
                top={marginTop}
                bottom={marginBottom}
                max={printing.MAX_LABEL_MARGIN_MM}
              />
              <MarginStepper
                title="Below"
                value={marginBottom}
                max={printing.MAX_LABEL_MARGIN_MM}
                onChange={(next) => onMarginChange('bottom', next)}
              />
              <span className="text-xs text-ink-500">
                This roll has no set length, so the label is as long as the text plus these. Print a
                test label to see it.
              </span>
            </div>
          )}

          {suggested.length > 0 && (
            <div className="rounded-xl bg-ink-900 p-4">
              <div className="pb-2 text-sm text-ink-400">
                {status?.mediaWidthMm}mm {status?.mediaType === 'die-cut' ? 'die-cut' : 'continuous'} detected
                {suggested.length > 1 && ' — more than one label matches, so pick the right one'}
              </div>
              <div className="flex flex-wrap gap-2">
                {suggested.map((entry) => (
                  <button
                    key={entry.identifier}
                    type="button"
                    tabIndex={-1}
                    onClick={() => onLabelChange(entry.identifier)}
                    className="rounded-lg bg-ink-800 px-4 py-2 text-ink-100"
                  >
                    Use {printing.labelName(entry)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {status && status.errors.length > 0 && (
            <div className="rounded-xl bg-ink-900 p-4 text-sm text-warn-400">
              {status.errors.map((flag) => (
                <div key={`${flag.byte}:${flag.bit}`}>{flag.message}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            {/* The one place requestDevice is called, and the reason this is a
                real click: the browser only opens its chooser for a gesture. */}
            <button
              type="button"
              tabIndex={-1}
              disabled={busy}
              onClick={() => void printing.pairPrinter({ model, label, ...margins })}
              className="rounded-xl bg-brand-600 p-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              {state.kind === 'ready' ? 'Choose a different printer' : 'Connect a printer'}
            </button>
            <button
              type="button"
              tabIndex={-1}
              disabled={busy || state.kind !== 'ready'}
              onClick={() => void detect()}
              className="rounded-xl bg-ink-800 p-4 text-lg text-ink-100 disabled:opacity-50"
            >
              Check the printer
            </button>
            <button
              type="button"
              tabIndex={-1}
              disabled={busy || state.kind !== 'ready'}
              onClick={() => printing.testPrint()}
              className="rounded-xl bg-ink-800 p-4 text-lg text-ink-100 disabled:opacity-50"
            >
              Print a test label
            </button>
            {/* Staff only, and staff only for a reason: a parent-facing reprint
                button is a roll of labels on the floor. */}
            <button
              type="button"
              tabIndex={-1}
              disabled={busy || state.kind !== 'ready' || !printing.canReprint()}
              onClick={() => printing.reprintLast()}
              className="rounded-xl bg-ink-800 p-4 text-lg text-ink-100 disabled:opacity-50"
            >
              Reprint the last label
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl pt-4 pb-[max(1rem,var(--spacing-safe-bottom))]">
        <button
          type="button"
          tabIndex={-1}
          onClick={onDone}
          className="w-full rounded-xl bg-ink-800 p-5 text-xl font-semibold text-ink-100"
        >
          Done
        </button>
      </div>
    </div>
  );
}
