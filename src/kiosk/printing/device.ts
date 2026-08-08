/**
 * Which printer this kiosk has, and what is loaded in it.
 *
 * A fact about the machine on this shelf, so it lives in this device's own
 * localStorage rather than on an event or in Firestore. Two fields have to be
 * here because neither can be discovered:
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
 * The margins are here for a different reason: nothing could discover them
 * because there is nothing to discover. Continuous tape has no fixed length, so
 * the blank strip above and below a name is a preference about this roll and
 * this cutter — see `marginTopMm`.
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
  /**
   * Blank millimetres above the text on continuous tape.
   *
   * A third fact about the machine on this shelf, and the only one that is a
   * preference rather than a discovery. Continuous tape has no pre-set length:
   * the sticker is as long as the renderer says and the printer cuts there, so
   * where the text sits between the two cuts is nobody's decision until
   * somebody makes it. Rolls differ, cutters differ, and a badge holder wants a
   * clear strip at the top that a bare name sticker does not.
   *
   * Ignored on die-cut media, which has its own fixed length and centres the
   * block in it. Absent means {@link DEFAULT_LABEL_MARGIN_MM}, which is what
   * every kiosk printed before this existed.
   */
  marginTopMm?: number;
  /** Blank millimetres below the text on continuous tape. See `marginTopMm`. */
  marginBottomMm?: number;
}

/**
 * The margin a continuous label has had since before it could be changed.
 *
 * 0.7mm — the renderer's own 8-dot padding, in the units the screen asks for.
 * Naming it here means "leave it alone" and "set it to what it always was" are
 * the same stored config rather than two that print differently.
 */
export const DEFAULT_LABEL_MARGIN_MM = 0.7;

/**
 * As much blank tape as either end may be given.
 *
 * 25mm is an inch of nothing, which is past any sensible badge holder and well
 * short of the length a fat-fingered stepper could otherwise spend on a roll.
 */
export const MAX_LABEL_MARGIN_MM = 25;

/**
 * A stored margin, or undefined if it is not a number this can print.
 *
 * Clamped rather than rejected: a config carrying a silly margin should still
 * print labels, and the alternative — refusing the whole config — takes a
 * kiosk's printer away over a field that has a perfectly good default.
 */
function readMargin(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_LABEL_MARGIN_MM, Math.max(0, value));
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
  return {
    model: stored.model,
    label: stored.label,
    marginTopMm: readMargin(stored.marginTopMm),
    marginBottomMm: readMargin(stored.marginBottomMm),
  };
}

export function writePrinterConfig(config: PrinterConfig): void {
  writeJson(KIOSK_KEYS.printer, {
    model: config.model,
    label: config.label,
    marginTopMm: readMargin(config.marginTopMm),
    marginBottomMm: readMargin(config.marginBottomMm),
  });
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
