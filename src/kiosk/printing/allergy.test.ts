/**
 * What a lobby screen is allowed to learn about a child's allergy, and when.
 *
 * The label token is the one place Tally puts medical information on paper, so
 * the rules around it are worth pinning as tests rather than as intentions. Two
 * kinds of claim here, and they pull in opposite directions on purpose.
 *
 * The restraint: nothing is asked for unless a leader put `{{allergy}}` on this
 * gathering's template, nothing is asked for about a child the roster has not
 * flagged, and nothing is kept once the sticker is drawn. A regression in any of
 * those turns a per-child read into a lobby device quietly holding four hundred
 * children's medical notes, which is the thing this feature was built not to do.
 *
 * The other half matters just as much: a flagged child must never get a blank.
 * `Allergy` on its own is a volunteer being told to go and check; an empty line
 * is a volunteer being told there is nothing to check, and that is the failure
 * worth being loudest about.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALLERGY_UNREAD,
  ALLERGY_WAIT_MS,
  allergyFor,
  forgetAllergies,
  forgetAllergy,
  setAllergySource,
  startAllergyLookup,
  usesAllergyToken,
} from '@/kiosk/printing/allergy';
import { DEFAULT_LABEL_TEMPLATE, type LabelTemplate } from '@/lib/labelTemplate';
import type { KioskStudent } from '@/kiosk/search';

const PRINTS_ALLERGY: LabelTemplate = {
  lines: [
    { text: '{{firstName}} {{lastInitial}}', size: 'xl', bold: true, align: 'center', requiresValue: false },
    { text: '{{allergy}}', size: 'md', bold: true, align: 'center', requiresValue: false },
  ],
  copies: 1,
};

function student(overrides: Partial<KioskStudent> = {}): KioskStudent {
  return {
    id: 'pco_4200003',
    firstName: 'Ada',
    lastName: 'Lovelace',
    grade: 8,
    searchName: 'ada lovelace',
    hasAllergies: true,
    ...overrides,
  };
}

beforeEach(() => {
  forgetAllergies();
  setAllergySource(null);
});

afterEach(() => {
  forgetAllergies();
  setAllergySource(null);
  vi.useRealTimers();
});

describe('usesAllergyToken', () => {
  it('is false for the template a leader gets by default', () => {
    // Printing an allergy is a decision somebody makes, never one they inherit.
    expect(usesAllergyToken(DEFAULT_LABEL_TEMPLATE)).toBe(false);
  });

  it('is true once the token is on any line', () => {
    expect(usesAllergyToken(PRINTS_ALLERGY)).toBe(true);
  });

  it('ignores a token that merely looks like it', () => {
    expect(
      usesAllergyToken({
        lines: [{ text: '{{allergies}} {{allergyNote}}', size: 'md', bold: false, align: 'center', requiresValue: false }],
        copies: 1,
      }),
    ).toBe(false);
  });
});

describe('what gets asked for', () => {
  it('asks nobody anything when the template does not print an allergy', async () => {
    const source = vi.fn(async () => 'Peanuts');
    setAllergySource(source);

    startAllergyLookup(student(), DEFAULT_LABEL_TEMPLATE);

    expect(source).not.toHaveBeenCalled();
    // Undefined rather than empty: this job never asked, so the rasteriser
    // leaves the values it was given alone.
    await expect(allergyFor('pco_4200003')).resolves.toBeUndefined();
  });

  it('asks nobody anything about a child with nothing on file', async () => {
    const source = vi.fn(async () => 'Peanuts');
    setAllergySource(source);

    startAllergyLookup(student({ hasAllergies: false }), PRINTS_ALLERGY);

    // The flag on the roster row is what saves four hundred reads a Sunday.
    expect(source).not.toHaveBeenCalled();
    await expect(allergyFor('pco_4200003')).resolves.toBe('');
  });

  it('asks about exactly one child, by id', async () => {
    const source = vi.fn(async () => 'Peanuts — EpiPen in her bag');
    setAllergySource(source);

    startAllergyLookup(student(), PRINTS_ALLERGY);

    expect(source).toHaveBeenCalledTimes(1);
    expect(source).toHaveBeenCalledWith('pco_4200003');
    await expect(allergyFor('pco_4200003')).resolves.toBe('Peanuts — EpiPen in her bag');
  });

  it('asks once when the label is warmed and then printed', () => {
    const source = vi.fn(async () => 'Peanuts');
    setAllergySource(source);

    // The ordinary path: the confirm screen opens, then a thumb lands.
    startAllergyLookup(student(), PRINTS_ALLERGY);
    startAllergyLookup(student(), PRINTS_ALLERGY);

    expect(source).toHaveBeenCalledTimes(1);
  });
});

describe('a flagged child never gets a blank', () => {
  it('falls back to the bare word when the read fails', async () => {
    setAllergySource(async () => {
      throw new Error('offline in the hallway');
    });

    startAllergyLookup(student(), PRINTS_ALLERGY);

    // Not empty. An empty line is a volunteer told there is nothing to check.
    await expect(allergyFor('pco_4200003')).resolves.toBe(ALLERGY_UNREAD);
  });

  it('falls back when the note on file is blank', async () => {
    setAllergySource(async () => '   ');

    startAllergyLookup(student(), PRINTS_ALLERGY);

    await expect(allergyFor('pco_4200003')).resolves.toBe(ALLERGY_UNREAD);
  });

  it('falls back when there is nothing to ask', async () => {
    // A kiosk mid-boot, whose services chunk has not landed yet.
    setAllergySource(null);

    startAllergyLookup(student(), PRINTS_ALLERGY);

    await expect(allergyFor('pco_4200003')).resolves.toBe(ALLERGY_UNREAD);
  });

  it('falls back rather than holding the queue open for ever', async () => {
    vi.useFakeTimers();
    // A read that will never answer, which is what a dead hallway connection
    // looks like from here.
    setAllergySource(() => new Promise<string>(() => {}));

    startAllergyLookup(student(), PRINTS_ALLERGY);
    const pending = allergyFor('pco_4200003');
    await vi.advanceTimersByTimeAsync(ALLERGY_WAIT_MS);

    // Every label behind this one is also somebody's child at a door.
    await expect(pending).resolves.toBe(ALLERGY_UNREAD);
  });

  it('prefers the real note when it arrives inside the budget', async () => {
    vi.useFakeTimers();
    setAllergySource(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('Peanuts'), ALLERGY_WAIT_MS / 2);
        }),
    );

    startAllergyLookup(student(), PRINTS_ALLERGY);
    const pending = allergyFor('pco_4200003');
    await vi.advanceTimersByTimeAsync(ALLERGY_WAIT_MS);

    await expect(pending).resolves.toBe('Peanuts');
  });
});

describe('what is kept, and for how long', () => {
  it('holds nothing for a child the parent backed out of', async () => {
    setAllergySource(async () => 'Peanuts');

    startAllergyLookup(student(), PRINTS_ALLERGY);
    forgetAllergy('pco_4200003');

    await expect(allergyFor('pco_4200003')).resolves.toBeUndefined();
  });

  it('holds nothing once the kiosk leaves the gathering', async () => {
    setAllergySource(async () => 'Peanuts');

    startAllergyLookup(student({ id: 'pco_1' }), PRINTS_ALLERGY);
    startAllergyLookup(student({ id: 'pco_2' }), PRINTS_ALLERGY);
    forgetAllergies();

    await expect(allergyFor('pco_1')).resolves.toBeUndefined();
    await expect(allergyFor('pco_2')).resolves.toBeUndefined();
  });

  it('holds only a handful at a time, oldest out first', async () => {
    setAllergySource(async (id) => `note for ${id}`);

    // Nine children through one confirm screen after another — a queue at the
    // door, not a device accumulating a roster's worth of medical notes.
    for (let index = 0; index < 9; index += 1) {
      startAllergyLookup(student({ id: `pco_${index}` }), PRINTS_ALLERGY);
    }

    await expect(allergyFor('pco_0')).resolves.toBeUndefined();
    await expect(allergyFor('pco_8')).resolves.toBe('note for pco_8');
  });
});
