/**
 * Fitting a label's lines into the space a label actually has.
 *
 * The awkward part of printing a sticker is not the protocol, it is that a
 * name is as long as it is and the label is as wide as it is. "Bartholomew" at
 * the size "Ada" wanted is three times too wide, and a 29mm die-cut label has
 * no more height to give. So every line is measured, shrunk to fit, wrapped if
 * shrinking is not enough, and the whole block scaled down once more if it
 * overflows vertically — in that order, because each step is uglier than the
 * last and should only happen when the one before it was not enough.
 *
 * Pure, and measurement is a callback. That is what makes this testable at all:
 * the interesting cases are geometry, and a fake measurer states them as
 * arithmetic instead of as pixels that depend on which font a machine happens to
 * have. It is also why one implementation serves both callers — the kiosk
 * renders through an `OffscreenCanvas` in a worker, the event editor through a
 * DOM canvas at screen scale, and neither is this module's problem.
 *
 * Everything here is in printer dots (300 dpi), so a "font size" is a dot
 * height. The caller converts if it is drawing somewhere else.
 */
import {
  anyTokenFilled,
  fillLabelTokens,
  type LabelLineAlign,
  type LabelTemplate,
  type LabelTokenValues,
} from '@/lib/labelTemplate';

/** One string to draw, positioned. `y` is the text baseline. */
export interface LabelDraw {
  text: string;
  x: number;
  y: number;
  fontPx: number;
  bold: boolean;
  align: LabelLineAlign;
}

export interface LabelLayout {
  draws: LabelDraw[];
  /**
   * The width the content needs, in dots.
   *
   * The mirror of `height`: on a rotated label this is the free dimension and
   * the caller cuts the tape where it says, and everywhere else the width was
   * fixed going in and this reports it back unchanged.
   */
  width: number;
  /**
   * The height the content needs, in dots.
   *
   * On continuous tape the caller uses this as the label's length. On die-cut
   * media the height was fixed going in and this reports what was used.
   */
  height: number;
  /** Lines that would not fit at any size and were left off. */
  droppedLines: number;
  /** Whether the whole block had to be scaled down to fit the height. */
  scaledToFit: boolean;
}

/**
 * How wide `text` is at this size and weight, in dots.
 *
 * A canvas answers this with `measureText`; a test answers it with arithmetic.
 */
export type MeasureText = (text: string, fontPx: number, bold: boolean) => number;

export interface LabelBox {
  /**
   * Printable width in dots, or null when the width is the free dimension.
   *
   * Null is the rotated case, and only that: the text runs along the tape, so
   * the roll's width has become the height and it is the *length* that the
   * content decides. Every line is then as long as it wants to be — there is
   * nothing to shrink to and nothing to wrap at — and the layout reports the
   * width it used.
   */
  width: number | null;
  /**
   * Printable height in dots, or null for continuous tape where length is free.
   *
   * Null is not "unlimited" so much as "decided by the content" — the caller
   * cuts the tape wherever the returned height says.
   */
  height: number | null;
  /** Blank dots kept clear on every edge. */
  padding?: number;
  /**
   * Blank dots above the content, in place of `padding` at that edge.
   *
   * Its reason for existing is continuous tape, where the length follows the
   * content and so the space before and after the text is the only thing that
   * decides where the sticker sits between two cuts. On die-cut media the
   * height is fixed and the block is centred in what these leave, which is a
   * way of nudging it up or down rather than of making the label longer.
   *
   * All four exist because a label can be turned. The margins belong to the
   * *tape* — they are the blank strip at each end of the sticker — so on a
   * rotated label they are the layout's left and right rather than its top and
   * bottom. `labelBoxFor` is what decides which pair to fill in.
   */
  paddingTop?: number;
  /** Blank dots below the content, in place of `padding` at that edge. */
  paddingBottom?: number;
  /** Blank dots left of the content, in place of `padding` at that edge. */
  paddingLeft?: number;
  /** Blank dots right of the content, in place of `padding` at that edge. */
  paddingRight?: number;
}

/**
 * Dots per millimetre at 300 dpi, for callers holding a measurement in mm.
 *
 * Everything in this module is dots, because that is what the print head has.
 * A margin a person typed is millimetres, because that is what a ruler has.
 */
