/**
 * Which printer this kiosk has, and what is loaded in it.
 *
 * A fact about the machine on this shelf, so it lives in this device's own
 * localStorage rather than on an event or in Firestore. Two fields, and both are
 * stored rather than asked for at print time because neither is certain enough
 * to be re-derived under a parent's thumb:
 *
 * **The model.** Filled in from the name the printer puts on the USB bus when it
 * is connected — see `detect.ts`. That is a good default and not an authority:
 * `brother_ql` has no model detection, the USB product *id* is not a reliable
 * map, and the status packet's model byte is documented as a bring-up hint. A
 * device the table cannot place leaves whatever was already set, and the printer
 * screen's list is what settles it.
 *
 * **The media.** The printer *does* report the width and length it senses, and
 * `suggestLabels` maps that back onto the label table — but not uniquely: 62mm
 * tape is both `62` and `62red`, and the packet cannot tell black tape from
 * black/red. So connecting takes the plainer of the matches, says it did, and
 * the stored answer is what actually prints.
 *
 * What is *not* here is anything about how the sticker is arranged — the
 * margins, the quarter turn, a fixed length. Those started here and moved to the
 * template on the event, because a leader designing a label is the person who
 * can see whether it looks right, and nobody is looking at labels on the setup
 * screen. See `lib/labelTemplate.ts`.
 *
 * This module is imported by the printing entry, not by the kiosk shell, with
 * one exception: `hasConfiguredPrinter` is the gate that decides whether to load
 * the printing module at all, and it must be answerable without doing so. It
 * reads the raw key and takes no dependency on the library.
 */
import { KIOSK_KEYS, readJson, removeKey, writeJson } from '../storage';

export interface PrinterConfig {
  /** A `brother_ql` model identifier, e.g. `QL-810W`. */
  model: string;
  /** A `brother_ql` label identifier, e.g. `62x29` or `62`. */
  label: string;
}

/**
 * What a QL-800-series printer is most likely to have in it.
 *
 * The QL-810W is the model this was built against; the QL-800 differs only in a
 * per-model constant the library already carries. 62x29mm die-cut is the
 * ordinary name-badge label, and its 696x271 dot box is what the renderer
 * targets when nobody has said otherwise.
 */
// Stryker disable next-line all: a module-level constant is a *static* mutant —
// it is evaluated once when the module loads, before Stryker can activate the
// mutant for any one test, so the change never takes effect and the mutant
// reports as survived whatever the tests say. `device.test.ts` asserts both of
// these values outright.
export const DEFAULT_PRINTER_MODEL = 'QL-810W';
/* Stryker disable next-line all: static — see above. */
export const DEFAULT_PRINTER_LABEL = '62x29';

function isConfig(value: unknown): value is PrinterConfig {
  /*
   * No `typeof value === 'object'` guard in front of this. Reading a property
   * off a number or a string is `undefined` rather than a throw, so the checks
   * below already refuse every primitive; only null and undefined needed
   * handling, and `?.` is that. A guard that refused nothing the rest of the
   * function did not was a line no test could have been wrong about.
   */
  const config = value as Partial<PrinterConfig> | null | undefined;
  return (
    typeof config?.model === 'string' &&
    config.model.length > 0 &&
    typeof config.label === 'string' &&
    config.label.length > 0
  );
}

export function readPrinterConfig(): PrinterConfig | null {
  const stored = readJson<PrinterConfig>(KIOSK_KEYS.printer);
  if (!isConfig(stored)) return null;
  return { model: stored.model, label: stored.label };
}

export function writePrinterConfig(config: PrinterConfig): void {
  writeJson(KIOSK_KEYS.printer, { model: config.model, label: config.label });
}

export function clearPrinterConfig(): void {
  removeKey(KIOSK_KEYS.printer);
}

/**
 * Whether this kiosk has been set up to print.
 *
 * The gate on loading the printing module, so it answers from localStorage alone
 * and never touches `navigator.usb` or the library. A false answer is also the
 * right answer for a device whose printer grant has since been revoked: the
 * module would load, find no paired device, and say so on the printer screen.
 */
export function hasConfiguredPrinter(): boolean {
  return readPrinterConfig() !== null;
}
