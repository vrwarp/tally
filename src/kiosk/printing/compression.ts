/**
 * Whether a model's raster rows should go out PackBits-compressed.
 *
 * A text label is mostly white: 83 KB of rows for one 62 mm name tag, of
 * which nearly all is runs of zero bytes that PackBits folds to a few hundred.
 * On a USB cable the difference is nothing. On the print server's path it is
 * the difference between a label that is at the printer in one frame and one
 * that is still going out seventeen seconds later over a poor Wi-Fi link —
 * which is what the first Sunday's bundle showed, frame by frame. The encode
 * is one pass over the bytes in the raster worker, off the main thread, and
 * costs less than a millisecond.
 *
 * Only where the printer takes it. The library's model table says which do
 * (`compression`), and its builder refuses the command on one that does not;
 * an unknown model gets the safe answer rather than a thrown job.
 */
import { resolveModel } from '@vrwarp/brother-ql-webusb/models';

export function compressFor(model: string): boolean {
  try {
    return resolveModel(model).compression === true;
  } catch {
    return false;
  }
}
