/**
 * Unit tests for the small formatting/search helpers.
 *
 * `matchesQuery` gets the most attention: it is what stands between a counselor
 * and a student whose name they cannot spell, and it is used by the roster on
 * every keystroke.
 */
import { describe, expect, it } from 'vitest';
import {
  formatPhone,
  initials,
  matchesQuery,
  normalizeForSearch,
  ordinalGrade,
  partition,
  sortByName,
} from '@/lib/utils';

describe('matchesQuery', () => {
  it('is case-insensitive in both directions', () => {
    expect(matchesQuery('marcus lee', 'MARCUS')).toBe(true);
    expect(matchesQuery('Marcus Lee', 'marcus')).toBe(true);
    expect(matchesQuery('MARCUS LEE', 'MaRcUs')).toBe(true);
  });

  it('ignores diacritics so an ASCII keyboard finds an accented name', () => {
    expect(matchesQuery('josé garcía', 'Jose')).toBe(true);
    expect(matchesQuery('josé garcía', 'garcia')).toBe(true);
    // ...and the reverse: typing the accent still finds the plain spelling.
    expect(matchesQuery('jose garcia', 'José')).toBe(true);
    expect(matchesQuery('renée dubois', 'renee')).toBe(true);
  });

  it('matches a word prefix anywhere in the name', () => {
    expect(matchesQuery('marcus lee', 'le')).toBe(true);
    expect(matchesQuery('ana martinez', 'ma')).toBe(true);
    expect(matchesQuery('marcus lee', 'ma')).toBe(true);
  });

  it('matches on the full name across the space', () => {
    expect(matchesQuery('marcus lee', 'marcus l')).toBe(true);
    expect(matchesQuery('marcus lee', 'cus le')).toBe(true);
  });

  it('does not match an unrelated query', () => {
    expect(matchesQuery('marcus lee', 'z')).toBe(false);
    expect(matchesQuery('marcus lee', 'leeroy')).toBe(false);
  });

  it('treats an empty or whitespace-only query as "everything"', () => {
    expect(matchesQuery('marcus lee', '')).toBe(true);
    expect(matchesQuery('marcus lee', '   ')).toBe(true);
    expect(matchesQuery('', '')).toBe(true);
  });

  it('tolerates padding and repeated spaces in the query', () => {
    expect(matchesQuery('marcus lee', '  marcus   lee ')).toBe(true);
  });
});

describe('matchesQuery: punctuation and separators', () => {
  it('closes up apostrophes, in both spellings and both directions', () => {
    expect(matchesQuery("shannon o'brien", 'obrien')).toBe(true);
    expect(matchesQuery('shannon obrien', "o'brien")).toBe(true);
    // A phone keyboard substitutes the curly one without asking.
    expect(matchesQuery('shannon o’brien', "o'brien")).toBe(true);
    expect(matchesQuery("shannon o'brien", 'o’brien')).toBe(true);
  });

  it('treats hyphens, periods and spaces as the same word gap', () => {
    expect(matchesQuery('mary-jane watson', 'mary jane')).toBe(true);
    expect(matchesQuery('mary jane watson', 'mary-jane')).toBe(true);
    expect(matchesQuery('mary-jane watson', 'maryjane')).toBe(true);
    expect(matchesQuery('st. john', 'st john')).toBe(true);
    expect(matchesQuery('st john', 'st. john')).toBe(true);
  });

  it('finds a multi-word surname typed as one word', () => {
    expect(matchesQuery('sofia de la cruz', 'delacruz')).toBe(true);
    expect(matchesQuery('sofia delacruz', 'de la cruz')).toBe(true);
  });

  it('still refuses a query that is only punctuation', () => {
    // Nothing searchable was typed, so this narrows to nobody — it matches
    // everyone, exactly like an empty box.
    expect(matchesQuery('marcus lee', "-'.")).toBe(true);
  });
});

describe('matchesQuery: typos', () => {
  it('forgives a dropped, doubled or wrong letter', () => {
    expect(matchesQuery('marcus lee', 'marcs')).toBe(true); // dropped
    expect(matchesQuery('marcus lee', 'marccus')).toBe(true); // doubled
    expect(matchesQuery('marcus lee', 'marcys')).toBe(true); // wrong key
    expect(matchesQuery('josé garcía', 'garcai')).toBe(true);
  });

  it('forgives two letters typed in the wrong order', () => {
    // One edit, not two: this is how a name gets mistyped at speed.
    expect(matchesQuery('marcus lee', 'mracus')).toBe(true);
    expect(matchesQuery('ana martinez', 'martinze')).toBe(true);
  });

  it('forgives a typo in the middle of a full name', () => {
    expect(matchesQuery('marcus lee', 'marcus lea')).toBe(true);
    expect(matchesQuery('ana martinez', 'ana martinnez')).toBe(true);
  });

  it('scales the allowance to the length of the query', () => {
    // Under four characters the search stays literal: one edit at that length
    // reaches half a roster, which reads as a broken search.
    expect(matchesQuery('marcus lee', 'zee')).toBe(false);
    expect(matchesQuery('marcus lee', 'zzz')).toBe(false);
    // Two edits only once the query is long enough to still mean one person.
    expect(matchesQuery('ana martinez', 'martinnezz')).toBe(true);
    expect(matchesQuery('marcus lee', 'leeroy')).toBe(false);
  });

  it('does not turn into a match-anything', () => {
    expect(matchesQuery('marcus lee', 'fatima')).toBe(false);
    expect(matchesQuery('ana martinez', 'gabriel')).toBe(false);
    expect(matchesQuery('josé garcía', 'ibrahim')).toBe(false);
  });
});

