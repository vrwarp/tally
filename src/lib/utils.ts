import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PRE_K } from '@/types';

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
 * 5. The pinyin ü — "Lu", "Lv" and "Lyu" are one surname spelled three legal
 *    ways, and they find each other (see `UMLAUT_VOWELS`).
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

/*
 * The pinyin ü, which is three legal spellings of one surname.
 *
 * Mandarin distinguishes u from ü, but a passport may not: since 2012 China's
 * exit-and-entry offices print 吕 as LYU, before that some printed LU and others
 * LV, and a Chinese keyboard types it as `lv` because that is the key the input
 * method uses for ü. All four reach Tally, because a name gets into Planning
 * Center from a passport, a parent's form and a sibling's older record, and
 * those three do not agree. Same story for nü — 女 — as NU, NV and NYU.
 *
 * The umlaut itself needs nothing: `normalizeForSearch` already folds "Lü" and
 * "Lǚ" onto "lu". What survives it are the *letters* — `lyu` and `lv` — and
 * they are what breaks. A counselor typing a whole name got away with it by
 * accident, because "luchen" is one edit from "lyuchen" and the typo budget
 * covered it. Typing the surname alone did not: "lu" is two characters, its
 * budget is zero, and Lyu Chen was simply not on the list. "nv" found nobody at
 * all — not Nu Wang, not Nyu Wang.
 *
 * So `l` and `n` before this vowel are interchangeable. The trailing letters are
 * untouched, which covers lüe and nüe (`lue`/`lve`/`lyue`) without a second
 * table. J, Q, X and Y are deliberately absent: they never pair with a plain u,
 * so `ju` can only ever have meant jü and there is nothing to disambiguate.
 */
const UMLAUT_ONSET = /^([ln])(yu|[uv])/;
const UMLAUT_VOWELS = ['u', 'v', 'yu'];
/**
 * Two ambiguous words in one query is already a stretch; the cap is here so a
 * pathological query cannot make the roster pass exponential.
 */
const MAX_UMLAUT_VARIANTS = 8;

/**
 * The same query spelled every other legal way, compacted and ready to match.
 * Empty — the overwhelmingly common case — when nothing in the query is a
 * ü-syllable, and the whole variant pass then costs nothing.
 */
function umlautVariants(normalized: string): string[] {
  const words = normalized.split(' ');
  // Word-initial only: the ambiguity is an onset. "Alvarez" contains `lv` and
  // is not a spelling of anybody's Lü.
  let forms: string[][] = [words];
  for (let index = 0; index < words.length; index += 1) {
    const found = UMLAUT_ONSET.exec(words[index]!);
    if (!found) continue;
    const rest = words[index]!.slice(found[0].length);
    const alternates = UMLAUT_VOWELS.filter((vowel) => vowel !== found[2]).map(
      (vowel) => `${found[1]}${vowel}${rest}`,
    );
    forms = forms.concat(
      forms.flatMap((form) =>
        alternates.map((alternate) => form.map((word, at) => (at === index ? alternate : word))),
      ),
    );
    if (forms.length > MAX_UMLAUT_VARIANTS) break;
  }
  // `forms[0]` is the query as typed, which the caller already has.
  return forms.slice(1).map((form) => compact(form.join(' ')));
}

/**
 * Where each word of `normalized` begins once the spaces are taken out.
 *
 * Variants match at a word start and nowhere else, but matching happens on the
 * gapless form so that "lyuchen" still finds "Lyu Chen". Carrying the offsets is
 * how both hold at once.
 */
function wordStarts(normalized: string): number[] {
  const starts: number[] = [];
  let offset = 0;
  let pending = true;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === ' ') {
      pending = true;
      continue;
    }
    if (pending) {
      starts.push(offset);
      pending = false;
    }
    offset += 1;
  }
  return starts;
}

export interface SearchMatcher {
  /** True when the query has no searchable characters, so everything matches. */
  readonly isEmpty: boolean;
  matches(searchName: string): boolean;
  /**
   * How well a name matches, for ordering results. Lower is better; `matches`
   * decides membership and this decides position. See {@link MatchRank}.
   */
  rank(student: { firstName: string; lastName: string; searchName: string }): number;
}

