import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware class name join. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Short confirmation buzz on check-in (Journey 1 asks for a haptic pulse).
 * Silently no-ops on iOS Safari and anywhere the Vibration API is absent.
 */
export function haptic(pattern: number | number[] = 12): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  try {
    nav.vibrate?.(pattern);
  } catch {
    /* Vibration is a nicety, never a failure path. */
  }
}

/* -------------------------------------------------------------------------- */
/* Roster search                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Name matching for the roster search bar.
 *
 * A counselor at the door is typing a name they just heard, on a phone
 * keyboard, at a student who is already walking past. Four things are forgiven,
 * cheapest check first:
 *
 * 1. Case and accents — "jose" finds "José García", and so does "José".
 * 2. Position — substring, not prefix: "ma" finds both "Marcus Lee" and
 *    "Ana Martinez", and "lee" finds "Marcus Lee" without the first name.
 * 3. Punctuation and spacing — nobody agrees how a name is punctuated between
 *    Planning Center, a parent's handwriting and a phone keyboard, so "obrien"
 *    finds "O'Brien", "mary jane" finds "Mary-Jane", and "delacruz" finds
 *    "de la Cruz".
 * 4. Typos — "Marcs" and "Mracus" both find "Marcus Lee", but only once the
 *    query is long enough for a typo to still mean one person (see
 *    `editBudget`).
 */

/** Combining marks left over from NFD: "é" -> "e" + U+0301 -> "e". */
const COMBINING_MARKS = /[̀-ͯ]/g;
/**
 * Apostrophes close up instead of splitting, so "O'Brien" and "obrien" reach
 * the same string. Covers the curly ones a phone keyboard substitutes silently.
 */
const APOSTROPHES = /['‘’ʼ`´]/g;
/**
 * Everything that is not a letter, digit or script mark is a word gap.
 * `\p{M}` is kept because in scripts other than Latin the marks are part of the
 * letter, not decoration on top of it — dropping them would shred the name.
 */
const SEPARATORS = /[^\p{L}\p{N}\p{M}]+/gu;

/**
 * Canonical comparison form: lowercase, unaccented, single-spaced words.
 * Idempotent, so it is safe to run over an already-normalized string.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(SEPARATORS, ' ')
    .trim();
}

/**
 * Word gaps are advisory. Matching happens on the gapless form so that a query
 * never has to guess whether a name is "Mary Jane", "Mary-Jane" or "MaryJane" —
 * and so that a missing space is not itself a typo the search has to spend a
 * character of its budget on.
 */
function compact(normalized: string): string {
  return normalized.replace(/ /g, '');
}

/**
 * How many typos to forgive, by query length.
 *
 * Short queries stay strict on purpose: at three characters a single edit
 * reaches a large share of any roster, which reads as a search that has stopped
 * working rather than one being helpful. "z" has to keep meaning the letter z.
 */
function editBudget(length: number): number {
  if (length < 4) return 0;
  if (length < 7) return 1;
  return 2;
}

/**
 * Beyond this, skip the typo pass. Names are short; the guard is here because
 * the search filters untrusted Firestore documents, where a "name" can be ten
 * thousand characters and the quadratic pass below would be felt.
 */
const FUZZY_MAX_LENGTH = 64;

export interface SearchMatcher {
  /** True when the query has no searchable characters, so everything matches. */
  readonly isEmpty: boolean;
  matches(searchName: string): boolean;
}

const MATCH_EVERYTHING: SearchMatcher = { isEmpty: true, matches: () => true };

/**
 * Builds a reusable predicate for one query.
 *
 * This is the form the roster should use: the query-side normalization and the
 * edit budget are computed once, not once per student per keystroke. There is
 * no debounce anywhere above it, so this pass runs against the whole roster on
 * every character typed.
 */
export function createSearchMatcher(query: string): SearchMatcher {
  const needle = compact(normalizeForSearch(query));
  if (!needle) return MATCH_EVERYTHING;

  const budget = needle.length <= FUZZY_MAX_LENGTH ? editBudget(needle.length) : 0;

  return {
    isEmpty: false,
    matches(searchName: string): boolean {
      const haystack = compact(normalizeForSearch(searchName));
      if (haystack.includes(needle)) return true;
      if (budget === 0 || haystack.length > FUZZY_MAX_LENGTH) return false;
      return approximatelyIncludes(haystack, needle, budget);
    },
  };
}

/** One-shot form of {@link createSearchMatcher}, for a single comparison. */
export function matchesQuery(searchName: string, query: string): boolean {
  return createSearchMatcher(query).matches(searchName);
}

/**
 * Is `needle` within `budget` edits of *some window* of `text`?
 *
 * Damerau-Levenshtein, with two adjustments for this being a substring search
 * rather than a whole-string comparison:
 *
 * - Row zero stays at zero, so the needle may start at any offset in the text
 *   for free. Typing "marcs" should not be charged for the "lee" it never got
 *   to, nor for the four names ahead of it in a full roster string.
 * - The answer is the smallest value in the final row — the best window wins.
 *
 * Adjacent transpositions cost one edit rather than two, because swapping two
 * letters ("Mracus") is how a name gets mistyped at speed.
 */
function approximatelyIncludes(text: string, needle: string, budget: number): boolean {
  const m = needle.length;
  const n = text.length;
  // Even a perfect alignment has to account for the length difference.
  if (m - budget > n) return false;

  // Three rolling rows: the transposition rule reaches two rows back.
  let twoBack = new Uint16Array(n + 1);
  let prev = new Uint16Array(n + 1); // row 0, all zeroes: free start offset.
  let row = new Uint16Array(n + 1);

  for (let i = 1; i <= m; i += 1) {
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const same = needle[i - 1] === text[j - 1];
      let cost = prev[j - 1]! + (same ? 0 : 1); // substitute (or free match)
      const deletion = prev[j]! + 1;
      if (deletion < cost) cost = deletion;
      const insertion = row[j - 1]! + 1;
      if (insertion < cost) cost = insertion;
      if (i > 1 && j > 1 && needle[i - 1] === text[j - 2] && needle[i - 2] === text[j - 1]) {
        const transposition = twoBack[j - 2]! + 1;
        if (transposition < cost) cost = transposition;
      }
      row[j] = cost;
    }
    // Rotate: this row becomes `prev`, and the row before it becomes `twoBack`.
    const recycled = twoBack;
    twoBack = prev;
    prev = row;
    row = recycled;
  }

  // `prev` is the final row after the last rotation.
  for (let j = 0; j <= n; j += 1) {
    if (prev[j]! <= budget) return true;
  }
  return false;
}

/** `6` -> `6th`, `11` -> `11th`. */
export function ordinalGrade(grade: number): string {
  const suffix =
    grade % 100 >= 11 && grade % 100 <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][grade % 10] ?? 'th');
  return `${grade}${suffix}`;
}

/** Stable "AB" avatar initials. */
export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** Formats US-ish phone numbers for display, passing anything else through. */
export function formatPhone(raw: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

export function sortByName<T extends { lastName: string; firstName: string }>(a: T, b: T): number {
  return (
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
  );
}

/** Splits an array into the items that pass a predicate and those that do not. */
export function partition<T>(items: readonly T[], predicate: (item: T) => boolean): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const item of items) (predicate(item) ? pass : fail).push(item);
  return [pass, fail];
}
