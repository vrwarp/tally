/**
 * Properties of the small helpers.
 *
 * `matchesQuery` runs on every keystroke against the whole roster, so it has to
 * be total: any string, any query, no throw. `sortByName` is handed to
 * `Array.prototype.sort`, which is entitled to garbage output if the comparator
 * is inconsistent.
 */
import { describe, expect } from 'vitest';
import { forAll } from '../../tests/fuzz/property';
import { arbitraryString } from '../../tests/fuzz/arbitrary';
import type { Rng } from '../../tests/fuzz/prng';
import { formatPhone, initials, matchesQuery, normalizeForSearch, ordinalGrade, partition, sortByName } from './utils';

const pair = (rng: Rng) => ({ haystack: arbitraryString(rng), needle: arbitraryString(rng) });

describe('utility properties', () => {
  forAll('matchesQuery never throws', pair, ({ haystack, needle }) => {
    expect(() => matchesQuery(haystack, needle)).not.toThrow();
    expect(typeof matchesQuery(haystack, needle)).toBe('boolean');
  });

  forAll('a name always matches itself', (rng) => arbitraryString(rng), (name) => {
    // Otherwise a counselor who types a student's full name gets nothing back.
    if (normalizeForSearch(name).length === 0) return;
    expect(matchesQuery(name, name)).toBe(true);
  });

  forAll('an empty or blank query matches everyone', (rng) => ({
    name: arbitraryString(rng),
    blank: rng.pick(['', ' ', '\t', '   \n ']),
  }), ({ name, blank }) => {
    expect(matchesQuery(name, blank)).toBe(true);
  });

  forAll('any substring of a name finds it', (rng) => {
    const name = arbitraryString(rng);
    const normalized = normalizeForSearch(name);
    if (normalized.length < 2) return { name, fragment: null };
    const start = rng.int(0, normalized.length - 2);
    return { name, fragment: normalized.slice(start, start + rng.int(1, 3)) };
  }, ({ name, fragment }) => {
    if (fragment === null || fragment.trim().length === 0) return;
    expect(matchesQuery(name, fragment)).toBe(true);
  });

  forAll('search ignores case and accents', (rng) => arbitraryString(rng), (name) => {
    const normalized = normalizeForSearch(name);
    if (normalized.length === 0) return;
    // "Jose" has to find "José": a counselor is not going to type the accent.
    expect(matchesQuery(name, normalized.toUpperCase())).toBe(true);
  });

  const SEPARATORS = ["'", '’', '-', '.', ' ', ',', '_'];

  forAll('punctuation typed into the query never hides the name', (rng) => {
    const name = arbitraryString(rng);
    const normalized = normalizeForSearch(name);
    return { name, normalized, separator: rng.pick(SEPARATORS), at: rng.int(0, 40) };
  }, ({ name, normalized, separator, at }) => {
    if (normalized.length === 0) return;
    // Nobody agrees where the hyphen goes in a name, so a query must survive
    // one appearing anywhere in it.
    const index = at % (normalized.length + 1);
    const punctuated = normalized.slice(0, index) + separator + normalized.slice(index);
    expect(matchesQuery(name, punctuated)).toBe(true);
  });

  forAll('one typo still finds a name, once the query is long enough', (rng) => {
    const name = arbitraryString(rng);
    const compact = normalizeForSearch(name).replace(/ /g, '');
    return { name, compact, at: rng.int(0, 200) };
  }, ({ name, compact, at }) => {
    // Astral characters are two code units, so swapping one costs two edits
    // rather than one; the guarantee below is about a single mistyped letter.
    if (compact.length !== Array.from(compact).length) return;
    // Absurdly long strings skip the typo pass entirely — see FUZZY_MAX_LENGTH.
    if (compact.length < 4 || compact.length > 64) return;

    const index = at % compact.length;
    const replacement = compact[index] === 'q' ? 'x' : 'q';
    const typo = compact.slice(0, index) + replacement + compact.slice(index + 1);
    expect(matchesQuery(name, typo)).toBe(true);
  });

  forAll('a one-character query is never fuzzy', (rng) => ({
    name: arbitraryString(rng),
    letter: rng.pick(['q', 'x', 'z', 'j']),
  }), ({ name, letter }) => {
    // Typo tolerance must not leak down to the first keystroke, or the list
    // stops narrowing at all.
    expect(matchesQuery(name, letter)).toBe(normalizeForSearch(name).includes(letter));
  });

  forAll('ordinalGrade always produces a label', (rng) => rng.int(-5, 30), (grade) => {
    const label = ordinalGrade(grade);
    expect(typeof label).toBe('string');
    expect(label).toContain(String(grade));
  });

  forAll('initials never throw and never exceed two characters', pair, ({ haystack, needle }) => {
    const result = initials(haystack, needle);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  forAll('formatPhone is total and never loses a number entirely', (rng) =>
    rng.bool(0.5)
      ? Array.from({ length: rng.int(0, 15) }, () => String(rng.int(0, 9))).join('')
      : arbitraryString(rng),
  (raw) => {
    const formatted = formatPhone(raw);
    expect(typeof formatted).toBe('string');
    if (raw.replace(/\D/g, '').length > 0) expect(formatted.length).toBeGreaterThan(0);
  });

  /**
   * `Array.prototype.sort` is allowed to produce nonsense if the comparator is
   * inconsistent, so the comparator itself is what needs checking.
   */
  forAll('sortByName is a consistent comparator', (rng) => ({
    a: { firstName: arbitraryString(rng), lastName: arbitraryString(rng) },
    b: { firstName: arbitraryString(rng), lastName: arbitraryString(rng) },
    c: { firstName: arbitraryString(rng), lastName: arbitraryString(rng) },
  }), ({ a, b, c }) => {
    const ab = Math.sign(sortByName(a, b));
    const ba = Math.sign(sortByName(b, a));
    expect(ab).toBe(-ba); // antisymmetric

    const bc = Math.sign(sortByName(b, c));
    const ac = Math.sign(sortByName(a, c));
    if (ab < 0 && bc < 0) expect(ac).toBeLessThan(0); // transitive
    if (ab === 0 && bc === 0) expect(ac).toBe(0);
  });

  forAll('partition keeps every item exactly once', (rng) =>
    Array.from({ length: rng.int(0, 20) }, () => rng.int(0, 100)),
  (items) => {
    const [pass, fail] = partition(items, (value) => value % 2 === 0);

    expect(pass.length + fail.length).toBe(items.length);
    expect([...pass, ...fail].sort((x, y) => x - y)).toEqual([...items].sort((x, y) => x - y));
    for (const value of pass) expect(value % 2).toBe(0);
    for (const value of fail) expect(value % 2).not.toBe(0);
  });
});
