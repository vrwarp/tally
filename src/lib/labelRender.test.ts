/**
 * Fitting text into a label, stated as arithmetic.
 *
 * `measure` is a callback precisely so these cases can be written down. The fake
 * below charges a fixed fraction of the font size per character, and bold a
 * little more — which is not how a real font behaves, but is monotonic in
 * exactly the two variables the layout reasons about. Every assertion here is
 * about geometry: does it shrink before it wraps, does it wrap before it drops,
 * does the whole block scale by one factor rather than per line.
 */
import { describe, expect, it } from 'vitest';

import {
  DOTS_PER_MM,
  labelBoxFor,
  layoutLabel,
  resolveLines,
  type LabelBox,
  type MeasureText,
} from '@/lib/labelRender';
import type { LabelTemplate } from '@/lib/labelTemplate';

/** Half the font size per character, 10% more when bold. */
const measure: MeasureText = (text, fontPx, bold) => text.length * fontPx * 0.5 * (bold ? 1.1 : 1);

function template(lines: LabelTemplate['lines'], copies = 1): LabelTemplate {
  return { lines, copies };
}

const line = (
  text: string,
  size: LabelTemplate['lines'][number]['size'] = 'md',
  bold = false,
  align: LabelTemplate['lines'][number]['align'] = 'center',
  requiresValue = false,
) => ({ text, size, bold, align, requiresValue });

/** A 62x29mm die-cut label at 300 dpi: what a nursery actually loads. */
const DIE_CUT: LabelBox = { width: 696, height: 271 };
/** 62mm continuous tape: width fixed, length decided by the content. */
const ENDLESS: LabelBox = { width: 696, height: null };

describe('resolveLines', () => {
  it('drops a line whose tokens all came to nothing', () => {
    const resolved = resolveLines(
      template([line('{{firstName}}', 'xl'), line('{{grade}}'), line('Nursery', 'sm')]),
      { firstName: 'Ada' },
    );
    expect(resolved.map((entry) => entry.text)).toEqual(['Ada', 'Nursery']);
  });

  it('gives a larger size a larger font', () => {
    const [small, large] = resolveLines(template([line('a', 'sm'), line('a', 'xl')]), {});
    expect(large!.fontPx).toBeGreaterThan(small!.fontPx);
  });

  /*
   * `requiresValue` is for the line that comes to *almost* nothing. A bare token
   * already disappears on its own; a token with a caption around it does not,
   * and "Allergy:" printed alone on a child who has no allergy is both the case
   * the flag exists for and the one a leader is least likely to foresee.
   */
  describe('a line that only prints when something filled it in', () => {
    it('keeps the caption for a child who has a value', () => {
      const resolved = resolveLines(
        template([line('Allergy: {{allergy}}', 'md', false, 'center', true)]),
        { allergy: 'Peanuts' },
      );
      expect(resolved.map((entry) => entry.text)).toEqual(['Allergy: Peanuts']);
    });

    it('drops the caption for a child who has none', () => {
      const resolved = resolveLines(
        template([line('Allergy: {{allergy}}', 'md', false, 'center', true)]),
        { firstName: 'Ada' },
      );
      expect(resolved).toEqual([]);
    });

    it('still prints the bare caption when the line has not asked to be dropped', () => {
      // Today's behaviour, and why the flag is opt-in rather than automatic:
      // turning it on for everybody would silently change what churches with
      // existing templates already print.
      const resolved = resolveLines(
        template([line('Allergy: {{allergy}}', 'md', false, 'center', false)]),
        { firstName: 'Ada' },
      );
      expect(resolved.map((entry) => entry.text)).toEqual(['Allergy:']);
    });

    it('keeps a line where only some of its tokens came to nothing', () => {
      // "Any", not "all". A child with no surname is still their first name, and
      // dropping the name line would be absurd.
      const resolved = resolveLines(
        template([line('{{firstName}} {{lastInitial}}', 'xl', true, 'center', true)]),
        { firstName: 'Ada' },
      );
      expect(resolved.map((entry) => entry.text)).toEqual(['Ada']);
    });

    it('leaves a line of fixed text alone', () => {
      // Nothing to wait on, and a leader who typed a caption with no token in it
      // meant it literally.
      const resolved = resolveLines(
        template([line('Sunday Nursery', 'sm', false, 'center', true)]),
        {},
      );
      expect(resolved.map((entry) => entry.text)).toEqual(['Sunday Nursery']);
    });

    it('treats a whitespace-only value as nothing', () => {
      const resolved = resolveLines(
        template([line('Allergy: {{allergy}}', 'md', false, 'center', true)]),
        { allergy: '   ' },
      );
      expect(resolved).toEqual([]);
    });
  });
});

