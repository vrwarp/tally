/**
 * What a label says, and what a bad stored template reads as.
 *
 * The sanitizer's job is to make a kiosk unbreakable by a document: a template
 * written by a newer deploy, hand-edited in the Firebase console, or half-saved
 * must degrade to something printable or to null, never to a thrown error on a
 * screen nobody is standing at.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LABEL_TEMPLATE,
  MAX_LABEL_FIXED_LENGTH_MM,
  MAX_LABEL_FONT_SCALE,
  MAX_LABEL_MARGIN_MM,
  MIN_LABEL_FONT_SCALE,
  MIN_LABEL_FIXED_LENGTH_MM,
  LABEL_TOKENS,
  MAX_LABEL_COPIES,
  MAX_LABEL_LINES,
  fillLabelTokens,
  sameLabelTemplate,
  sanitizeLabelTemplate,
  tokensIn,
  unknownTokensIn,
  type LabelTemplate,
} from '@/lib/labelTemplate';

describe('fillLabelTokens', () => {
  it('substitutes the values it is given', () => {
    expect(fillLabelTokens('{{firstName}} {{lastInitial}}', { firstName: 'Ada', lastInitial: 'L' })).toBe(
      'Ada L',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(fillLabelTokens('{{ firstName }}', { firstName: 'Ada' })).toBe('Ada');
  });

  it('leaves nothing behind for a token with no value', () => {
    // The failure this prevents is a sticker reading literally "{{grade}}".
    expect(fillLabelTokens('{{grade}}', {})).toBe('');
  });

  it('blanks a token it does not know', () => {
    expect(fillLabelTokens('{{allergies}}', { firstName: 'Ada' })).toBe('');
  });

  it('closes the gap a missing value leaves', () => {
    // A child with no surname on the roster gets "Ada", not "Ada ".
    expect(fillLabelTokens('{{firstName}} {{lastInitial}}', { firstName: 'Ada' })).toBe('Ada');
  });

  it('keeps literal text around the tokens', () => {
    expect(fillLabelTokens('In: {{time}}', { time: '9:04 AM' })).toBe('In: 9:04 AM');
  });

  it('collapses runs of whitespace', () => {
    expect(fillLabelTokens('  {{firstName}}   {{lastName}}  ', { firstName: 'Ada', lastName: 'L' })).toBe(
      'Ada L',
    );
  });
});

describe('an optional [...] group', () => {
  const full = { lastName: 'Lovelace', grade: '8th grade' };
  const sparse = { lastName: 'Lovelace' };

  it('keeps the group, punctuation and all, for a child who has the value', () => {
    expect(fillLabelTokens('{{lastName}}[ ({{grade}})]', full)).toBe('Lovelace (8th grade)');
  });

  it('drops the whole group for a child who has none', () => {
    // The point of the feature: without brackets this line prints "Lovelace ()"
    // for most of a nursery, and collapsing whitespace cannot fix a bracket.
    expect(fillLabelTokens('{{lastName}}[ ({{grade}})]', sparse)).toBe('Lovelace');
    expect(fillLabelTokens('{{lastName}} ({{grade}})', sparse)).toBe('Lovelace ()');
  });

  it('keeps a group where only some of its tokens came to nothing', () => {
    // Same "any, not all" rule `requiresValue` applies to a line.
    expect(fillLabelTokens('[{{lastName}} {{grade}}]', sparse)).toBe('Lovelace');
  });

  it('keeps a group of fixed text, which has nothing to wait on', () => {
    expect(fillLabelTokens('[Room 3]', sparse)).toBe('Room 3');
  });

  it('drops a whole line that is nothing but an empty group', () => {
    // Which is what lets the renderer close the gap: an empty line is dropped.
    expect(fillLabelTokens('[Allergy: {{allergy}}]', sparse)).toBe('');
  });

  it('handles more than one group on a line', () => {
    expect(fillLabelTokens('{{lastName}}[ ({{grade}})][ — {{allergy}}]', full)).toBe(
      'Lovelace (8th grade)',
    );
  });

  it('lets a leader type a real bracket by doubling it', () => {
    expect(fillLabelTokens('Room [[3]]', sparse)).toBe('Room [3]');
  });

  it('still reports the tokens inside a group', () => {
    // The editor's unknown-token check and `requiresValue` both read this, and
    // a token hidden from them because it sat inside brackets would be a
    // template that warns about nothing and drops nothing.
    expect(tokensIn('{{lastName}}[ ({{grade}})]')).toEqual(['lastName', 'grade']);
  });
});

describe('tokensIn', () => {
  it('lists tokens in first-seen order without repeats', () => {
    expect(tokensIn('{{firstName}} {{grade}} {{firstName}}')).toEqual(['firstName', 'grade']);
  });

  it('reports the ones the kiosk cannot answer', () => {
    expect(unknownTokensIn('{{firstName}} {{allergies}}')).toEqual(['allergies']);
    expect(unknownTokensIn('{{firstName}} {{grade}}')).toEqual([]);
  });
});

describe('the default template', () => {
  it('survives its own sanitizer unchanged', () => {
    expect(sanitizeLabelTemplate(DEFAULT_LABEL_TEMPLATE)).toEqual(DEFAULT_LABEL_TEMPLATE);
  });

  it('uses only tokens the kiosk can answer', () => {
    for (const line of DEFAULT_LABEL_TEMPLATE.lines) {
      expect(unknownTokensIn(line.text)).toEqual([]);
    }
  });

  it('does not mention anything the kiosk is not allowed to know', () => {
    // Parent contact and photographs do not reach a lobby screen — see the
    // docblock in labelTemplate.ts. This is a tripwire on the token list, not on
    // the text.
    expect(LABEL_TOKENS).not.toContain('parentPhone');
    expect(LABEL_TOKENS).not.toContain('parentName');
    expect(LABEL_TOKENS).not.toContain('parentEmail');
    expect(LABEL_TOKENS).not.toContain('notes');
  });

  /*
   * The allergy token is the one exception to the paragraph above, and the pair
   * of claims below is what makes it one rather than a hole. It has to exist —
   * the volunteer holding the child is the person who needs to know — and it has
   * to stay off a label nobody asked for it on.
   */
  it('can print an allergy, because the volunteer holding the child needs it', () => {
    expect(LABEL_TOKENS).toContain('allergy');
    expect(unknownTokensIn('{{allergy}}')).toEqual([]);
  });

  it('does not print one unless a leader asked for it', () => {
    for (const line of DEFAULT_LABEL_TEMPLATE.lines) {
      expect(tokensIn(line.text)).not.toContain('allergy');
    }
  });

  it('leaves the line empty for a child with nothing on file', () => {
    // Which is what makes the line disappear rather than print blank — see
    // `resolveLines`. A template can therefore carry the token unconditionally.
    expect(fillLabelTokens('{{allergy}}', { firstName: 'Ada' })).toBe('');
    expect(fillLabelTokens('{{allergy}}', { allergy: 'Peanuts' })).toBe('Peanuts');
  });
});