/**
 * Why a result is in the list, which is also the order a counselor expects it.
 *
 * Typing "ma" because Maya is at the front of the queue returned Aisha Rahman,
 * Amara Osei, Chloe Bergman, Fatima Nasser and Hana Yamamoto first — five names
 * that contain "ma" somewhere inside a surname — and put Maya eighth, half of
 * her below the fold. Every one of those is a legitimate match, so the fix is
 * not to match less; it is to rank, and to keep A-Z inside each band so the
 * list is still predictable.
 */
const MatchRank = {
  givenNamePrefix: 0,
  lastNamePrefix: 1,
  contained: 2,
  /** Only the typo pass could place it, so it goes last. */
  approximate: 3,
} as const;

/**
 * A band, spelled exactly, then the same band reached through a ü variant.
 *
 * Typing "lu" should still put Lu Chen above Lyu Chen — one of them is what was
 * typed — but both belong above everybody whose surname merely contains "lu".
 * Interleaving beats a flat penalty: it keeps *why* a row matched as the primary
 * key and demotes only within that reason.
 */
function rankOf(band: number, viaVariant: boolean): number {
  return band * 2 + (viaVariant ? 1 : 0);
}

const MATCH_EVERYTHING: SearchMatcher = {
  isEmpty: true,
  matches: () => true,
  rank: () => rankOf(MatchRank.givenNamePrefix, false),
};

