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

import { layoutLabel, resolveLines, type LabelBox, type MeasureText } from '@/lib/labelRender';
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
) => ({ text, size, bold, align });

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