describe('sanitizeLabelTemplate', () => {
  it('reads a well-formed template', () => {
    const template: LabelTemplate = {
      lines: [{ text: '{{firstName}}', size: 'xl', bold: true, align: 'left', requiresValue: false }],
      copies: 2,
    };
    expect(sanitizeLabelTemplate(template)).toEqual(template);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'labels please'],
    ['a number', 7],
    ['an empty object', {}],
    ['lines that are not a list', { lines: 'one' }],
    ['an empty line list', { lines: [] }],
  ])('reads %s as "this gathering prints nothing"', (_name, value) => {
    expect(sanitizeLabelTemplate(value)).toBeNull();
  });

  it('drops lines with no usable text', () => {
    const result = sanitizeLabelTemplate({
      lines: [
        { text: '{{firstName}}', size: 'xl', bold: true, align: 'center', requiresValue: false },
        { text: '   ', size: 'md', bold: false, align: 'center', requiresValue: false },
        { text: 42, size: 'md', bold: false, align: 'center', requiresValue: false },
        null,
        { text: '{{grade}}', size: 'md', bold: false, align: 'center', requiresValue: false },
      ],
      copies: 1,
    });
    expect(result?.lines.map((line) => line.text)).toEqual(['{{firstName}}', '{{grade}}']);
  });

  it('falls back to a readable default for an unknown size or alignment', () => {
    // A template from a deploy that added a size this one has never heard of
    // should still print, at a size this one has.
    const result = sanitizeLabelTemplate({
      lines: [{ text: 'Hello', size: 'gigantic', bold: 'yes', align: 'justify' }],
      copies: 1,
    });
    expect(result?.lines[0]).toEqual({ text: 'Hello', size: 'md', bold: false, align: 'center', requiresValue: false });
  });

  it('drops keys it does not recognise', () => {
    const result = sanitizeLabelTemplate({
      lines: [{ text: 'Hello', size: 'md', bold: false, align: 'center', rotate: 90, colour: 'red' }],
      copies: 1,
    });
    expect(Object.keys(result!.lines[0]!).sort()).toEqual([
      'align',
      'bold',
      'requiresValue',
      'size',
      'text',
    ]);
  });

  it('caps the line count', () => {
    const lines = Array.from({ length: MAX_LABEL_LINES + 4 }, (_unused, index) => ({
      text: `line ${index}`,
      size: 'sm',
      bold: false,
      align: 'center',
    }));
    expect(sanitizeLabelTemplate({ lines, copies: 1 })?.lines).toHaveLength(MAX_LABEL_LINES);
  });

  it('caps and floors the copy count', () => {
    const lines = [{ text: 'Hello', size: 'md', bold: false, align: 'center', requiresValue: false }];
    expect(sanitizeLabelTemplate({ lines, copies: 99 })?.copies).toBe(MAX_LABEL_COPIES);
    expect(sanitizeLabelTemplate({ lines, copies: 0 })?.copies).toBe(1);
    expect(sanitizeLabelTemplate({ lines, copies: -3 })?.copies).toBe(1);
    expect(sanitizeLabelTemplate({ lines, copies: 2.7 })?.copies).toBe(2);
    expect(sanitizeLabelTemplate({ lines, copies: Number.NaN })?.copies).toBe(1);
    expect(sanitizeLabelTemplate({ lines })?.copies).toBe(1);
  });

  it('truncates a line long enough to be a mistake', () => {
    const result = sanitizeLabelTemplate({
      lines: [{ text: 'x'.repeat(500), size: 'md', bold: false, align: 'center', requiresValue: false }],
      copies: 1,
    });
    expect(result?.lines[0]?.text.length).toBe(120);
  });
});

