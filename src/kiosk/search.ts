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
    return { mode: 'phone', results: results.slice(0, MAX_RESULTS) };
  }

  const matcher = createSearchMatcher(trimmed);
  const results = students
    .filter((student) => matcher.matches(student.searchName))
    .sort((a, b) => matcher.rank(a) - matcher.rank(b) || sortByName(a, b));
  return { mode: 'name', results: results.slice(0, MAX_RESULTS) };
}
