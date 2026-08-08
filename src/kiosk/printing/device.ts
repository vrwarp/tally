/**
 * Which printer this kiosk has, and what is loaded in it.
 *
 * A fact about the machine on this shelf, so it lives in this device's own
 * localStorage rather than on an event or in Firestore. Two fields, and both of
 * them have to be here because neither can be discovered:
 *
 * **The model.** `brother_ql` has no model detection and cannot have one — the
 * USB product id is not a reliable map to a model, and the status packet's model
 * byte is documented as a bring-up hint. So a staff member picks it once, on the
 * printer screen, and the answer is remembered.
 *
 * **The media.** The printer *does* report the width and length it senses, and
 * `suggestLabels` maps that back onto the label table — but not uniquely: 62mm
 * tape is both `62` and `62red`, and the packet cannot tell black tape from
 * black/red. So detection is offered as a shortcut on the setup screen and the
 * stored answer is what actually prints.
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
export const DEFAULT_PRINTER_MODEL = 'QL-810W';
export const DEFAULT_PRINTER_LABEL = '62x29';

function isConfig(value: unknown): value is PrinterConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<PrinterConfig>;
  return (
    typeof config.model === 'string' &&
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