describe('the shape settings', () => {
  function shaped(extra: Record<string, unknown>) {
    return sanitizeLabelTemplate({ ...DEFAULT_LABEL_TEMPLATE, ...extra });
  }

  it('keeps a margin, a turn and a fixed length that are in range', () => {
    expect(shaped({ marginTopMm: 6, marginBottomMm: 2, rotated: true, fixedLengthMm: 50 })).toMatchObject(
      { marginTopMm: 6, marginBottomMm: 2, rotated: true, fixedLengthMm: 50 },
    );
  });

  it('leaves them off a template that does not mention them', () => {
    // Every gathering already set up. Absent has to survive as absent, because
    // absent is what the renderer reads as "print what you printed yesterday".
    const template = sanitizeLabelTemplate(DEFAULT_LABEL_TEMPLATE)!;
    expect('marginTopMm' in template).toBe(false);
    expect('rotated' in template).toBe(false);
    expect('fixedLengthMm' in template).toBe(false);
  });

  it('clamps rather than refusing the template it came in', () => {
    // A wrong margin is a label that looks odd; a refused template is a
    // gathering that silently stops printing.
    expect(shaped({ marginTopMm: 900, marginBottomMm: -5 })).toMatchObject({
      marginTopMm: MAX_LABEL_MARGIN_MM,
      marginBottomMm: 0,
    });
    expect(shaped({ fixedLengthMm: 4000 })).toMatchObject({
      fixedLengthMm: MAX_LABEL_FIXED_LENGTH_MM,
    });
    expect(shaped({ fixedLengthMm: 1 })).toMatchObject({
      fixedLengthMm: MIN_LABEL_FIXED_LENGTH_MM,
    });
  });

  it('drops a value that is not a number, back to the default', () => {
    const template = shaped({ marginTopMm: '6mm', fixedLengthMm: Number.NaN })!;
    expect('marginTopMm' in template).toBe(false);
    expect('fixedLengthMm' in template).toBe(false);
  });

  it('clamps the text size factor, and drops one that is not a number', () => {
    expect(shaped({ fontScale: 9 })).toMatchObject({ fontScale: MAX_LABEL_FONT_SCALE });
    expect(shaped({ fontScale: 0.1 })).toMatchObject({ fontScale: MIN_LABEL_FONT_SCALE });
    expect('fontScale' in shaped({ fontScale: 'big' })!).toBe(false);
  });

  it('tells two templates apart by their text size', () => {
    expect(sameLabelTemplate(sanitizeLabelTemplate(DEFAULT_LABEL_TEMPLATE), shaped({ fontScale: 2 }))).toBe(
      false,
    );
  });

  it('reads anything but true as not rotated', () => {
    expect('rotated' in shaped({ rotated: 'yes' })!).toBe(false);
    expect('rotated' in shaped({ rotated: false })!).toBe(false);
  });

  it('tells two templates apart by their shape alone', () => {
    const plain = sanitizeLabelTemplate(DEFAULT_LABEL_TEMPLATE);
    expect(sameLabelTemplate(plain, shaped({ marginTopMm: 6 }))).toBe(false);
    expect(sameLabelTemplate(plain, shaped({ rotated: true }))).toBe(false);
    expect(sameLabelTemplate(plain, shaped({ fixedLengthMm: 50 }))).toBe(false);
    // An absent turn and an explicit false are the same label, so a template
    // read back from Firestore does not look like an unsaved edit.
    expect(sameLabelTemplate(plain, shaped({ rotated: false }))).toBe(true);
  });
});

