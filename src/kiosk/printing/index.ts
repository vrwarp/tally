/**
 * Everything the kiosk does with a label printer, behind one dynamic import.
 *
 * Loaded the way `services.ts` is — `void import('./printing')` after first
 * paint — with one extra condition: only if `KIOSK_KEYS.printer` says this
 * device has a printer at all. A kiosk in a lobby with no printer never parses a
 * byte of this, and that gate is answered from localStorage by `device.ts`
 * without touching the library.
 *
 * The shape of the thing:
 *
 *   KioskApp ──warm/print──▶ queue.ts ──raster──▶ raster.worker.ts (CPU)
 *                               └─────send─────▶ printer-core (USB, here)
 *
 * The worker does the rasterising because it is one long synchronous pass and
 * the kiosk's first rule is that the screen does not stutter. The transport
 * stays here because `navigator.usb` is not exposed to workers. `queue.ts` owns
 * ordering, staleness and failure, and knows about neither.
 *
 * Three things this file is careful about.
 *
 * **It never blocks a tick.** `printLabel` returns immediately and cannot throw.
 * `onConfirm` paints the green tick before the check-in write lands, and a label
 * is even less of a reason to make a parent wait.
 *
 * **It never tells a parent.** A printer problem goes into `PrinterState`, which
 * only staff-facing surfaces read. A red line beside a green tick reads as "your
 * check-in failed", and a parent cannot fix a printer anyway.
 *
 * **It keeps the device open.** `getPairedPrinterDevices` needs no user gesture,
 * so a paired printer is reopened silently at boot and held for the evening.
 * `queryStatus` is never called on the way to printing: it costs a round trip
 * and takes the printer's busy lock.
 */
import {
  BrotherQLPrinterCore,
  isWebUsbSupported,
  requestPrinterDevice,
  watchConnectionEvents,
  type PrinterStatus,
} from '@vrwarp/brother-ql-webusb/printer-core';
import type { Label } from '@vrwarp/brother-ql-webusb/labels';
import { fillLabelTokens, type LabelTemplate } from '@/lib/labelTemplate';
import type { KioskBinding } from '../binding';
import type { KioskStudent } from '../search';
import { allergyFor, forgetAllergies, forgetAllergy, startAllergyLookup } from './allergy';
import { matchLabels, modelFromProductName, preferredLabel } from './detect';
import { tokenValuesFor } from './tokens';
import {
  readPrinterConfig,
  writePrinterConfig,
  type PrinterConfig,
} from './device';
import { createLabelQueue, type LabelJob, type PrintedLabel, type RasterResult } from './queue';
import RasterWorker from './raster.worker?worker';
import type { RasterReply, RasterRequest } from './raster.worker';

export { DEFAULT_PRINTER_LABEL, DEFAULT_PRINTER_MODEL, readPrinterConfig } from './device';
export type { PrinterConfig } from './device';

/* What a child's tokens come to, kept reachable through the one handle. */
export { tokenValuesFor } from './tokens';

/*
 * The allergy lookup's own surface, re-exported so `KioskApp` reaches it the way
 * it reaches everything else here — through the one dynamically imported handle.
 */
export { ALLERGY_UNREAD, forgetAllergies, setAllergySource } from './allergy';
export type { PrintedLabel } from './queue';
export type { AllergySource } from './allergy';

/*
 * The model and label tables, re-exported for the setup screen.
 *
 * It needs them as values — a list of models, a list of media, and the media the
 * printer says it can see — and it must not import them itself. `PrinterScreen`
 * is referenced statically by `KioskApp`, so a direct import there would put the
 * tables and the transport into the first-paint graph and undo the whole reason
 * this module is loaded dynamically. Reaching them through the handle keeps the
 * boundary in one place, the same way every screen gets Firebase through
 * `services`.
 */
export { labelName, labelsForModel } from '@vrwarp/brother-ql-webusb/labels';
export { modelIdentifiers } from '@vrwarp/brother-ql-webusb/models';
export type { Label } from '@vrwarp/brother-ql-webusb/labels';
export type { PrinterStatus } from '@vrwarp/brother-ql-webusb/printer-core';