export const DOTS_PER_MM = 300 / 25.4;

/**
 * The media a label is being drawn on, in dots.
 *
 * Just the two numbers the geometry needs. The kiosk gets them from the label
 * table; the event editor, which must not carry that table, gets them from the
 * short list beside its preview.
 */
export interface LabelMedia {
  /** Printable width across the print head. */
  widthDots: number;
  /** Printable length, or null for continuous tape. */
  lengthDots: number | null;
}

/**
 * What the template asks for, on the media that is loaded.
 *
 * The one place the two meet, and shared by both drawers on purpose: the kiosk
 * rasterises through `drawLabel` and the editor paints a preview, and a label
 * that previews one way and prints another is worse than no preview at all.
 * Three decisions come out of it.
 *
 * **Which dimension is free.** Continuous tape has one, and the quarter turn
 * decides which: upright, the roll's width is the line length and the label
 * grows downwards as lines are added; rotated, the roll's width is the height
 * the lines share and the label grows *longer* as a name gets longer.
 *
 * **Whether the turn happens at all.** Only on tape. Both of a die-cut label's
 * dimensions are fixed, so turning the text would print it off the sides of a
 * label somebody chose for its size.
 *
 * **What a fixed length means.** The free dimension, pinned — which makes tape
 * behave exactly like die-cut media of that length, block centred and all.
 *
 * **Which edges the margins land on.** They belong to the tape, not to the
 * text: a margin is the blank strip at each end of the sticker, so it is always
 * spent on length and never on the roll's width. On a turned label the layout's
 * top and bottom are the roll's two *sides*, which are the one pair of edges a
 * margin must not touch — the roll is as wide as it is — so the margins go on
 * the layout's left and right instead. `drawLabel` then turns the whole thing
 * and they come out where they were asked for, at the ends of the sticker.
 */
export function labelBoxFor(
  template: LabelTemplate,
  media: LabelMedia,
): { box: LabelBox; rotated: boolean } {
  const endless = media.lengthDots === null;
  const rotated = endless && template.rotated === true;

  const before = marginDots(template.marginTopMm);
  const after = marginDots(template.marginBottomMm);
  // Only tape has a length to pin. Null leaves the free dimension free.
  const fixed =
    endless && template.fixedLengthMm !== undefined
      ? Math.round(template.fixedLengthMm * DOTS_PER_MM)
      : null;

  if (rotated) {
    // The turn sends the layout's left edge to the leading end of the tape, so
    // "above" is the left here — the same end of the same sticker.
    return {
      box: {
        width: fixed,
        height: media.widthDots,
        paddingLeft: before,
        paddingRight: after,
      },
      rotated,
    };
  }
  return {
    box: {
      width: media.widthDots,
      height: endless ? fixed : media.lengthDots,
      paddingTop: before,
      paddingBottom: after,
    },
    rotated,
  };
}

/** A margin a leader typed, as dots, or undefined to leave the default alone. */
function marginDots(mm: number | undefined): number | undefined {
  return mm === undefined ? undefined : Math.round(mm * DOTS_PER_MM);
}

/**
 * Nominal dot heights per size name.
 *
 * Anchored on the `xl` value: 96 dots is about 8mm of cap height at 300 dpi,
 * which is a first name readable across a nursery. The rest step down from
 * there by roughly a third each so the sizes stay distinguishable after the
 * block-level scaling below has had its way with them.
 */
const NOMINAL_FONT_PX = { sm: 34, md: 46, lg: 68, xl: 96 } as const;

/**
 * The smallest a line may be shrunk before wrapping is tried instead.
 *
 * Below roughly 24 dots (2mm) a thermal head at 300 dpi stops rendering thin
 * strokes reliably and the text greys out rather than getting smaller.
 */
const MIN_FONT_PX = 24;

/** Line box as a multiple of the font size, and the gap between lines. */
const LINE_HEIGHT = 1.18;
const LINE_GAP = 0.16;

const DEFAULT_PADDING = 8;

/** One resolved line: tokens filled in, empty ones already gone. */
interface ResolvedLine {
  text: string;
  fontPx: number;
  bold: boolean;
  align: LabelLineAlign;
}