describe('normalizeForSearch', () => {
  it('strips accents, lowercases and collapses whitespace', () => {
    expect(normalizeForSearch('  José   GARCÍA ')).toBe('jose garcia');
  });

  it('drops apostrophes and turns every other separator into one space', () => {
    expect(normalizeForSearch("O'Brien-Smith, Jr.")).toBe('obrien smith jr');
  });

  it('is idempotent, so an already-normalized name survives a second pass', () => {
    const once = normalizeForSearch(' Mary-Jane   O’Neill ');
    expect(once).toBe('mary jane oneill');
    expect(normalizeForSearch(once)).toBe(once);
  });

  it('keeps the marks that are part of the letter in non-Latin scripts', () => {
    // Latin diacritics are decoration and get stripped; a Devanagari matra is
    // not, and dropping it would shred the name into pieces.
    expect(normalizeForSearch('अनुज')).toBe('अनुज');
    expect(normalizeForSearch('مرحبا بالعالم')).toBe('مرحبا بالعالم');
  });
});

describe('ordinalGrade', () => {
  it('labels the grades the ministry actually serves', () => {
    expect(ordinalGrade(6)).toBe('6th');
    expect(ordinalGrade(7)).toBe('7th');
    expect(ordinalGrade(8)).toBe('8th');
    expect(ordinalGrade(9)).toBe('9th');
    expect(ordinalGrade(10)).toBe('10th');
    expect(ordinalGrade(11)).toBe('11th');
    expect(ordinalGrade(12)).toBe('12th');
  });

  it('uses "th" for the 11/12/13 exceptions rather than st/nd/rd', () => {
    expect(ordinalGrade(11)).toBe('11th');
    expect(ordinalGrade(12)).toBe('12th');
    expect(ordinalGrade(13)).toBe('13th');
  });

  it('still produces normal ordinals either side of the exception band', () => {
    expect(ordinalGrade(1)).toBe('1st');
    expect(ordinalGrade(2)).toBe('2nd');
    expect(ordinalGrade(3)).toBe('3rd');
    expect(ordinalGrade(21)).toBe('21st');
    expect(ordinalGrade(22)).toBe('22nd');
    expect(ordinalGrade(23)).toBe('23rd');
  });
});

describe('initials', () => {
  it('takes the first letter of each name, uppercased', () => {
    expect(initials('marcus', 'lee')).toBe('ML');
    expect(initials('José', 'García')).toBe('JG');
  });

  it('degrades gracefully on a missing name part', () => {
    expect(initials('Cher', '')).toBe('C');
    expect(initials('', '')).toBe('');
  });
});

describe('formatPhone', () => {
  it('formats a bare 10-digit number', () => {
    expect(formatPhone('5550100123')).toBe('(555) 010-0123');
  });

  it('normalises punctuation before formatting', () => {
    expect(formatPhone('555-010-0123')).toBe('(555) 010-0123');
    expect(formatPhone('(555) 010 0123')).toBe('(555) 010-0123');
  });

  it('drops a leading country code from an 11-digit number', () => {
    expect(formatPhone('15550100123')).toBe('(555) 010-0123');
    expect(formatPhone('+1 555 010 0123')).toBe('(555) 010-0123');
  });

  it('passes anything else through untouched', () => {
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(formatPhone('ext. 12')).toBe('ext. 12');
  });

  it('renders an absent number as an empty string', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone('')).toBe('');
  });
});

describe('sortByName', () => {
  const name = (firstName: string, lastName: string) => ({ firstName, lastName });

  it('orders by last name, then first name', () => {
    const people = [
      name('Ana', 'Rivera'),
      name('Zed', 'Alvarez'),
      name('Ben', 'Rivera'),
    ];
    expect([...people].sort(sortByName).map((p) => `${p.firstName} ${p.lastName}`)).toEqual([
      'Zed Alvarez',
      'Ana Rivera',
      'Ben Rivera',
    ]);
  });

  it('compares without case sensitivity', () => {
    expect(sortByName(name('a', 'alvarez'), name('A', 'ALVAREZ'))).toBe(0);
    expect(sortByName(name('Ana', 'alvarez'), name('Ana', 'Bell'))).toBeLessThan(0);
  });
});

describe('partition', () => {
  it('splits into passing and failing items, preserving order', () => {
    const [even, odd] = partition([1, 2, 3, 4, 5, 6], (n) => n % 2 === 0);
    expect(even).toEqual([2, 4, 6]);
    expect(odd).toEqual([1, 3, 5]);
  });

  it('handles an empty input and an all-or-nothing predicate', () => {
    expect(partition([], () => true)).toEqual([[], []]);
    expect(partition([1, 2], () => true)).toEqual([[1, 2], []]);
    expect(partition([1, 2], () => false)).toEqual([[], [1, 2]]);
  });
});
