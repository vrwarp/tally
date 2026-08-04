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
import { gradeDescription } from '@/lib/utils';
import type { LabelTemplate, LabelTokenValues } from '@/lib/labelTemplate';
import type { KioskBinding } from '../binding';
import type { KioskStudent } from '../search';
import {
  readPrinterConfig,
  writePrinterConfig,
  type PrinterConfig,
} from './device';
import { createLabelQueue, type LabelJob, type RasterResult } from './queue';
import RasterWorker from './raster.worker?worker';
import type { RasterReply, RasterRequest } from './raster.worker';

export { DEFAULT_PRINTER_LABEL, DEFAULT_PRINTER_MODEL, readPrinterConfig } from './device';
export type { PrinterConfig } from './device';

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
export { suggestLabels } from '@vrwarp/brother-ql-webusb/printer-core';
export type { Label } from '@vrwarp/brother-ql-webusb/labels';
export type { PrinterStatus } from '@vrwarp/brother-ql-webusb/printer-core';

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
    waiting.delete(event.data.id);
    resolve(event.data);
  };
  worker = started;
  return started;
}

function rasterInWorker(config: PrinterConfig, job: LabelJob): Promise<RasterResult> {
  return new Promise<RasterResult>((resolve, reject) => {
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
  // disconnect but never retries, and its README lists replugging mid-job as
  // unverified. One reopen on a connect event is what a kiosk needs.
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
 * Show the browser's device chooser and remember what was picked.
 *
 * The one place a user gesture is required, which is why it is only ever reached
 * from a button on the printer screen. Everything after pairing — reopening at
 * boot, printing, reading status — needs none.
 */
export async function pairPrinter(next: PrinterConfig): Promise<PrinterState> {
  try {
    const device = await requestPrinterDevice();
    writePrinterConfig(next);
    config = next;
    if (printer) await printer.close().catch(() => {});
    await adopt(new BrotherQLPrinterCore(device, { model: next.model }), next);
  } catch (error) {
    // Dismissing the chooser is not a failure worth colouring the screen for.
    if ((error as { code?: string }).code === 'selection-cancelled') return state;
    const { message, advice } = describe(error);
    setState({ kind: 'trouble', message, advice });
  }
  return state;
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
 * Only from the setup screen. It costs a round trip and takes the busy lock, so
 * it must never be on the way to a label.
 */
export async function readStatus(): Promise<PrinterStatus | null> {
  if (!printer?.opened) return null;
  try {
    return await printer.queryStatus();
  } catch (error) {
    const { message, advice } = describe(error);
    setState({ kind: 'trouble', message, advice });
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Printing                                                                    */
/* -------------------------------------------------------------------------- */

const queue = createLabelQueue({
  raster: (job) => {
    if (!config) return Promise.reject(new Error('No printer is configured.'));
    return rasterInWorker(config, job);
  },
  send: async (result) => {
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

/**
 * The values a template's tokens resolve to for this child at this gathering.
 *
 * Resolved here rather than in `labelTemplate.ts` because a grade reads as "8th
 * grade" through `gradeDescription` and a time through the locale, neither of
 * which a module shared with the Cloud Functions may import. Everything comes
 * from the roster row and the binding — which is all the kiosk has, and all it
 * is meant to have.
 */
export function tokenValuesFor(student: KioskStudent, binding: KioskBinding): LabelTokenValues {
  const now = new Date();
  return {
    firstName: student.firstName,
    lastName: student.lastName,
    // No full stop: a template that wants one can say `{{lastInitial}}.`, and a
    // child with no surname on the roster then gets nothing rather than a stray
    // dot. See `fillLabelTokens`.
    lastInitial: student.lastName ? student.lastName.slice(0, 1).toUpperCase() : '',
    grade: student.grade === null ? '' : gradeDescription(student.grade),
    eventTitle: binding.title,
    date: now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

function jobFor(
  student: KioskStudent,
  binding: KioskBinding,
  template: LabelTemplate,
): LabelJob {
  return { studentId: student.id, template, values: tokenValuesFor(student, binding) };
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
  queue.print(jobFor(student, binding, template));
}

/** The confirm screen closed without confirming; its label is not wanted. */
export function forgetLabel(studentId: string): void {
  queue.forget(studentId);
}

export function canReprint(): boolean {
  return queue.lastPrinted() !== null;
}

/** Staff only. A parent-facing reprint button is a roll of labels on the floor. */
export function reprintLast(): void {
  queue.reprintLast();
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
        { text: 'Tally', size: 'lg', bold: true, align: 'center' },
        { text: '{{eventTitle}}', size: 'sm', bold: false, align: 'center' },
        { text: '{{time}}', size: 'sm', bold: false, align: 'center' },
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