/**
 * The template's lines with tokens filled in and the empty ones removed.
 *
 * A line that interpolates to nothing is dropped rather than printed blank:
 * `{{grade}}` on a child who has none should close the gap, not leave one. See
 * `fillLabelTokens`.
 *
 * A line marked `requiresValue` is dropped on a stricter test — nothing got
 * filled in, even though the caption around the tokens survived. That is the
 * difference between a label that omits an allergy line and one that prints the
 * word "Allergy:" for a child who has none. See `LabelLine.requiresValue`.
 */
export function resolveLines(
  template: LabelTemplate,
  values: LabelTokenValues,
): ResolvedLine[] {
  /*
   * What the template's relative sizes are relative *to*.
   *
   * Applied here, once, so everything downstream — shrinking, wrapping, the
   * block scale, the drop — sees ordinary font sizes and needs to know nothing
   * about it. See `LabelTemplate.fontScale`.
   */
  const zoom = template.fontScale ?? 1;

  const resolved: ResolvedLine[] = [];
  for (const line of template.lines) {
    const text = fillLabelTokens(line.text, values);
    if (text === '') continue;
    if (line.requiresValue && !anyTokenFilled(line.text, values)) continue;
    resolved.push({
      text,
      fontPx: Math.round(NOMINAL_FONT_PX[line.size] * zoom),
      bold: line.bold,
      align: line.align,
    });
  }
  return resolved;
}

/**
 * Break `text` across as few lines as will fit `width`, on spaces.
 *
 * A single word too long to fit is returned as-is: hyphenating a child's name
 * is worse than a name that touches the edges, and the caller has already
 * shrunk as far as it is willing to go.
 */
function wrap(text: string, fontPx: number, bold: boolean, width: number, measure: MeasureText): string[] {
  if (measure(text, fontPx, bold) <= width) return [text];

  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate, fontPx, bold) <= width || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);

  return lines;
}

/**
 * Shrink until it fits, then wrap what still does not.
 *
 * Shrinking first is the whole point: one long name on one line reads better
 * small than split across two. Wrapping is the fallback for text that has a
 * space to break at and is still too wide at the floor size.
 */
function fitLine(
  line: ResolvedLine,
  width: number,
  measure: MeasureText,
): { fontPx: number; texts: string[] } {
  let fontPx = line.fontPx;

  while (fontPx > MIN_FONT_PX && measure(line.text, fontPx, line.bold) > width) {
    // Two dots at a time: fine enough that the result does not look
    // arbitrarily small, coarse enough to converge in a handful of measures.
    fontPx -= 2;
  }

  if (measure(line.text, fontPx, line.bold) <= width) {
    return { fontPx, texts: [line.text] };
  }

  return { fontPx, texts: wrap(line.text, fontPx, line.bold, width, measure) };
}

function xFor(align: LabelLineAlign, left: number, width: number): number {
  if (align === 'left') return left;
  if (align === 'right') return left + width;
  return left + width / 2;
}

/**
 * Where every string goes.
 *
 * The block is centred vertically in the available height. If it is taller than
 * that, every size is multiplied by one factor so the proportions the leader
 * chose survive — a scaled-down label still reads as the label they designed,
 * where shrinking only the largest line would not. If a single scale is not
 * enough, trailing lines come off, last first, on the grounds that a template
 * puts the name at the top.
 */
