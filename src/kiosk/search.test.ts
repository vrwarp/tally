/**
 * The kiosk's one search box: digits mean the phone index, letters mean
 * names, and the mode is inferred so the keyboard never swaps layouts.
 */
import { describe, expect, it } from 'vitest';
import { MAX_RESULTS, searchStudents, type KioskStudent } from '@/kiosk/search';

function student(id: string, firstName: string, lastName: string, grade: number | null = 9): KioskStudent {
  return {
    id,
    firstName,
    lastName,
    grade,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
    hasAllergies: false,
  };
}

const ROSTER: KioskStudent[] = [
  student('s-maya', 'Maya', 'Chen'),
  student('s-marcus', 'Marcus', 'Osei'),
  student('s-amara', 'Amara', 'Osei'),
  student('s-jordan', 'Jordan', 'Reyes'),
  student('s-visitor', 'Sam', 'Visitor', null),
];

const LAST4 = {
  '0134': ['s-maya', 's-marcus'],
  '9999': ['s-jordan'],
};

describe('searchStudents', () => {
  it('is idle on an empty buffer', () => {
    expect(searchStudents('', ROSTER, LAST4)).toEqual({ mode: 'idle', results: [] });
    expect(searchStudents('   ', ROSTER, LAST4)).toEqual({ mode: 'idle', results: [] });
  });

  it('withholds phone results until all four digits are typed', () => {
    expect(searchStudents('013', ROSTER, LAST4)).toEqual({ mode: 'phone-partial', results: [] });
  });

  it('answers four digits from the index — the whole household, sorted by name', () => {
    const outcome = searchStudents('0134', ROSTER, LAST4);
    expect(outcome.mode).toBe('phone');
    expect(outcome.results.map((s) => s.id)).toEqual(['s-marcus', 's-maya']);
  });

  it('answers unknown digits with an empty phone result, not a name search', () => {
    expect(searchStudents('7777', ROSTER, LAST4)).toEqual({ mode: 'phone', results: [], total: 0 });
  });

  it('searches names for anything with a letter in it', () => {
    const outcome = searchStudents('ose', ROSTER, LAST4);
    expect(outcome.mode).toBe('name');
    expect(outcome.results.map((s) => s.id)).toEqual(['s-amara', 's-marcus']);
  });

  it('ranks a given-name prefix above a surname containing the query', () => {
    const outcome = searchStudents('ma', ROSTER, LAST4);
    // Marcus and Maya lead (given-name prefix, A-Z inside the band); Amara
    // only contains "ma".
    expect(outcome.results.map((s) => s.id)).toEqual(['s-marcus', 's-maya', 's-amara']);
  });

  it('tolerates a typo the way the main roster does', () => {
    const outcome = searchStudents('jorden', ROSTER, LAST4);
    expect(outcome.results.map((s) => s.id)).toContain('s-jordan');
  });

  it('caps the list at what fits without scrolling', () => {
    const many = Array.from({ length: 30 }, (_, i) => student(`s-${i}`, `Aaa${i}`, 'Zed'));
    const outcome = searchStudents('aaa', many, {});
    expect(outcome.results).toHaveLength(MAX_RESULTS);
  });

  /*
   * The count the kiosk shows a parent is drawn from `total`, and it has to be
   * what the search found rather than what survived the cap. Read off the
   * sliced array, a search matching thirty reported "8 names" — a
   * complete-looking number for a list that is not complete, which leaves a
   * parent who has scrolled all eight believing their child is not here.
   */
  it('reports what it matched, not what it kept', () => {
    const many = Array.from({ length: 30 }, (_, i) => student(`s-${i}`, `Aaa${i}`, 'Zed'));
    expect(searchStudents('aaa', many, {}).total).toBe(30);
  });

  it('reports a total the list did not have to truncate', () => {
    const outcome = searchStudents('osei', ROSTER, LAST4);
    expect(outcome.total).toBe(outcome.results.length);
  });
});
