/**
 * The canvas half of the renderer, against a stub canvas.
 *
 * jsdom has no `OffscreenCanvas` and no text metrics, so the stub below reports
 * a plausible width per character and records what it was asked to draw. That is
 * not a rendering test — nothing here can tell you the label *looks* right, and
 * `lib/labelRender.test.ts` already owns the layout arithmetic.
 *
 * What it is for is the size contract, which is the thing that would silently be
 * wrong. `prepareImage` demands the exact printable dot box for die-cut media and
 * throws `RasterError` otherwise — verified against the real library, not assumed
 * — so a label rendered a few dots off does not come out slightly wrong, it does
 * not come out. Continuous tape is the mirror case: the height must follow the
 * content, and must not follow it off the end of the roll.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_LABEL_TEMPLATE, type LabelTemplate } from '@/lib/labelTemplate';
import { drawLabel } from './draw';

interface DrawnText {
  text: string;
  x: number;
  y: number;
  font: string;
  align: string;
  fillStyle: string;
  baseline: string;
}

let drawn: DrawnText[] = [];
let filledRects: Array<{ box: number[]; fillStyle: string }> = [];
/** Every transform the renderer applied, in order — the quarter turn shows up here. */
let transforms: string[] = [];
/** How many contexts the stub hands out before it starts answering null. */
let contextsBeforeNull = Number.POSITIVE_INFINITY;
let contextsAskedFor: string[] = [];

class StubContext {
  font = '';
  fillStyle = '';
  textAlign = '';
  textBaseline = '';

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  fillRect(x: number, y: number, w: number, h: number): void {
    // The colour matters as much as the box: a label filled black and then
    // written on in black comes off the printer as a solid rectangle.
    filledRects.push({ box: [x, y, w, h], fillStyle: this.fillStyle });
  }

  /*
   * The stub does not apply these, it records them. What the rotated case has to
   * get right is the *box*, and the drawing coordinates stay in the layout's own
   * frame either way — so a stub that faithfully rotated points would be
   * asserting the browser's matrix maths rather than this file's arithmetic.
   */
  translate(x: number, y: number): void {
    transforms.push(`translate(${x},${y})`);
  }

  rotate(angle: number): void {
    transforms.push(`rotate(${angle.toFixed(4)})`);
  }

  /** Half the font size per character: monotonic in both variables, like a font. */
  measureText(text: string): { width: number } {
    const px = Number.parseInt(/(\d+)px/.exec(this.font)?.[1] ?? '16', 10);
    return { width: text.length * px * 0.5 };
  }

  fillText(text: string, x: number, y: number): void {
    drawn.push({
      text,
      x,
      y,
      font: this.font,
      align: this.textAlign,
      fillStyle: this.fillStyle,
      baseline: this.textBaseline,
    });
  }

  getImageData(): { data: Uint8ClampedArray } {
    return { data: new Uint8ClampedArray(this.width * this.height * 4) };
  }
}

class StubOffscreenCanvas {
  private readonly ctx: StubContext;
  constructor(width: number, height: number) {
    this.ctx = new StubContext(width, height);
  }
  /** Like the real thing: a kind it does not recognise is `null`, not a throw. */
  getContext(kind: string): StubContext | null {
    contextsAskedFor.push(kind);
    if (kind !== '2d') return null;
    if (contextsAskedFor.length > contextsBeforeNull) return null;
    return this.ctx;
  }
}

const original = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;

beforeEach(() => {
  drawn = [];
  filledRects = [];
  transforms = [];
  contextsAskedFor = [];
  contextsBeforeNull = Number.POSITIVE_INFINITY;
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = StubOffscreenCanvas;
});

afterEach(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = original;
});

const values = { firstName: 'Ada', lastInitial: 'L', grade: '8th grade', eventTitle: 'Sunday Nursery' };