export function layoutLabel(
  template: LabelTemplate,
  values: LabelTokenValues,
  box: LabelBox,
  measure: MeasureText,
): LabelLayout {
  const padding = box.padding ?? DEFAULT_PADDING;
  const paddingTop = box.paddingTop ?? padding;
  const paddingBottom = box.paddingBottom ?? padding;
  const paddingLeft = box.paddingLeft ?? padding;
  const paddingRight = box.paddingRight ?? padding;
  /*
   * A free width has nothing to shrink to. Infinity is not a fudge here, it is
   * the honest statement of the rotated case: every line is as long as it wants
   * to be, so `fitLine` never enters its shrink loop and `wrap` never gets a
   * chance to break a name that has a whole roll to run along.
   */
  const innerWidth =
    box.width === null
      ? Number.POSITIVE_INFINITY
      : Math.max(1, box.width - paddingLeft - paddingRight);
  const maxHeight =
    box.height === null ? null : Math.max(1, box.height - paddingTop - paddingBottom);

  const resolved = resolveLines(template, values);
  if (resolved.length === 0) {
    return {
      draws: [],
      width: box.width ?? paddingLeft + paddingRight,
      height: box.height ?? paddingTop + paddingBottom,
      droppedLines: 0,
      scaledToFit: false,
    };
  }

  /** Lay out at a given scale, reporting the height it wanted. */
  const attempt = (scale: number, lines: ResolvedLine[]) => {
    const rows: {
      text: string;
      fontPx: number;
      bold: boolean;
      align: LabelLineAlign;
      /** Measured, because a free width is the widest of these. */
      width: number;
    }[] = [];
    let height = 0;

    lines.forEach((line, index) => {
      const scaled: ResolvedLine = {
        ...line,
        fontPx: Math.max(MIN_FONT_PX, Math.round(line.fontPx * scale)),
      };
      const { fontPx, texts } = fitLine(scaled, innerWidth, measure);
      if (index > 0) height += fontPx * LINE_GAP;
      for (const text of texts) {
        rows.push({
          text,
          fontPx,
          bold: line.bold,
          align: line.align,
          width: measure(text, fontPx, line.bold),
        });
        height += fontPx * LINE_HEIGHT;
      }
    });

    return { rows, height };
  };

  let lines = resolved;
  let scale = 1;
  let scaledToFit = false;
  let result = attempt(scale, lines);

  if (maxHeight !== null) {
    // One proportional squeeze first, floored so a wildly overfull template
    // does not scale itself into illegibility before dropping anything.
    if (result.height > maxHeight) {
      scale = Math.max(0.5, maxHeight / result.height);
      scaledToFit = true;
      result = attempt(scale, lines);
    }
    // Then trailing lines, one at a time, until what is left fits.
    while (result.height > maxHeight && lines.length > 1) {
      lines = lines.slice(0, -1);
      result = attempt(scale, lines);
    }
  }

  const contentHeight = result.height;
  /*
   * How wide the block came out. On a fixed width this is at most the box, and
   * usually less — every line was shrunk to fit it. On a free one it is the
   * label: the widest line decides where the tape gets cut.
   */
  const contentWidth = result.rows.reduce((widest, row) => Math.max(widest, row.width), 0);
  const width = box.width ?? Math.ceil(contentWidth + paddingLeft + paddingRight);
  // Alignment is relative to whatever the label turned out to be, so `right` on
  // a free width means the end of the longest line rather than a box edge that
  // does not exist.
  const alignWidth = box.width === null ? contentWidth : innerWidth;
  const height = box.height ?? Math.ceil(contentHeight + paddingTop + paddingBottom);
  const top =
    box.height === null
      ? paddingTop
      : paddingTop + Math.max(0, ((maxHeight ?? 0) - contentHeight) / 2);

  const draws: LabelDraw[] = [];
  let cursor = top;
  result.rows.forEach((row, index) => {
    if (index > 0) cursor += row.fontPx * LINE_GAP;
    // Baseline sits at the bottom of the line box less the descender room the
    // 1.18 line height leaves; near enough for a sticker, and it means a row's
    // position does not depend on the font's own metrics.
    const baseline = cursor + row.fontPx;
    draws.push({
      text: row.text,
      x: xFor(row.align, paddingLeft, alignWidth),
      y: Math.round(baseline),
      fontPx: row.fontPx,
      bold: row.bold,
      align: row.align,
    });
    cursor += row.fontPx * LINE_HEIGHT;
  });

  return {
    draws,
    width,
    height,
    droppedLines: resolved.length - lines.length,
    scaledToFit,
  };
}

/**
 * The CSS `font` shorthand for a draw command.
 *
 * A system stack, matching `body` in `index.css` — and matching it is nearly
 * free here because Tally ships no webfont. That matters more than it looks: a
 * worker's `OffscreenCanvas` resolves families against the fonts the machine
 * has and does not inherit the page's `@font-face` rules, so a webfont would
 * have to be fetched and registered through `FontFace` before the first label
 * could be drawn. There is none, so both callers ask for the same stack and get
 * the same shapes.
 */
export const LABEL_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function labelFont(fontPx: number, bold: boolean): string {
  return `${bold ? '700' : '400'} ${fontPx}px ${LABEL_FONT_STACK}`;
}