/**
 * Compile-time flag gating the end-to-end seam below. See `lib/firebase.ts`.
 */
declare const __E2E_HOOKS__: boolean;

/**
 * What the printer is doing, as far as any screen needs to know.
 *
 * Deliberately coarse. The only consumer is a staff surface deciding between
 * "fine", "somebody needs to look at this" and a sentence saying what.
 */
export type PrinterState =
  | { kind: 'idle' }
  | { kind: 'unsupported'; message: string }
  | { kind: 'unpaired' }
  | { kind: 'ready'; config: PrinterConfig }
  | { kind: 'trouble'; message: string; advice: string | null };

/**
 * What asking the printer about itself came to.
 *
 * Handed back by {@link pairPrinter} and {@link checkPrinter} so the setup
 * screen can both show the filled-in answers and say how much of them was a
 * guess. Everything in here has already been applied — this is a report, not a
 * proposal.
 */
export interface PrinterDetection {
  /** What the kiosk is set to now, printer's answers included. */
  config: PrinterConfig;
  /**
   * Whether the model came off the printer rather than being left as it was.
   *
   * False means the USB product string matched nothing in the model table, and
   * the list on the setup screen is still somebody's to answer.
   */
  modelFromPrinter: boolean;
  /**
   * Every roll the sensed media could be. Empty when nothing matched, or when
   * the printer could not be asked.
   *
   * More than one is the interesting case: `config.label` is then the plainest
   * of them rather than a fact, and the screen says which was taken.
   */
  matched: readonly Label[];
  /** The packet those came from, or `null` if the printer did not answer. */
  status: PrinterStatus | null;
}

/* -------------------------------------------------------------------------- */
/* State, and who is listening                                                 */
/* -------------------------------------------------------------------------- */

let state: PrinterState = { kind: 'idle' };
const listeners = new Set<(state: PrinterState) => void>();