describe('the text size factor', () => {
  it('scales every size by it, keeping them in proportion', () => {
    const lines = template([line('a', 'sm'), line('a', 'xl')]);
    const [small, large] = resolveLines({ ...lines, fontScale: 2 }, {});

    expect(small!.fontPx).toBe(34 * 2);
    expect(large!.fontPx).toBe(96 * 2);
  });

  it('reads an absent factor as leaving everything alone', () => {
    const lines = template([line('a', 'xl')]);
    expect(resolveLines(lines, {})[0]!.fontPx).toBe(96);
    expect(resolveLines({ ...lines, fontScale: 1 }, {})[0]!.fontPx).toBe(96);
  });

  it('fills more of a label that had room to spare', () => {
    // The case it exists for: a fixed length longer than the text needs, where
    // "Biggest" was not big and nothing could say so.
    const long = { width: 696, height: 1181 };
    const one = template([line('Ada', 'xl', true)]);

    const plain = layoutLabel(one, {}, long, measure);
    const zoomed = layoutLabel({ ...one, fontScale: 2 }, {}, long, measure);

    expect(zoomed.draws[0]!.fontPx).toBeGreaterThan(plain.draws[0]!.fontPx);
  });

  it('grows a free dimension instead of overflowing it', () => {
    const one = template([line('Ada', 'xl', true)]);
    const plain = layoutLabel(one, {}, ENDLESS, measure);
    const zoomed = layoutLabel({ ...one, fontScale: 2 }, {}, ENDLESS, measure);

    expect(zoomed.height).toBeGreaterThan(plain.height);
  });

  it('still loses to the label when it asks for more than fits', () => {
    // The fitting that follows has the last word, so a wild factor produces a
    // full label rather than one printed off the edges.
    const one = template([line('Bartholomew', 'xl', true)]);
    const zoomed = layoutLabel({ ...one, fontScale: 4 }, {}, DIE_CUT, measure);

    expect(zoomed.height).toBe(271);
    for (const draw of zoomed.draws) {
      expect(measure(draw.text, draw.fontPx, draw.bold)).toBeLessThanOrEqual(696 - 16);
    }
  });
});