describe('sameLabelTemplate', () => {
  it('treats two nulls as the same and one null as different', () => {
    expect(sameLabelTemplate(null, null)).toBe(true);
    expect(sameLabelTemplate(DEFAULT_LABEL_TEMPLATE, null)).toBe(false);
    expect(sameLabelTemplate(null, DEFAULT_LABEL_TEMPLATE)).toBe(false);
  });

  it('compares content rather than identity', () => {
    expect(
      sameLabelTemplate(DEFAULT_LABEL_TEMPLATE, structuredClone(DEFAULT_LABEL_TEMPLATE)),
    ).toBe(true);
  });

  it('notices a changed line, size or copy count', () => {
    const changedText = structuredClone(DEFAULT_LABEL_TEMPLATE);
    changedText.lines[0]!.text = '{{lastName}}';
    expect(sameLabelTemplate(DEFAULT_LABEL_TEMPLATE, changedText)).toBe(false);

    const changedSize = structuredClone(DEFAULT_LABEL_TEMPLATE);
    changedSize.lines[0]!.size = 'sm';
    expect(sameLabelTemplate(DEFAULT_LABEL_TEMPLATE, changedSize)).toBe(false);

    const changedCopies = structuredClone(DEFAULT_LABEL_TEMPLATE);
    changedCopies.copies = 2;
    expect(sameLabelTemplate(DEFAULT_LABEL_TEMPLATE, changedCopies)).toBe(false);
  });

  it('notices a dropped line', () => {
    const shorter = structuredClone(DEFAULT_LABEL_TEMPLATE);
    shorter.lines.pop();
    expect(sameLabelTemplate(DEFAULT_LABEL_TEMPLATE, shorter)).toBe(false);
  });
});
