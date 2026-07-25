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

describe('normalizeForSearch', () => {
  it('strips accents, lowercases and collapses whitespace', () => {
    expect(normalizeForSearch('  José   GARCÍA ')).toBe('jose garcia');
  });
});

describe('ordinalGrade', () => {
  it('labels the grades Footprints actually serves', () => {
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
