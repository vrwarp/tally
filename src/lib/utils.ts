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

/**
 * Case- and diacritic-insensitive substring match used by the roster search
 * fallback.
 *
 * Substring rather than prefix matching, because a counselor at the door types
 * whatever they heard: "ma" has to find both "Marcus Lee" and "Ana Martinez",
 * and "lee" has to find "Marcus Lee" without them typing the first name.
 */
export function matchesQuery(searchName: string, query: string): boolean {
  const needle = normalizeForSearch(query);
  if (!needle) return true;
  return normalizeForSearch(searchName).includes(needle);
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
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
