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
  /**
   * Whether either of the two answers above had to be guessed when the printer
   * was connected.
   *
   * Written by `pairPrinter` and read by the *chooser*, which is the reason it
   * is persisted at all. The printer screen has the live `PrinterDetection` in
   * hand and says which half was a guess in as many words; the chooser has only
   * this config and a state, and without this flag it reported a guessed roll
   * as a green *Printer connected* — the same fact amber on one screen and a
   * tick on the other, and the tick is the one the next six volunteers read.
   *
   * Optional because every config written before this existed lacks it, and a
   * missing flag has to mean "nothing known against it" rather than a kiosk
   * that refuses to load.
   */
  guessed?: boolean;
  /**
   * Whether this printer arrived from the tablet's policy rather than from
   * somebody pressing *Connect*.
   *
   * On a managed tablet Chrome's `WebUsbAllowDevicesForUrls` grants the printer
   * to this origin with no chooser at all, and the kiosk adopts it at boot
   * (`adoptPolicyGrant`). That is worth saying on the printer screen for one
   * practical reason rather than for provenance's sake: a volunteer looking at
   * a kiosk nobody set up needs to know that the absence of a setup step is the
   * design and not a thing they forgot, and that a replacement printer will
   * behave the same way without a visit.
   *
   * Optional for the same reason `guessed` is: every config written before this
   * existed lacks it, and absent has to read as "paired the ordinary way".
   */
  viaPolicy?: boolean;
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
  // Both flags are only ever written as `true`, so anything else — absent, or
  // some older shape's leftovers — reads as "nothing known against this
  // config". Rebuilt field by field rather than spread wholesale: this is the
  // boundary that decides what the rest of the module may believe about a
  // config, and a spread would let any key a future shape adds through it
  // unexamined.
  return {
    model: stored.model,
    label: stored.label,
    ...(stored.guessed === true ? { guessed: true } : {}),
    ...(stored.viaPolicy === true ? { viaPolicy: true } : {}),
  };
}

export function writePrinterConfig(config: PrinterConfig): void {
  writeJson(KIOSK_KEYS.printer, {
    model: config.model,
    label: config.label,
    // Omitted rather than written `false`, so the stored shape stays the two
    // fields it has always been on the ordinary kiosk.
    ...(config.guessed === true ? { guessed: true } : {}),
    /*
     * And provenance with them, which it was not until this line existed.
     *
     * `configure()` and `checkPrinter`'s settle both go to deliberate trouble
     * to carry `viaPolicy` onto the config they rewrite — and both handed it
     * to a writer that dropped it on the floor, so the flag lived exactly as
     * long as the tab did. The visible cost was that `setByPolicy` appeared on
     * the boot that adopted the printer and never again: the one sentence
     * telling a volunteer that the missing set-up step is the design, gone by
     * the next morning's reload, on every managed tablet in the building.
     */
    ...(config.viaPolicy === true ? { viaPolicy: true } : {}),
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
