/**
 * The kiosk's search, pure and synchronous.
 *
 * Runs in the keystroke handler with no debounce: a few hundred students
 * through the shared matcher is a millisecond or two even on the weak hardware
 * this targets, and debounce would only add the latency it pretends to remove.
 *
 * One buffer, two modes, inferred rather than toggled: digits mean the phone
 * index, letters mean names. That is what lets the keyboard be a single static
 * layout with no ABC/123 swap to load or unload.
 */
import { isPhoneQuery } from '@/lib/phoneDigits';
import { createSearchMatcher, sortByName } from '@/lib/utils';

/** The one row shape everything on the kiosk renders. */
export interface KioskStudent {
  id: string;
  firstName: string;
  lastName: string;
  /** Null when nobody holds a real grade — never show a clamp as a fact. */
  grade: number | null;
  searchName: string;
  /**
   * *That* there is an allergy on file, never what it is — the same split the
   * rest of Tally makes, for the same reason. See `PcoRosterPerson`.
   *
   * Carried here so the kiosk can tell the two cases apart without asking
   * anybody: a child with no allergy costs no request and no note, and a child
   * with one whose note could not be read still gets a label that says so
   * rather than a label that quietly says nothing. Nothing on a kiosk screen
   * renders this — a lobby does not need a badge — it exists for the label.
   */
  hasAllergies: boolean;
}

export const MAX_RESULTS = 8;
export const PHONE_QUERY_LENGTH = 4;

export type KioskSearchMode =
  /** Nothing typed yet. */
  | 'idle'
  /** Digits, but fewer than four — keep typing. */
  | 'phone-partial'
  /** Exactly four digits, answered from the phone index. */
  | 'phone'
  /** Letters — a name search. */
  | 'name';

export interface KioskSearchOutcome {
  mode: KioskSearchMode;
  results: KioskStudent[];
  /**
   * How many children the search actually matched, before `MAX_RESULTS` cut
   * the list down.
   *
   * The screen counts the names it is showing a parent, and until this existed
   * it counted them off `results` — which is the sliced array, so a search that
   * matched twenty-three reported "8 names". A complete-looking number for a
   * list that is not complete is worse than no number: a parent scrolls all
   * eight, finds nobody theirs, and the doors left to them include the one that
   * registers a child the church already has.
   *
   * Absent means "the same as `results.length`" — the two states that return no
   * rows at all have nothing to have truncated.
   */
  total?: number;
}

export function searchStudents(
  query: string,
  students: readonly KioskStudent[],
  last4Index: Readonly<Record<string, string[]>>,
): KioskSearchOutcome {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { mode: 'idle', results: [] };

  if (isPhoneQuery(trimmed)) {
    if (trimmed.length < PHONE_QUERY_LENGTH) return { mode: 'phone-partial', results: [] };

    // The input layer caps the buffer at four digits, so longer never happens;
    // answering the first four anyway keeps this total rather than throwing.
    const ids = new Set(last4Index[trimmed.slice(0, PHONE_QUERY_LENGTH)] ?? []);
    const results = students.filter((student) => ids.has(student.id)).sort(sortByName);
    return { mode: 'phone', results: results.slice(0, MAX_RESULTS), total: results.length };
  }

  const matcher = createSearchMatcher(trimmed);
  const results = students
    .filter((student) => matcher.matches(student.searchName))
    .sort((a, b) => matcher.rank(a) - matcher.rank(b) || sortByName(a, b));
  return { mode: 'name', results: results.slice(0, MAX_RESULTS), total: results.length };
}
