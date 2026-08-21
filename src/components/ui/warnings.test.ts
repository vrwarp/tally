/**
 * The tone rulebook, asserted rather than described.
 *
 * `warnings.ts` had the right rule written down in prose and no way to notice
 * when a screen broke it: a student's missing parent contact was an amber ⚠ on
 * the dashboard's new-faces list and on their own detail header, while the
 * table two imports away called it a neutral chip, and a dead Planning Center
 * record was amber on the roster and red on the record. Prose does not fail a
 * build. These do.
 *
 * What they pin down, in order of how much a counselor pays when it drifts:
 *
 * 1. Amber and the ⚠ belong to the allergy and to nothing else. Every other
 *    flag borrowing them is one more amber row a counselor has to stop and read
 *    a word on, until they stop reading amber — and the one they stop reading
 *    is the allergy.
 * 2. Red means the app itself will refuse, which is true of exactly one
 *    condition and must not spread to the ones that are merely untidy.
 * 3. Every condition the app can flag has a row here. A condition without one
 *    is a call site inventing a colour.
 */
import { describe, expect, it } from 'vitest';
import {
  ROSTER_WARNINGS,
  WARNING_META,
  warningGlyph,
  warningLabel,
  warningShort,
  warningTone,
} from '@/components/ui/warnings';
import type { RosterWarning } from '@/types';

const ALL = ROSTER_WARNINGS as readonly RosterWarning[];

describe('WARNING_META', () => {
  it('covers every condition the app flags, once each', () => {
    expect([...Object.keys(WARNING_META)].sort()).toEqual([...ALL].sort());
    expect(new Set(ALL).size).toBe(ALL.length);
  });

  it('names all three conditions the roster and the record can raise', () => {
    // Spelled out rather than derived, so that adding a fourth flag is a
    // decision somebody makes here and not a silent inheritance of a colour.
    expect([...ALL].sort()).toEqual(['allergy', 'incomplete-profile', 'record-missing']);
  });

  it('gives every condition a spoken sentence and a short form', () => {
    for (const warning of ALL) {
      expect(warningLabel(warning).length).toBeGreaterThan(0);
      expect(warningShort(warning).length).toBeGreaterThan(0);
      // The short form sits in a fixed-width lane on two roster rows. Long
      // enough to wrap is long enough to change a row's height.
      expect(warningShort(warning).length).toBeLessThanOrEqual(12);
    }
  });
});

describe('the amber rule', () => {
  it('spends amber on the allergy and on nothing else', () => {
    const amber = ALL.filter((warning) => warningTone(warning) === 'warn');
    expect(amber).toEqual(['allergy']);
  });

  it('gives the ⚠ to the allergy and to nothing else', () => {
    const marked = ALL.filter((warning) => warningGlyph(warning) !== null);
    expect(marked).toEqual(['allergy']);
    expect(warningGlyph('allergy')).toBe('⚠');
  });

  it('keeps a missing parent contact clerical', () => {
    // The demotion this table exists for. Amber here is what teaches a
    // counselor that amber is usually paperwork.
    expect(warningTone('incomplete-profile')).toBe('neutral');
    expect(warningGlyph('incomplete-profile')).toBeNull();
    expect(warningLabel('incomplete-profile')).toBe('Missing parent contact');
  });
});

describe('the red rule', () => {
  it('spends red on the one condition the app actually refuses', () => {
    const red = ALL.filter((warning) => warningTone(warning) === 'danger');
    expect(red).toEqual(['record-missing']);
  });

  it("keeps the frozen record out of the allergy's colour", () => {
    // It has a consequence at the door, which is why it is not neutral — but
    // the consequence is that the write is rejected, not that somebody could
    // be hurt, so it is red and it carries no ⚠.
    expect(warningTone('record-missing')).not.toBe('warn');
    expect(warningGlyph('record-missing')).toBeNull();
    expect(warningLabel('record-missing')).toMatch(/check-in frozen/);
  });
});

describe('one tone per condition', () => {
  it('lets no two conditions wear the same colour', () => {
    // Not a rule about tones in general — a rule about these three. Two flags
    // in one colour is two flags a reader has to tell apart by an 11px word.
    const tones = ALL.map(warningTone);
    expect(new Set(tones).size).toBe(tones.length);
  });

  it('offers no tone a warning is not allowed to wear', () => {
    for (const warning of ALL) {
      expect(['neutral', 'warn', 'danger']).toContain(warningTone(warning));
    }
  });

  it('answers the same for the table and for the accessors', () => {
    // The accessors exist so a call site cannot hand-pick a tone. They are
    // worth nothing if they can disagree with the table they read.
    for (const warning of ALL) {
      const meta = WARNING_META[warning];
      expect(warningTone(warning)).toBe(meta.tone);
      expect(warningGlyph(warning)).toBe(meta.glyph);
      expect(warningLabel(warning)).toBe(meta.label);
      expect(warningShort(warning)).toBe(meta.short);
    }
  });
});
