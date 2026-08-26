/**
 * Turning a label template into pixels, on an `OffscreenCanvas`.
 *
 * The worker half of the renderer. `lib/labelRender.ts` decides *where* every
 * string goes and this draws it, which is the whole of the division: the
 * arithmetic is pure and unit-tested, and this file is the part that needs a
 * canvas and therefore cannot be.
 *
 * `OffscreenCanvas` rather than a DOM canvas because this runs in a worker, and
 * it runs in a worker because `createJob` downstream is one long synchronous
 * pass over a few hundred thousand pixels. On the main thread that lands
 * squarely on the confirm tap.
 *
 * Two details that matter to what comes out of the printer:
 *
 * **White, opaque, black text.** `prepareImage` composites alpha onto white and
 * then thresholds, so a transparent canvas would work but wastes the
 * compositing pass. Filling white first also means the letterboxing below needs
 * no separate step.
 *
 * **The exact dot size.** Rendering at `expectedImageSize(label)` means the
 * library's normaliser has nothing to resample — for die-cut media it *insists*
 * on those exact dimensions and throws a `RasterError` otherwise, and for
 * continuous tape resampling a bitmap of text is how crisp text becomes grey
 * text.
 */
import { layoutLabel, labelFont, type LabelBox, type MeasureText } from '@/lib/labelRender';
import type { LabelTemplate, LabelTokenValues } from '@/lib/labelTemplate';

/** RGBA, 4 bytes per pixel, no padding — what `brother_ql` calls a RawImage. */
export interface RenderedLabel {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * How much tape one label may take before it is a stationery incident.
 *
 * 62mm tape at 300 dpi is about 12 dots per millimetre, so 1800 dots is 150mm —
 * generous for four lines of text, and short of the length a runaway template
 * could otherwise ask for.
 *
 * It is a limit along the roll, so on a rotated label it caps the length a long
 * name can run to rather than the height of the text.
 *
 * The margins on `box` count towards it, so a template already long enough to
 * be cut short loses its bottom margin first. That is the right order: the cap
 * is there so that no one child can take 150mm of roll however it was asked
 * for, and a label at the cap has a bigger problem than its bottom edge.
 */
const MAX_ENDLESS_HEIGHT_DOTS = 1800;

/**
 * Draw a label and hand back its pixels.
 *
 * `box.height` null means continuous tape, where the length follows the content;
 * a number means die-cut, where it does not and the layout has to fit. `box.width`
 * null is the rotated mirror of that: the roll's width has become the height and
 * the length is what the content decides.
 *
 * `rotated` turns the finished layout a quarter turn on its way to the raster.
 * The layout itself knows nothing about it — it is handed a box whose height is
 * the tape's width and whose width is free, lays out in that frame as usual, and
 * this transposes the result. Which is the whole reason the geometry is a pure
 * function of a box: the rotated case is a different box, not a different
 * algorithm.
 *
 * The turn puts the start of the first line at the leading edge of the tape, so
 * the label reads in the order it comes out of the printer.
 */
export function drawLabel(
  template: LabelTemplate,
  values: LabelTokenValues,
  box: LabelBox,
  { rotated = false }: { rotated?: boolean } = {},
): RenderedLabel {
  // A 1x1 scratch canvas purely to get a context to measure with: text metrics
  // do not depend on the canvas size, and the real one cannot be allocated
  // until the layout has decided how tall it is.
  const scratch = new OffscreenCanvas(1, 1);
  const scratchCtx = scratch.getContext('2d');
  if (!scratchCtx) throw new Error('No 2d context on an OffscreenCanvas.');

  const measure: MeasureText = (text, fontPx, bold) => {
    scratchCtx.font = labelFont(fontPx, bold);
    return scratchCtx.measureText(text).width;
  };

  const layout = layoutLabel(template, values, box, measure);

  /*
   * The two dimensions of the raster, which are the layout's two dimensions
   * swapped when rotated. `width` is always across the head and `height` always
   * along the roll, so the cap belongs to `height` either way — it is a limit on
   * how much tape one child may take, not on how tall a line may be.
   */
  const across = Math.max(1, rotated ? layout.height : layout.width);
  const along = Math.min(MAX_ENDLESS_HEIGHT_DOTS, Math.max(1, rotated ? layout.width : layout.height));

  const canvas = new OffscreenCanvas(across, along);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2d context on an OffscreenCanvas.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, across, along);

  if (rotated) {
    // Logical (x, y) lands at physical (across - y, x): the first line's start
    // goes to the leading edge of the tape, and the layout's top edge to one
    // side of it. Set before any text is drawn, and never unset — nothing after
    // this draws in physical coordinates.
    ctx.translate(across, 0);
    ctx.rotate(Math.PI / 2);
  }

  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  for (const draw of layout.draws) {
    ctx.font = labelFont(draw.fontPx, draw.bold);
    ctx.textAlign = draw.align;
    ctx.fillText(draw.text, draw.x, draw.y);
  }

  const image = ctx.getImageData(0, 0, across, along);
  return {
    width: across,
    height: along,
    // `ImageData.data` is a Uint8ClampedArray over the same buffer; the library
    // wants a Uint8Array and a view costs nothing.
    data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
  };
}