describe('layoutLabel', () => {
  it('places a short label without shrinking or dropping anything', () => {
    const result = layoutLabel(
      template([line('Ada L', 'xl', true), line('8th grade')]),
      {},
      DIE_CUT,
      measure,
    );

    expect(result.draws.map((draw) => draw.text)).toEqual(['Ada L', '8th grade']);
    expect(result.droppedLines).toBe(0);
    expect(result.scaledToFit).toBe(false);
    // The nominal xl size, untouched.
    expect(result.draws[0]!.fontPx).toBe(96);
  });

  it('shrinks a long name rather than wrapping it', () => {
    const short = layoutLabel(template([line('Ada', 'xl', true)]), {}, DIE_CUT, measure);
    const long = layoutLabel(
      template([line('Bartholomew Fitzwilliam', 'xl', true)]),
      {},
      DIE_CUT,
      measure,
    );

    expect(long.draws).toHaveLength(1);
    expect(long.draws[0]!.text).toBe('Bartholomew Fitzwilliam');
    expect(long.draws[0]!.fontPx).toBeLessThan(short.draws[0]!.fontPx);
  });

  it('never shrinks below the legibility floor', () => {
    const result = layoutLabel(
      template([line('x'.repeat(120), 'xl', true)]),
      {},
      DIE_CUT,
      measure,
    );
    for (const draw of result.draws) expect(draw.fontPx).toBeGreaterThanOrEqual(24);
  });

  it('wraps on a space once shrinking has hit the floor', () => {
    /*
     * Many short words: too wide even at the floor size, but breakable.
     *
     * 62 characters is the threshold for this fake measurer — at the 24-dot
     * floor and the bold surcharge that is 818 dots against 680 of usable
     * width. Anything shorter shrinks to fit and never reaches the wrap, which
     * is the documented order and is asserted above.
     */
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
    expect(measure(words, 24, true)).toBeGreaterThan(696 - 16);

    const result = layoutLabel(template([line(words, 'xl', true)]), {}, ENDLESS, measure);
    expect(result.draws.length).toBeGreaterThan(1);
    // Every produced row fits.
    for (const draw of result.draws) {
      expect(measure(draw.text, draw.fontPx, draw.bold)).toBeLessThanOrEqual(696 - 16);
    }
  });

  it('leaves an unbreakable word alone rather than hyphenating a name', () => {
    const result = layoutLabel(template([line('W'.repeat(90), 'xl', true)]), {}, ENDLESS, measure);
    expect(result.draws).toHaveLength(1);
    expect(result.draws[0]!.text).toBe('W'.repeat(90));
  });

  it('accounts for bold being wider', () => {
    const plain = layoutLabel(template([line('Bartholomew', 'xl', false)]), {}, DIE_CUT, measure);
    const bold = layoutLabel(template([line('Bartholomew', 'xl', true)]), {}, DIE_CUT, measure);
    expect(bold.draws[0]!.fontPx).toBeLessThanOrEqual(plain.draws[0]!.fontPx);
  });

  describe('on continuous tape', () => {
    it('grows the label to fit the content instead of scaling it', () => {
      const two = layoutLabel(template([line('one', 'xl'), line('two', 'xl')]), {}, ENDLESS, measure);
      const four = layoutLabel(
        template([line('one', 'xl'), line('two', 'xl'), line('three', 'xl'), line('four', 'xl')]),
        {},
        ENDLESS,
        measure,
      );

      expect(four.height).toBeGreaterThan(two.height);
      expect(four.droppedLines).toBe(0);
      expect(four.scaledToFit).toBe(false);
      // Same nominal size in both: height was free, so nothing had to give.
      expect(four.draws[0]!.fontPx).toBe(two.draws[0]!.fontPx);
    });

    it('starts at the top padding', () => {
      const result = layoutLabel(template([line('one', 'sm')]), {}, ENDLESS, measure);
      expect(result.draws[0]!.y).toBeLessThan(50);
    });

    describe('with margins asked for at the ends', () => {
      const lines = template([line('one', 'sm')]);

      it('pushes the text down by the top margin', () => {
        const plain = layoutLabel(lines, {}, ENDLESS, measure);
        const spaced = layoutLabel(lines, {}, { ...ENDLESS, paddingTop: 120 }, measure);
        expect(spaced.draws[0]!.y - plain.draws[0]!.y).toBe(120 - 8);
      });

      it('grows the label by both, because the tape is cut where it stops', () => {
        const plain = layoutLabel(lines, {}, ENDLESS, measure);
        const spaced = layoutLabel(
          lines,
          {},
          { ...ENDLESS, paddingTop: 120, paddingBottom: 60 },
          measure,
        );
        expect(spaced.height - plain.height).toBe(120 - 8 + (60 - 8));
      });

      it('leaves the bottom margin alone under the text', () => {
        // Only the length changes: a margin below cannot move a line that has
        // already been placed from the top.
        const plain = layoutLabel(lines, {}, ENDLESS, measure);
        const spaced = layoutLabel(lines, {}, { ...ENDLESS, paddingBottom: 200 }, measure);
        expect(spaced.draws[0]!.y).toBe(plain.draws[0]!.y);
        expect(spaced.height).toBe(plain.height + 200 - 8);
      });

      it('keeps the side padding out of it', () => {
        const result = layoutLabel(
          template([line('a', 'md', false, 'left')]),
          {},
          { ...ENDLESS, paddingTop: 100, paddingBottom: 100 },
          measure,
        );
        expect(result.draws[0]!.x).toBe(8);
      });

      it('spaces an empty label by them too', () => {
        // Nothing resolved, so there is no content to sit between the two — but
        // the tape still has to be as long as they say it is.
        const result = layoutLabel(
          template([line('{{grade}}')]),
          {},
          { ...ENDLESS, paddingTop: 30, paddingBottom: 50 },
          measure,
        );
        expect(result.draws).toEqual([]);
        expect(result.height).toBe(80);
      });
    });
  });

  describe('on a rotated label, where the width is what is free', () => {
    /** The tape's width has become the height; the length is the free one. */
    const SIDEWAYS = { width: null, height: 271 };

    it('reports the width the longest line needed', () => {
      const short = layoutLabel(template([line('Ada', 'xl')]), {}, SIDEWAYS, measure);
      const long = layoutLabel(template([line('Bartholomew', 'xl')]), {}, SIDEWAYS, measure);

      expect(long.width).toBeGreaterThan(short.width);
      // The tape's width does not move: that is the fixed one now.
      expect(long.height).toBe(271);
    });

    it('never shrinks a name that has a whole roll to run along', () => {
      // The entire point of turning the label. Upright this name does not fit
      // 696 dots across and is shrunk; on its side it stays at the size the
      // leader chose and the label gets longer instead.
      const name = template([line('Bartholomew Fitzwilliam', 'xl')]);
      const upright = layoutLabel(name, {}, { width: 696, height: null }, measure);
      const sideways = layoutLabel(name, {}, SIDEWAYS, measure);

      expect(sideways.draws[0]!.fontPx).toBe(96);
      expect(upright.draws[0]!.fontPx).toBeLessThan(96);
    });

    it('never wraps one either', () => {
      const result = layoutLabel(
        template([line('a name with several words in it', 'xl')]),
        {},
        SIDEWAYS,
        measure,
      );
      expect(result.draws).toHaveLength(1);
    });

    it('still shares the fixed height between its lines', () => {
      // Four xl lines do not fit across 271 dots, so the same squeeze that
      // applies to a die-cut label applies here — only the other way up.
      const result = layoutLabel(
        template([line('one', 'xl'), line('two', 'xl'), line('three', 'xl'), line('four', 'xl')]),
        {},
        SIDEWAYS,
        measure,
      );
      expect(result.scaledToFit || result.droppedLines > 0).toBe(true);
      expect(result.height).toBe(271);
    });

    it('aligns against the label it produced, not a box edge that does not exist', () => {
      const result = layoutLabel(
        template([line('a long line here', 'md', false, 'left'), line('b', 'md', false, 'right')]),
        {},
        SIDEWAYS,
        measure,
      );
      const [left, right] = result.draws;
      expect(left!.x).toBe(8);
      // The right edge is the widest line's, which is what the label was cut to.
      expect(right!.x).toBe(result.width - 8);
    });

    it('buys length with the paddings on the free axis', () => {
      // Which is where `labelBoxFor` puts the margins on a turned label, because
      // a margin is blank tape and the roll's width is not the template's to
      // spend. See its own tests below.
      // Left-aligned, so the leading padding is the x it starts at rather than
      // something a centre offset has already absorbed.
      const one = template([line('Ada', 'sm', false, 'left')]);
      const plain = layoutLabel(one, {}, SIDEWAYS, measure);
      const spaced = layoutLabel(
        one,
        {},
        { ...SIDEWAYS, paddingLeft: 60, paddingRight: 100 },
        measure,
      );

      expect(spaced.width).toBe(plain.width + (60 - 8) + (100 - 8));
      expect(spaced.draws[0]!.x).toBe(60);
    });

    it('moves the block within the fixed axis without lengthening anything', () => {
      // A padding on the axis that cannot grow can only shift what is centred in
      // it — by half what was added, the same as a die-cut label.
      const one = template([line('Ada', 'sm')]);
      const plain = layoutLabel(one, {}, SIDEWAYS, measure);
      const spaced = layoutLabel(one, {}, { ...SIDEWAYS, paddingTop: 60 }, measure);

      expect(spaced.width).toBe(plain.width);
      expect(spaced.draws[0]!.y - plain.draws[0]!.y).toBe((60 - 8) / 2);
    });
  });

  describe('when the content is taller than a die-cut label', () => {
    const overfull = template([
      line('Bartholomew', 'xl', true),
      line('12th grade', 'lg'),
      line('Sunday Nursery', 'lg'),
      line('9:04 AM', 'lg'),
      line('Room 3', 'lg'),
      line('Extra', 'lg'),
    ]);

    it('scales the whole block by one factor, keeping the proportions', () => {
      const fitted = layoutLabel(overfull, {}, DIE_CUT, measure);
      const loose = layoutLabel(overfull, {}, ENDLESS, measure);

      expect(fitted.scaledToFit).toBe(true);

      // The leader chose xl over lg; that relationship survives the squeeze.
      const fittedFirst = fitted.draws[0]!.fontPx;
      const fittedSecond = fitted.draws[1]!.fontPx;
      expect(fittedFirst).toBeGreaterThan(fittedSecond);

      // And it really is smaller than the unconstrained layout.
      expect(fittedFirst).toBeLessThan(loose.draws[0]!.fontPx);
    });

    it('drops trailing lines last, and keeps the name', () => {
      const result = layoutLabel(overfull, {}, DIE_CUT, measure);
      if (result.droppedLines > 0) {
        expect(result.draws[0]!.text).toBe('Bartholomew');
        expect(result.draws.map((draw) => draw.text)).not.toContain('Extra');
      }
      // Whatever it took, the result fits.
      expect(result.height).toBe(271);
    });

    it('always keeps at least one line', () => {
      const absurd = template(
        Array.from({ length: 6 }, () => line('Bartholomew Fitzwilliam', 'xl', true)),
      );
      const result = layoutLabel(absurd, {}, DIE_CUT, measure);
      expect(result.draws.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('geometry', () => {
    it('reports the die-cut height it was given', () => {
      expect(layoutLabel(template([line('Ada')]), {}, DIE_CUT, measure).height).toBe(271);
    });

    it('centres the block vertically on a die-cut label', () => {
      const result = layoutLabel(template([line('Ada', 'sm')]), {}, DIE_CUT, measure);
      const baseline = result.draws[0]!.y;
      // One small line on a tall label sits near the middle, not at the top.
      expect(baseline).toBeGreaterThan(271 / 3);
      expect(baseline).toBeLessThan((271 * 2) / 3);
    });

    it('anchors each alignment where the box edge is', () => {
      const result = layoutLabel(
        template([line('a', 'md', false, 'left'), line('b', 'md', false, 'center'), line('c', 'md', false, 'right')]),
        {},
        DIE_CUT,
        measure,
      );
      const [left, centre, right] = result.draws;
      expect(left!.x).toBe(8);
      expect(centre!.x).toBe(8 + 680 / 2);
      expect(right!.x).toBe(8 + 680);
    });

    it('honours a custom padding', () => {
      const result = layoutLabel(
        template([line('a', 'md', false, 'left')]),
        {},
        { ...DIE_CUT, padding: 24 },
        measure,
      );
      expect(result.draws[0]!.x).toBe(24);
    });

    it('cannot lengthen a die-cut label by asking for margins', () => {
      // The height was fixed going in. All the ends can do here is decide how
      // much room the block is centred in, which is why the kiosk only offers
      // them for tape.
      const result = layoutLabel(
        template([line('Ada', 'sm')]),
        {},
        { ...DIE_CUT, paddingTop: 100, paddingBottom: 4 },
        measure,
      );
      expect(result.height).toBe(271);
      expect(result.draws[0]!.y).toBeGreaterThan(100);
    });

    it('stacks lines downwards without overlapping', () => {
      const result = layoutLabel(
        template([line('one', 'md'), line('two', 'md'), line('three', 'md')]),
        {},
        ENDLESS,
        measure,
      );
      const baselines = result.draws.map((draw) => draw.y);
      for (let i = 1; i < baselines.length; i++) {
        expect(baselines[i]!).toBeGreaterThan(baselines[i - 1]!);
      }
    });

    it('rounds baselines to whole dots', () => {
      const result = layoutLabel(
        template([line('one', 'xl'), line('two', 'sm')]),
        {},
        ENDLESS,
        measure,
      );
      for (const draw of result.draws) expect(Number.isInteger(draw.y)).toBe(true);
    });
  });

  it('draws nothing for a template whose every line resolved to empty', () => {
    // A gathering whose template is all grade and surname, and a child on the
    // roster with neither. Better a blank label than a crash at the door.
    const result = layoutLabel(
      template([line('{{grade}}'), line('{{lastName}}')]),
      { firstName: 'Ada' },
      DIE_CUT,
      measure,
    );
    expect(result.draws).toEqual([]);
    expect(result.height).toBe(271);
  });
});

/**
 * Where the template's wishes meet the roll that is loaded.
 *
 * Shared by the kiosk's rasteriser and the editor's preview, so these cases are
 * the contract between what a leader is shown and what comes out of the printer.
 */
describe('labelBoxFor', () => {
  const TAPE = { widthDots: 696, lengthDots: null };
  const DIE = { widthDots: 696, lengthDots: 271 };
  const plain = template([line('Ada')]);

  const withShape = (shape: Partial<LabelTemplate>): LabelTemplate => ({ ...plain, ...shape });

  it('leaves the length free on tape, and fixes both on die-cut', () => {
    expect(labelBoxFor(plain, TAPE).box).toMatchObject({ width: 696, height: null });
    expect(labelBoxFor(plain, DIE).box).toMatchObject({ width: 696, height: 271 });
  });

  it('swaps which dimension is free when the label is turned', () => {
    const { box, rotated } = labelBoxFor(withShape({ rotated: true }), TAPE);
    expect(rotated).toBe(true);
    // The roll's width is now the height the lines share.
    expect(box).toMatchObject({ width: null, height: 696 });
  });

  it('refuses to turn a die-cut label, whose size somebody chose', () => {
    const { box, rotated } = labelBoxFor(withShape({ rotated: true }), DIE);
    expect(rotated).toBe(false);
    expect(box).toMatchObject({ width: 696, height: 271 });
  });

  it('pins the free dimension to a fixed length, whichever one it is', () => {
    const dots = Math.round(50 * DOTS_PER_MM);
    expect(labelBoxFor(withShape({ fixedLengthMm: 50 }), TAPE).box).toMatchObject({
      width: 696,
      height: dots,
    });
    expect(labelBoxFor(withShape({ fixedLengthMm: 50, rotated: true }), TAPE).box).toMatchObject({
      width: dots,
      height: 696,
    });
  });

  it('ignores a fixed length on media that already has one', () => {
    expect(labelBoxFor(withShape({ fixedLengthMm: 50 }), DIE).box).toMatchObject({
      width: 696,
      height: 271,
    });
  });

  it('converts the margins to dots, and leaves them alone when unset', () => {
    expect(labelBoxFor(withShape({ marginTopMm: 10 }), TAPE).box).toMatchObject({
      paddingTop: Math.round(10 * DOTS_PER_MM),
      paddingBottom: undefined,
    });
  });

  describe('where the margins land', () => {
    /*
     * They belong to the tape, not to the text. A margin is the blank strip at
     * each end of the sticker — the two ends the cutter makes — so it is always
     * spent on length and never on the roll's width, which is not the
     * template's to spend in the first place.
     */
    const top = Math.round(10 * DOTS_PER_MM);
    const bottom = Math.round(4 * DOTS_PER_MM);
    const shape = { marginTopMm: 10, marginBottomMm: 4 };

    it('puts them above and below an upright label', () => {
      expect(labelBoxFor(withShape(shape), TAPE).box).toMatchObject({
        paddingTop: top,
        paddingBottom: bottom,
      });
    });

    it('puts them left and right of a turned one, which is the same two ends', () => {
      // The turn sends the layout's left edge to the leading end of the tape,
      // so "above" stays the end of the sticker that comes out first.
      expect(labelBoxFor(withShape({ ...shape, rotated: true }), TAPE).box).toMatchObject({
        paddingLeft: top,
        paddingRight: bottom,
      });
    });

    it('never spends them on the roll\'s width', () => {
      const { box } = labelBoxFor(withShape({ ...shape, rotated: true }), TAPE);
      // The fixed axis is the roll's width, and nothing here may touch it.
      expect(box.paddingTop).toBeUndefined();
      expect(box.paddingBottom).toBeUndefined();
      expect(box.height).toBe(696);
    });
  });
});
