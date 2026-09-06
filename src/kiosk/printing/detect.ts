/**
 * What the printer can be asked about itself, and what to do with the answers.
 *
 * Setting a kiosk up used to mean answering two questions from a list — which
 * printer is on the shelf, and what is on its spindle — and getting either
 * wrong prints a badge at the wrong size or refuses to print at all. The
 * printer knows both. Not perfectly, which is why nothing here is the last
 * word, but well enough that a volunteer should be reading a filled-in answer
 * rather than composing one.
 *
 * **The model** comes off the USB product string. `brother_ql` has no model
 * detection and the status packet's model byte is documented as a bring-up
 * hint, so this is not it either — it is the name the device puts on the bus,
 * which on every QL that has been in front of this code reads `QL-810W` and on
 * an unknown one reads something that matches nothing. So it is a good default
 * and never a lock: {@link modelFromProductName} answers `null` rather than
 * guessing, and the setup screen keeps its list.
 *
 * **The media** is genuinely sensed — the printer reports the width and the
 * length it can see — but does not resolve to one answer: 62mm tape is both
 * `62` and `62red`, and the packet cannot tell black tape from black/red. So
 * {@link matchLabels} hands back everything that fits and
 * {@link preferredLabel} takes the plainest of them, which is what a church
 * that bought one roll of labels has in the printer. The screen says when it
 * had to choose.
 *
 * Pure functions over the library's own tables, so they are testable without a
 * printer, a transport or a worker — which is the whole reason they are not in
 * `index.ts`.
 */
import {
  labelName,
  labelsForModel,
  type Label,
} from '@vrwarp/brother-ql-webusb/labels';
import { modelIdentifiers } from '@vrwarp/brother-ql-webusb/models';
import { suggestLabels, type PrinterStatus } from '@vrwarp/brother-ql-webusb/printer-core';

/**
 * Down to letters and digits, so the shapes a product string comes in all meet.
 *
 * `Brother QL-810W`, `QL-810W`, `QL_810W` and `QL810W` are one printer, and the
 * hyphen in the library's identifier is not load-bearing.
 */
function squash(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Which model this is, as far as the name it puts on the USB bus can say.
 *
 * Containment rather than equality, because the string carries a maker's name
 * on some hosts and a suffix on others — `QL-1110NWBc` is a `QL-1110NWB` with a
 * letter after it. The longest identifier that fits wins, so a printer whose
 * name contains two of them is read as the more specific one rather than as
 * whichever the table happens to list first.
 *
 * `null` for anything that matches nothing, which is the honest answer for a
 * model this library does not carry: better a list somebody has to answer than
 * a wrong model quietly rastering badges at the wrong head width.
 */
export function modelFromProductName(productName: string | null | undefined): string | null {
  if (!productName) return null;
  const haystack = squash(productName);
  if (!haystack) return null;

  let best: string | null = null;
  let bestLength = 0;
  for (const identifier of modelIdentifiers()) {
    const needle = squash(identifier);
    if (needle.length === 0 || !haystack.includes(needle)) continue;
    if (needle.length > bestLength) {
      best = identifier;
      bestLength = needle.length;
    }
  }
  return best;
}

/**
 * Every roll the sensed media could be, on the printer that sensed it.
 *
 * `suggestLabels` applies the media table and each label's restriction list;
 * what it does not apply is whether the label physically fits the head, so a
 * 62mm roll it offers for a P-touch is one the rasteriser would refuse. The
 * setup screen's own list is `labelsForModel`, which does check that, and this
 * must not be able to select something that list does not contain.
 */
export function matchLabels(status: PrinterStatus, model: string): Label[] {
  const fits = new Set(labelsForModel(model).map((entry) => entry.identifier));
  return suggestLabels(status, model).filter((entry) => fits.has(entry.identifier));
}

/**
 * The one to take when the printer's answer covers more than one roll.
 *
 * Shortest name, which is the plain version of whatever the media is: `62mm
 * endless` over `62mm endless (black/red/white)`. The special roll is the one
 * somebody went out of their way to buy, so a kiosk that guesses should guess
 * the ordinary one — and a kiosk that guessed says so, because being told
 * *which* of two it took is the difference between a wrong roll noticed at
 * setup and a wrong roll noticed on a Sunday.
 *
 * Strictly shorter, so a tie leaves the library's own declaration order intact.
 */
export function preferredLabel(matched: readonly Label[]): Label | null {
  let best: Label | null = null;
  for (const entry of matched) {
    if (best === null || labelName(entry).length < labelName(best).length) best = entry;
  }
  return best;
}