describe('drawLabel', () => {
  describe('on die-cut media', () => {
    it('renders exactly the printable dot box it was given', () => {
      // 62x29mm at 300 dpi. Anything else and prepareImage throws RasterError.
      const image = drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 });

      expect(image.width).toBe(696);
      expect(image.height).toBe(271);
    });

    it('produces RGBA at four bytes a pixel with no padding', () => {
      const image = drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 });
      expect(image.data.length).toBe(696 * 271 * 4);
    });

    it('keeps the exact height however little there is to draw', () => {
      const oneLine: LabelTemplate = {
        lines: [{ text: '{{firstName}}', size: 'sm', bold: false, align: 'center', requiresValue: false }],
        copies: 1,
      };
      expect(drawLabel(oneLine, values, { width: 696, height: 271 }).height).toBe(271);
    });
  });

  describe('on continuous tape', () => {
    it('takes its height from the content', () => {
      const two: LabelTemplate = {
        lines: [
          { text: 'one', size: 'xl', bold: true, align: 'center', requiresValue: false },
          { text: 'two', size: 'xl', bold: true, align: 'center', requiresValue: false },
        ],
        copies: 1,
      };
      const four: LabelTemplate = {
        lines: [...two.lines, ...two.lines],
        copies: 1,
      };

      const shorter = drawLabel(two, values, { width: 696, height: null });
      const taller = drawLabel(four, values, { width: 696, height: null });

      expect(taller.height).toBeGreaterThan(shorter.height);
      expect(shorter.width).toBe(696);
      expect(taller.data.length).toBe(696 * taller.height * 4);
    });

    it('adds the margins asked for to the length', () => {
      const one: LabelTemplate = {
        lines: [{ text: '{{firstName}}', size: 'md', bold: false, align: 'center', requiresValue: false }],
        copies: 1,
      };

      const plain = drawLabel(one, values, { width: 696, height: null });
      const spaced = drawLabel(one, values, {
        width: 696,
        height: null,
        paddingTop: 60,
        paddingBottom: 120,
      });

      // The tape is cut where the raster stops, so a margin is length.
      expect(spaced.height).toBe(plain.height + (60 - 8) + (120 - 8));
      expect(spaced.data.length).toBe(696 * spaced.height * 4);
    });

    it('will not run off the end of the roll', () => {
      // Six lines of xl on continuous tape is a stationery incident waiting to
      // happen; 1800 dots is 150mm at 300 dpi.
      const runaway: LabelTemplate = {
        lines: Array.from({ length: 6 }, () => ({
          text: 'a fairly long line of text',
          size: 'xl' as const,
          bold: true,
          align: 'center' as const,
          requiresValue: false,
        })),
        copies: 1,
      };
      expect(drawLabel(runaway, values, { width: 696, height: null }).height).toBeLessThanOrEqual(1800);
    });
  });

  describe('turned a quarter turn', () => {
    const one: LabelTemplate = {
      lines: [{ text: '{{firstName}}', size: 'xl', bold: true, align: 'center', requiresValue: false }],
      copies: 1,
    };

    it('turns the canvas rather than the layout', () => {
      drawLabel(one, values, { width: null, height: 696 }, { rotated: true });
      // A quarter turn about the top-right corner, so the first line's start
      // lands at the leading edge of the tape.
      expect(transforms).toEqual(['translate(696,0)', `rotate(${(Math.PI / 2).toFixed(4)})`]);
    });

    it('leaves an upright label untransformed', () => {
      drawLabel(one, values, { width: 696, height: null });
      expect(transforms).toEqual([]);
    });

    it('swaps the raster\'s two dimensions', () => {
      // Laid out in a box whose height is the tape's width and whose length is
      // free; rasterised the other way round, because the head is 696 dots wide
      // however the text is arranged on it.
      const image = drawLabel(one, values, { width: null, height: 696 }, { rotated: true });

      expect(image.width).toBe(696);
      expect(image.height).toBeGreaterThan(1);
      expect(image.data.length).toBe(696 * image.height * 4);
    });

    it('gets longer as the name gets longer, instead of smaller', () => {
      const short = drawLabel(one, { firstName: 'Ada' }, { width: null, height: 696 }, { rotated: true });
      const long = drawLabel(
        one,
        { firstName: 'Bartholomew Fitzwilliam' },
        { width: null, height: 696 },
        { rotated: true },
      );

      expect(long.height).toBeGreaterThan(short.height);
      expect(long.width).toBe(696);
    });

    it('still refuses to run off the end of the roll', () => {
      // The cap is a limit along the roll, so turning the label does not escape
      // it — it is now the name's length that could run away.
      const image = drawLabel(
        one,
        { firstName: 'W'.repeat(400) },
        { width: null, height: 696 },
        { rotated: true },
      );
      expect(image.height).toBeLessThanOrEqual(1800);
    });
  });

  describe('what it draws', () => {
    it('fills the label white before drawing black text', () => {
      drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 });
      // One fill covering the whole label: prepareImage composites onto white
      // and thresholds, so starting white saves the pass and the letterboxing.
      expect(filledRects).toEqual([{ box: [0, 0, 696, 271], fillStyle: '#ffffff' }]);
    });

    it('writes in black, on the baseline the layout measured against', () => {
      drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 });

      // White on white is a blank sticker, and the wrong baseline moves every
      // line by most of its own height — neither shows up in a size check.
      expect(drawn.length).toBeGreaterThan(0);
      for (const entry of drawn) {
        expect(entry.fillStyle).toBe('#000000');
        expect(entry.baseline).toBe('alphabetic');
      }
    });

    it('draws each line on the alignment the template asked for', () => {
      const mixed: LabelTemplate = {
        lines: [
          { text: '{{firstName}}', size: 'md', bold: false, align: 'left', requiresValue: false },
          { text: '{{lastInitial}}', size: 'md', bold: false, align: 'center', requiresValue: false },
          { text: '{{grade}}', size: 'md', bold: false, align: 'right', requiresValue: false },
        ],
        copies: 1,
      };

      drawLabel(mixed, values, { width: 696, height: 271 });

      expect(drawn.map((entry) => entry.align)).toEqual(['left', 'center', 'right']);
    });

    it('asks for a 2d context and nothing else', () => {
      drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 });

      expect(contextsAskedFor).toEqual(['2d', '2d']);
    });
  });

  describe('a canvas that will not give up a context', () => {
    it('says so rather than measuring against nothing', () => {
      // The scratch canvas is only there to measure with; without it every
      // line would be laid out at width zero and stack on top of itself.
      contextsBeforeNull = 0;

      expect(() => drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 })).toThrow(
        'No 2d context on an OffscreenCanvas.',
      );
    });

    it('says so rather than drawing onto nothing', () => {
      contextsBeforeNull = 1;

      expect(() => drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 })).toThrow(
        'No 2d context on an OffscreenCanvas.',
      );
    });

    it('draws the resolved text, not the template tokens', () => {
      drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 });
      const texts = drawn.map((entry) => entry.text);

      expect(texts).toContain('Ada L');
      expect(texts).toContain('8th grade');
      expect(texts.join(' ')).not.toContain('{{');
    });

    it('leaves out a line whose tokens came to nothing', () => {
      // A child with no grade on the roster: a tidy three-line label rather
      // than one with a hole in it.
      drawLabel(DEFAULT_LABEL_TEMPLATE, { firstName: 'Ada', eventTitle: 'Nursery' }, { width: 696, height: 271 });
      expect(drawn.map((entry) => entry.text)).not.toContain('');
    });

    it('asks for the system font stack at the size the layout chose', () => {
      drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 });
      for (const entry of drawn) {
        expect(entry.font).toMatch(/^[47]00 \d+px ui-sans-serif, system-ui/);
      }
    });

    it('centres by asking the canvas to centre', () => {
      drawLabel(DEFAULT_LABEL_TEMPLATE, values, { width: 696, height: 271 });
      // The layout hands over the anchor x; the alignment has to agree with it
      // or every line is off by half its own width.
      expect(drawn.every((entry) => entry.align === 'center')).toBe(true);
      expect(drawn.every((entry) => entry.x === 8 + (696 - 16) / 2)).toBe(true);
    });
  });

  it('draws nothing but white for a template that resolved to nothing', () => {
    const image = drawLabel(
      { lines: [{ text: '{{grade}}', size: 'md', bold: false, align: 'center', requiresValue: false }], copies: 1 },
      { firstName: 'Ada' },
      { width: 696, height: 271 },
    );
    expect(drawn).toEqual([]);
    expect(image.height).toBe(271);
  });
});