function setState(next: PrinterState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

export function currentState(): PrinterState {
  return state;
}

export function subscribe(listener: (state: PrinterState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/**
 * A library error as a sentence somebody in a lobby could act on.
 *
 * The `code` values are the package's documented stable surface; the messages
 * here are ours, because "PrinterStatusError" is not something to put in front
 * of a volunteer. Anything unrecognised falls through to its own message rather
 * than to a shrug — an unknown failure that says nothing is worse than one that
 * says too much.
 */
function describe(error: unknown): { message: string; advice: string | null } {
  const code = (error as { code?: string } | null)?.code;
  const advice = (error as { platformHint?: string } | null)?.platformHint ?? null;

  switch (code) {
    case 'printer-error': {
      const flags = (error as { errors?: { message: string }[] }).errors ?? [];
      return {
        message: flags[0]?.message ?? 'The printer reported a problem.',
        advice: 'Check the lid, the roll and the cutter.',
      };
    }
    case 'disconnected':
      return { message: 'The printer was unplugged.', advice: 'Plug it back in.' };
    case 'claim-failed':
      return { message: 'Something else on this device is holding the printer.', advice };
    case 'editor-lite':
      return {
        message: 'The printer is in Editor Lite mode.',
        advice: 'Hold the Editor Lite button until its light goes out.',
      };
    case 'transfer-timeout':
    case 'status-timeout':
      return { message: 'The printer stopped responding.', advice: 'Turn it off and on again.' };
    case 'raster':
      return {
        message: 'This label does not fit the media the kiosk is set to.',
        advice: 'Check the label size on this screen.',
      };
    case 'unknown-model':
    case 'unknown-label':
      return { message: 'This kiosk is set up for a printer it cannot find.', advice: null };
    default:
      return {
        message: error instanceof Error ? error.message : 'The label did not print.',
        advice: null,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* The worker                                                                  */
/* -------------------------------------------------------------------------- */

let worker: Worker | null = null;
let nextRequestId = 1;
const waiting = new Map<number, (reply: RasterReply) => void>();

/**
 * The worker, started on first use.
 *
 * Lazily, so a kiosk whose printer has been unplugged for a month is not also
 * running a thread for it. Once started it is kept: the startup cost is paid
 * against the first label of the evening, not against every one.
 */
function rasterWorker(): Worker {
  if (worker) return worker;
  const started = new RasterWorker();
  started.onmessage = (event: MessageEvent<RasterReply>) => {
    const resolve = waiting.get(event.data.id);
    if (!resolve) return;
    // Stryker disable next-line CallExpression: the worker answers each request
    // once, so nothing can observe the entry still being there. It is here so a
    // lobby screen's map does not grow by one per label for the evening.
    waiting.delete(event.data.id);
    resolve(event.data);
  };
  worker = started;
  return started;
}

function rasterInWorker(config: PrinterConfig, job: LabelJob): Promise<RasterResult> {
  return new Promise<RasterResult>((resolve, reject) => {
    // Stryker disable next-line UpdateOperator: all this has to be is a number
    // no other in-flight request is using, and counting either way gives one.
    const id = nextRequestId++;
    waiting.set(id, (reply) => {
      if (reply.ok) resolve({ job: reply.job, pageCount: reply.pageCount });
      else reject(new Error(reply.message));
    });
    const request: RasterRequest = {
      id,
      model: config.model,
      label: config.label,
      template: job.template,
      values: job.values,
    };
    rasterWorker().postMessage(request);
  });
}

/* -------------------------------------------------------------------------- */
/* The device                                                                  */
/* -------------------------------------------------------------------------- */

let printer: BrotherQLPrinterCore | null = null;
let config: PrinterConfig | null = null;
let opening: Promise<void> | null = null;
let watching: (() => void) | null = null;

/** Attach to a device and hold it open for the evening. */
async function adopt(device: BrotherQLPrinterCore, active: PrinterConfig): Promise<void> {
  printer = device;
  device.model = active.model;
  device.on('disconnect', () => {
    // The reader loop noticed the device go. Nothing to do but say so; the
    // connect handler below picks it up again if it comes back.
    setState({ kind: 'trouble', message: 'The printer was unplugged.', advice: 'Plug it back in.' });
  });
  await device.open();
  setState({ kind: 'ready', config: active });
}

/**
 * Reopen the printer this kiosk was set up with, if it is there.
 *
 * No user gesture: `getDevices` returns what the origin has already been granted,
 * which is exactly the case a kiosk that rebooted at 4am is in.
 */
export async function ready(): Promise<PrinterState> {
  const stored = readPrinterConfig();
  if (!stored) {
    setState({ kind: 'idle' });
    return state;
  }
  config = stored;

  if (!isWebUsbSupported()) {
    setState({
      kind: 'unsupported',
      message: 'This browser cannot talk to a USB printer.',
      // No advice: nobody in a lobby is going to change browser, and the person
      // who can is reading the setup docs rather than this screen.
    });
    return state;
  }

  // Reconnection is this layer's job — the library reports connect and
  // disconnect but never reopens the device itself. One reopen on a connect
  // event is what a kiosk needs, and upstream has now seen the whole sequence
  // work on a QL-810W: an unplug mid-job is noticed in about a second and the
  // printer needs nothing after it comes back.
  watching ??= watchConnectionEvents({
    connect: () => {
      void reopen();
    },
    disconnect: () => {
      printer = null;
    },
  });

  await reopen();
  return state;
}

async function reopen(): Promise<void> {
  const active = config;
  if (!active) return;
  // A second connect event while the first reopen is still going would
  // otherwise claim the interface twice.
  if (opening) return opening;

  opening = (async () => {
    try {
      if (printer?.opened) {
        setState({ kind: 'ready', config: active });
        return;
      }
      // A transport that has already died cannot be reopened in place.
      if (printer) await printer.close().catch(() => {});
      printer = null;

      const paired = await BrotherQLPrinterCore.getPairedDevices({ model: active.model });
      const first = paired[0];
      if (!first) {
        setState({ kind: 'unpaired' });
        return;
      }
      await adopt(first, active);
    } catch (error) {
      const { message, advice } = describe(error);
      setState({ kind: 'trouble', message, advice });
    } finally {
      opening = null;
    }
  })();

  return opening;
}

/**
 * Show the browser's device chooser, then ask whatever was picked what it is.
 *
 * The one place a user gesture is required, which is why it is only ever reached
 * from a button on the printer screen. Everything after pairing — reopening at
 * boot, printing, reading status — needs none.
 *
 * `next` is what the screen was showing when the button was pressed, and it is
 * the fallback rather than the answer: a printer that names itself on the bus
 * and reports the roll it can see has just answered both of the questions that
 * screen exists to ask, and making somebody answer them again from a list is
 * asking them to confirm a guess against a fact. See {@link checkPrinter} for
 * what is and is not taken on trust.
 *
 * `null` when nothing was connected — a dismissed chooser, or a failure the
 * state now carries.
 */
export async function pairPrinter(next: PrinterConfig): Promise<PrinterDetection | null> {
  try {
    const device = await requestPrinterDevice();
    // Before `adopt`, because the model decides the head width the rasteriser
    // builds for and the device is told its model once, here.
    const chosen: PrinterConfig = {
      model: modelFromProductName(device.productName) ?? next.model,
      label: next.label,
    };
    writePrinterConfig(chosen);
    config = chosen;
    if (printer) await printer.close().catch(() => {});
    await adopt(new BrotherQLPrinterCore(device, { model: chosen.model }), chosen);
  } catch (error) {
    // Dismissing the chooser is not a failure worth colouring the screen for.
    if ((error as { code?: string }).code === 'selection-cancelled') return null;
    const { message, advice } = describe(error);
    setState({ kind: 'trouble', message, advice });
    return null;
  }
  return checkPrinter();
}

/** Change the model or media without re-pairing. */
export async function configure(next: PrinterConfig): Promise<PrinterState> {
  writePrinterConfig(next);
  config = next;
  if (printer) printer.model = next.model;
  await reopen();
  return state;
}

/**
 * Ask the printer what it has loaded.
 *
 * Only from the setup screen, and only through {@link checkPrinter}. It costs a
 * round trip and takes the busy lock, so it must never be on the way to a label.
 */
async function readStatus(): Promise<PrinterStatus | null> {
  if (!printer?.opened) return null;
  try {
    return await printer.queryStatus();
  } catch (error) {
    const { message, advice } = describe(error);
    setState({ kind: 'trouble', message, advice });
    return null;
  }
}

/**
 * The rolls the sensed media could be, or none if the tables refuse the model.
 *
 * `labelsForModel` throws on an identifier it does not carry, which a config
 * written by an older kiosk — or edited by hand — can still be. That is worth
 * saying on the screen and is not worth failing a button press over.
 */
function suggested(status: PrinterStatus, model: string): readonly Label[] {
  try {
    return matchLabels(status, model);
  } catch (error) {
    const { message, advice } = describe(error);
    setState({ kind: 'trouble', message, advice });
    return [];
  }
}

/**
 * What the printer says it is and what it says is in it, adopted.
 *
 * The setup screen's two questions, answered by the machine that knows. Both
 * answers are taken — the config is written and the kiosk is set to them — and
 * both are reported back, because neither is certain in the same way:
 *
 * **The model** is the name the device puts on the USB bus. Right on every QL
 * this has met, and `null` rather than a guess for one it cannot place, in which
 * case whatever was already set is kept and `modelFromPrinter` says so.
 *
 * **The roll** is sensed, and may not resolve to one entry in the table: 62mm
 * tape is both `62` and `62red` and the packet cannot tell them apart. Every
 * match is returned in `matched`, the plainest is taken, and a screen with more
 * than one of them in hand owes somebody a sentence about it.
 *
 * Deliberately not on the boot path. A kiosk reopening its printer at 4am must
 * not overwrite a deliberate `62red` with the roll a status packet cannot
 * distinguish from it — this runs when a person connects a printer or presses
 * the button that says it will.
 *
 * `null` when there is no open printer to ask, which is a screen state rather
 * than a failure.
 */
export async function checkPrinter(): Promise<PrinterDetection | null> {
  const active = config;
  if (!active || !printer?.opened) return null;

  const detected = modelFromProductName(printer.device?.productName);
  // Before the status read rather than after it: a read that fails leaves
  // trouble on the state, and `configure` reopens and would paint over it.
  if (detected !== null && detected !== active.model) {
    await configure({ model: detected, label: active.label });
  }
  const model = config?.model ?? active.model;

  const status = await readStatus();
  const matched = status ? suggested(status, model) : [];
  const label = preferredLabel(matched)?.identifier ?? config?.label ?? active.label;
  if (label !== config?.label) await configure({ model, label });

  return { config: { model, label }, modelFromPrinter: detected !== null, matched, status };
}

/* -------------------------------------------------------------------------- */
/* Printing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where a job goes instead of the wire, when the end-to-end suite is watching.
 *
 * There is no way to give Playwright a USB printer, so the transport is the one
 * part of this that cannot be exercised in CI. Everything upstream of it can be,
 * and is worth far more than a stub of the whole feature: a recorded job proves
 * the real worker started, `OffscreenCanvas` measured and drew real text in a
 * real browser, and `createJob` produced a plausible number of bytes — none of
 * which the unit tests can show, because jsdom has no canvas and Node has no
 * worker.
 *
 * Opt-in from the test side: the array only exists if a spec created it. A test
 * seam that ships is not a test seam, it is a way in — and this one is inside
 * `__E2E_HOOKS__` besides, so it is eliminated from anything a church deploys.
 */
function recorder(): { bytes: number; pageCount: number }[] | null {
  if (!__E2E_HOOKS__) return null;
  const held = (window as unknown as Record<string, unknown>).__tallyKioskLabels;
  return Array.isArray(held) ? (held as { bytes: number; pageCount: number }[]) : null;
}

const queue = createLabelQueue({
  raster: async (job) => {
    if (!config) throw new Error('No printer is configured.');
    const allergy = await allergyFor(job.studentId);
    return rasterInWorker(
      config,
      allergy === undefined ? job : { ...job, values: { ...job.values, allergy } },
    );
  },
  send: async (result) => {
    const recording = recorder();
    if (recording) {
      recording.push({ bytes: result.job.length, pageCount: result.pageCount });
      return;
    }
    // A label arriving while the printer is down should reopen it rather than
    // fail: the device may have been replugged without a connect event landing.
    if (!printer?.opened) await reopen();
    if (!printer?.opened) throw new Error('No printer is connected.');
    await printer.sendRaw(result.job, { pageCount: result.pageCount });
    if (state.kind === 'trouble' && config) setState({ kind: 'ready', config });
  },
  onFailure: (error) => {
    const { message, advice } = describe(error);
    setState({ kind: 'trouble', message, advice });
  },
  onDropped: (reason) => {
    if (reason === 'stale') {
      setState({
        kind: 'trouble',
        message: 'A label was skipped because it would have printed too late.',
        advice: 'Check the printer.',
      });
    }
  },
});

function jobFor(
  student: KioskStudent,
  binding: KioskBinding,
  template: LabelTemplate,
): LabelJob {
  return {
    studentId: student.id,
    // What the printer screen's log will call them. The roster's own display
    // name, not the sticker's — a template may print a first name and an
    // initial, and a volunteer looking for the label that did not come out is
    // looking for the child they can see.
    name: `${student.firstName} ${student.lastName}`.trim(),
    template,
    values: tokenValuesFor(student, binding),
  };
}

/**
 * Start building this child's label now, because the confirm screen just opened.
 *
 * The counterpart to `services.warmStudentDates`, and the reason a label is
 * moving by the time the tick paints. Callers gate this on the intent being a
 * check-in: a collection prints nothing, so warming one is work thrown away.
 */
export function warmLabel(student: KioskStudent, binding: KioskBinding): void {
  const template = binding.labelTemplate;
  if (!template) return;
  // Before the queue, not after: `warm` starts rasterising synchronously, and
  // the rasteriser is what waits for this.
  startAllergyLookup(student, template);
  queue.warm(jobFor(student, binding, template));
}

/**
 * Print this child's label. Returns immediately and never throws.
 *
 * Both of which are load-bearing: this is called from `onConfirm` after the
 * success screen has already been set, and nothing about a sticker may reach
 * back into a screen that has told a parent their child is checked in.
 */
export function printLabel(student: KioskStudent, binding: KioskBinding): void {
  const template = binding.labelTemplate;
  if (!template) return;
  // A no-op when `warmLabel` already started it, and the reason this is not
  // simply left to the warm: the printer screen reaches `printLabel` too.
  startAllergyLookup(student, template);
  queue.print(jobFor(student, binding, template));
}

/** The confirm screen closed without confirming; its label is not wanted. */
export function forgetLabel(studentId: string): void {
  queue.forget(studentId);
  // Backed out, so nothing is going to print this child's note. Dropping it here
  // rather than waiting for the cache to evict it keeps the window it is held
  // for as close to the sticker as it can be.
  forgetAllergy(studentId);
}

/**
 * Print this child's name tag again.
 *
 * Same path as `printLabel`, and deliberately not the old `reprintLast`, which
 * re-sent the bytes of whatever came out most recently. Two things follow from
 * re-rastering instead. It can be aimed: a volunteer names the child rather than
 * hoping nobody has checked in behind them. And it prints what the label *should
 * say now* — a child whose allergy note was still in flight when the first
 * sticker was drawn gets the note on the second, which is one of the four
 * reasons anybody asks for one.
 *
 * Reachable only from behind the staff gate, and from the ten-minute window on
 * the already-checked-in screen. See `reprintOffer.ts` for what bounds the
 * second one, and `docs/kiosk-reprint.md` for why a wider parent-facing reprint
 * is a roll of labels on the floor.
 */
export function reprintLabel(student: KioskStudent, binding: KioskBinding): void {
  printLabel(student, binding);
}

/**
 * What this child's sticker would say, line by line, for the reprint confirm.
 *
 * The same fill the rasteriser does, minus the drawing: a volunteer standing at
 * a printer that produced something blank is checking a suspicion, and the
 * cheapest way to answer it is to show them the words before the tape moves.
 * Lines that come to nothing are dropped exactly as the renderer drops them, so
 * the preview cannot promise a line the label will not have.
 */
export function labelPreview(student: KioskStudent, binding: KioskBinding): string[] {
  const template = binding.labelTemplate;
  if (!template) return [];
  const values = tokenValuesFor(student, binding);
  return template.lines
    .map((line) => fillLabelTokens(line.text, values))
    .filter((text) => text.length > 0);
}

/**
 * Unbinding: a kiosk that has left a gathering keeps nothing about who was at it.
 *
 * The allergy notes were already dropped here. The evening's label log goes with
 * them, and for the same reason — it is a list of children's names, held in
 * memory on a device that sits in a lobby for weeks.
 */
export function forgetGathering(): void {
  forgetAllergies();
  queue.forgetPrinted();
}

/** The evening's attempts, newest first, for the printer screen. */
export function printedTonight(): readonly PrintedLabel[] {
  return queue.printedTonight();
}

/**
 * A label with the loaded media's own dimensions on it, for setup.
 *
 * Uses the real path — worker, raster, transport — so a successful test print
 * proves the whole chain rather than just that the device answers.
 */
export function testPrint(): void {
  const active = config;
  if (!active) return;
  queue.print({
    studentId: `__test__${nextRequestId}`,
    template: {
      lines: [
        { text: 'Tally', size: 'lg', bold: true, align: 'center', requiresValue: false },
        { text: '{{eventTitle}}', size: 'sm', bold: false, align: 'center', requiresValue: false },
        { text: '{{time}}', size: 'sm', bold: false, align: 'center', requiresValue: false },
      ],
      copies: 1,
    },
    values: {
      eventTitle: `${active.model} · ${active.label}`,
      time: new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    },
  });
}

/** Waiting labels, for the printer screen. */
export function queueDepth(): number {
  return queue.depth();
}