/** Which of the four reasons placed this student, for one spelling of the query. */
function bandFor(
  student: { firstName: string; lastName: string; searchName: string },
  needle: string,
): number {
  if (compact(normalizeForSearch(student.firstName)).startsWith(needle)) {
    return MatchRank.givenNamePrefix;
  }
  if (compact(normalizeForSearch(student.lastName)).startsWith(needle)) {
    return MatchRank.lastNamePrefix;
  }
  if (compact(normalizeForSearch(student.searchName)).includes(needle)) {
    return MatchRank.contained;
  }
  return MatchRank.approximate;
}

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
  const variants = umlautVariants(normalizeForSearch(query));

  return {
    isEmpty: false,
    matches(searchName: string): boolean {
      const normalized = normalizeForSearch(searchName);
      const haystack = compact(normalized);
      if (haystack.includes(needle)) return true;
      // A variant is a different spelling, not a different name, so it is
      // checked before the typo pass and is not charged against its budget.
      if (variants.length > 0) {
        const starts = wordStarts(normalized);
        for (const variant of variants) {
          for (const start of starts) {
            if (haystack.startsWith(variant, start)) return true;
          }
        }
      }
      if (budget === 0 || haystack.length > FUZZY_MAX_LENGTH) return false;
      return approximatelyIncludes(haystack, needle, budget);
    },
    rank(student): number {
      const band = bandFor(student, needle);
      if (band !== MatchRank.approximate) return rankOf(band, false);
      for (const variant of variants) {
        const alternate = bandFor(student, variant);
        if (alternate !== MatchRank.approximate) return rankOf(alternate, true);
      }
      return rankOf(MatchRank.approximate, false);
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

/**
 * The short token for a grade: `Pre-K`, `K`, `1st`, `9th`.
 *
 * The two grades below 1st have names rather than numbers, and `ordinalGrade`
 * would print "0th" and "-1th" for them — the second of which is not a
 * hypothetical: it reached a lobby screen. Everything below Pre-K has no grade
 * at all and never reaches here — see `Grade`.
 *
 * "Pre-K" rather than "PK", because that is what Planning Center calls it on
 * the profile these children arrive from — so it is the name already on the
 * screen the office is looking at while a volunteer reads the label.
 */
export function gradeName(grade: number): string {
  if (grade === PRE_K) return 'Pre-K';
  return grade === 0 ? 'K' : ordinalGrade(grade);
}

/**
 * The same thing with its noun, for the places that read "9th grade".
 *
 * Kindergarten needs the whole word: "K grade" is not English, and a screen
 * reader saying it beside a child's name is worse. Pre-K is the same — it is
 * already the name of the year, so "Pre-K grade" only adds a stumble.
 */
export function gradeDescription(grade: number): string {
  if (grade === PRE_K) return 'Pre-K';
  return grade === 0 ? 'Kindergarten' : `${ordinalGrade(grade)} grade`;
}

/** What a grade slot says when there is no grade to put in it. */
export const NO_GRADE = 'No grade';

/**
 * The ordinal to print for somebody's grade, or null when nobody has one.
 *
 * A null grade is every adult on a hand-picked roster — the leaders and
 * volunteers a list-mode roster deliberately carries — and every child too
 * young to have one. It used to be spelled as a number plus a `gradeOnFile`
 * flag, and the flag was routinely wrong: the sync set it from whether the
 * upstream value was *blank*, not whether it had been clamped, so a real 3rd
 * grader was printed as a 6th grader as a fact about them.
 *
 * Callers with a slot to fill fall back to `NO_GRADE`; callers where the grade
 * is one clause of a longer line drop the clause instead, because "No grade ·"
 * spends the width that line needs on the thing it is least about.
 */
export function gradeLabel(student: { grade: number | null }): string | null {
  return student.grade === null ? null : gradeName(student.grade);
}

/**
 * The same, with its noun — for aria labels and any line that reads "9th
 * grade". Kindergarten becomes "Kindergarten" rather than "K grade".
 */
export function gradeSentence(student: { grade: number | null }): string | null {
  return student.grade === null ? null : gradeDescription(student.grade);
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

/**
 * What a phone field should hold after a keystroke: digits, grouped XXX-XXX-XXXX.
 *
 * Formatting as the number is typed rather than on blur is what makes the field
 * refuse letters visibly — a stray character never lands, so there is nothing to
 * correct later and nothing for the server to reject after a round trip.
 *
 * A leading `1` is a country code, not the first digit of an area code, so the
 * eleventh digit drops it: pasting `+1 (555) 010-0123` and typing `15550100123`
 * both settle on `555-010-0123`. Past that the number is US-shaped by
 * construction — ten digits, and extra ones are ignored rather than appended,
 * because there is no grouping this could give them that would be right.
 */
export function formatPhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('1')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * One ordering key for every list of students in the app: given name first.
 *
 * It used to be surname-first here and given-name-first in the student
 * directory (which orders on `searchName`), while every row in both printed
 * "Given Surname" in a single weight. So neither list could be scanned by its
 * own key: a counselor with Marcus in front of them read down the leading word
 * of a surname-sorted column — Maya, Andre, Chloe, Ruby, Marcus — and found no
 * order at all, then either thumbed all twenty-four rows or fell back to
 * typing, which is the escape hatch rather than the path.
 *
 * Given name won because it is the token both lists already print first, it is
 * how a counselor holds a student in mind, and adopting it re-sorted only one
 * of the two lists. `StudentRow` sets the surname a step back so the scan has
 * something to land on.
 */
export function sortByName<T extends { lastName: string; firstName: string }>(a: T, b: T): number {
  return (
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' }) ||
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' })
  );
}

/**
 * Whether two arrays hold the very same items in the same order.
 *
 * This is what lets a memo hand back its previous array instead of a fresh one
 * that says exactly the same thing. Several derivations in Tally are keyed on a
 * ticking clock, and almost every tick selects the same objects — but a `.filter`
 * or `.sort` mints a new array anyway, and everything downstream treats the new
 * identity as news. Identity comparison is enough because the inputs being
 * selected from are themselves identity-stable (see `DataProvider`'s calendar):
 * an item that genuinely changed arrives as a new object and fails this check.
 */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** Splits an array into the items that pass a predicate and those that do not. */
export function partition<T>(items: readonly T[], predicate: (item: T) => boolean): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const item of items) (predicate(item) ? pass : fail).push(item);
  return [pass, fail];
}

/** "Friday", "Friday and Sunday", "Friday, Sunday and Wednesday" — for prose. */
export function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
