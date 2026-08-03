/**
 * What a roster row says about a birthday.
 *
 * Two different jobs, which is why this is a five-state answer rather than a
 * date:
 *
 *  - Cake. A youth ministry finds out somebody turned fifteen when the student
 *    mentions it three weeks later. The window is deliberately a fortnight wide
 *    and symmetric, because "we missed it on Tuesday" is a thing a leader can
 *    still act on and a birthday nobody said anything about is the failure this
 *    is here to prevent.
 *  - The blank. A student with no birthdate on file is not a student with no
 *    birthday; it is a profile somebody has not finished, and it is invisible
 *    until a list says so.
 *
 * Everything *read* here works on `MM-DD` — the day of the year, never the year.
 * See `PcoRosterPerson.birthday` for why a browser holding the whole roster is
 * not given ages. `composeBirthday` is the one exception and only in the other
 * direction: a leader filling in a blank birthday can type the year, which goes
 * upstream and is never sent back.
 */
import { differenceInCalendarDays, format } from 'date-fns';

export type BirthdayState =
  /** Today. */
  | 'today'
  /** Within the coming week. */
  | 'soon'
  /** Within the past week. */
  | 'recent'
  /** On file, and not near today. Nothing to say. */
  | 'quiet'
  /** Planning Center holds no birthdate at all. */
  | 'missing';

/** How wide "soon" and "recently" reach, in days, either side of today. */
export const BIRTHDAY_WINDOW_DAYS = 7;

const PATTERN = /^(\d{2})-(\d{2})$/;
const DATED_PATTERN = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/;

export interface MonthDay {
  month: number;
  day: number;
}

export interface DatedBirthday extends MonthDay {
  /** Null for a roster row's `MM-DD`, and for a year nobody upstream knows. */
  year: number | null;
}

/**
 * A birthday as it was handed over, in numbers — `MM-DD` from the roster, or
 * the `YYYY-MM-DD` the one-person details read carries. Null when there is
 * none, or when the string is not one.
 *
 * Both shapes rather than the roster's alone, because the year is not a
 * different field: it is the same date, known to a screen that asked for one
 * student. Everything that only wants the day goes on calling `birthdayParts`
 * and cannot accidentally print a year it did not ask for.
 */
export function parseBirthday(birthday: string | null | undefined): DatedBirthday | null {
  if (!birthday) return null;

  const match = DATED_PATTERN.exec(birthday);
  if (!match) return null;

  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { month, day, year: match[1] === undefined ? null : Number(match[1]) };
}

/**
 * The two numbers out of an `MM-DD`, or null when there is no birthday on file
 * or the string is not one.
 *
 * Strict about the shape, and deliberately still so: this is what reads a
 * *roster* row, a roster row never carries a year, and a value that has one did
 * not come from where this thinks it did. Anything holding the fuller date —
 * the profile, the edit box — asks `parseBirthday` instead, which is the reader
 * that knows what a year means.
 */
export function birthdayParts(birthday: string | null | undefined): MonthDay | null {
  if (!birthday) return null;

  const match = PATTERN.exec(birthday);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { month, day };
}

/** The year on file, or null when nobody upstream holds one. */
export function birthdayYear(birthday: string | null | undefined): number | null {
  return parseBirthday(birthday)?.year ?? null;
}

/** Days in each month, taking February at its leap-year length. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The earliest year of birth Tally will send upstream. */
export const EARLIEST_BIRTH_YEAR = 1900;

/**
 * Whether a day somebody typed is a day that exists.
 *
 * A month and a day alone are checked against the *longest* February, because
 * 29 February is a birthday people have and the year is optional here — see
 * `composeBirthday`. Given a year, the same date is checked against that year's
 * real February, so "29 February 2011" is refused rather than written upstream
 * and silently moved to 1 March.
 *
 * Must stay in step with `isRealBirthday` in functions/src/pco/profile.ts.
 */
export function isRealBirthday(month: number, day: number, year?: number | null): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;

  if (year === undefined || year === null) return day <= DAYS_IN_MONTH[month - 1];

  if (!Number.isInteger(year) || year < EARLIEST_BIRTH_YEAR) return false;
  const limit = month === 2 && !isLeapYear(year) ? 28 : DAYS_IN_MONTH[month - 1];
  return day <= limit;
}

/**
 * The wire form of an edited birthday: `MM-DD`, or `YYYY-MM-DD` when a year was
 * given. Null when the date does not exist.
 *
 * Two shapes rather than one because Tally is never told the year — see
 * `PcoRosterPerson.birthday`. A leader correcting the day on a birthday already
 * on file cannot retype a year they have not been shown, so the year is optional
 * and the server keeps whatever Planning Center holds when it is left out.
 *
 * Must stay in step with `parseBirthdayPatch` in functions/src/pco/profile.ts.
 */
export function composeBirthday(parts: {
  month: number;
  day: number;
  year?: number | null;
}): string | null {
  const { month, day, year } = parts;
  if (!isRealBirthday(month, day, year)) return null;

  const pad = (value: number) => String(value).padStart(2, '0');
  const monthDay = `${pad(month)}-${pad(day)}`;
  return year === undefined || year === null ? monthDay : `${year}-${monthDay}`;
}

/**
 * The occurrence of this birthday nearest to `now`, in local time.
 *
 * Three candidate years rather than one, because the year boundary is exactly
 * where the naive version is wrong: on 2 January, a 30 December birthday is
 * four days ago and *last* year's date, and on 29 December a 2 January birthday
 * is next year's. Both are inside the window and both would otherwise read as
 * "eleven months away".
 *
 * A 29 February birthday lands on 1 March in the three years out of four that
 * do not have one, which is what `new Date(y, 1, 29)` does on its own and is
 * also what most people do.
 */
function nearestOccurrence({ month, day }: MonthDay, now: Date): Date {
  const candidates = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(
    (year) => new Date(year, month - 1, day),
  );

  let nearest = candidates[0];
  let best = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(differenceInCalendarDays(candidate, now));
    if (distance < best) {
      best = distance;
      nearest = candidate;
    }
  }
  return nearest;
}

/**
 * Whole days from today to the nearest occurrence: negative in the past,
 * positive in the future, zero today. Null when there is no birthday on file.
 */
export function daysToBirthday(birthday: string | null | undefined, now: Date): number | null {
  const parsed = birthdayParts(birthday);
  if (!parsed) return null;
  return differenceInCalendarDays(nearestOccurrence(parsed, now), now);
}

export function birthdayState(birthday: string | null | undefined, now: Date): BirthdayState {
  const days = daysToBirthday(birthday, now);
  if (days === null) return 'missing';
  if (days === 0) return 'today';
  if (days > 0) return days <= BIRTHDAY_WINDOW_DAYS ? 'soon' : 'quiet';
  return days >= -BIRTHDAY_WINDOW_DAYS ? 'recent' : 'quiet';
}

/** "14 Mar" — the badge's own label, sized for a roster lane. */
export function formatBirthdayShort(birthday: string | null | undefined, now: Date): string | null {
  const parsed = birthdayParts(birthday);
  if (!parsed) return null;
  return format(nearestOccurrence(parsed, now), 'd MMM');
}

/**
 * "14 March" — for a sentence, where there is room to say it properly. With the
 * year, when the caller was given one: "14 March 2011".
 *
 * The year is never invented and never dropped. A roster row has none to print,
 * and the details read only carries one where Planning Center holds a real one
 * — its 1885 for "nobody knows" arrives here as a bare `MM-DD`, so an unknown
 * year cannot come out of this as a date of birth.
 */
export function formatBirthdayLong(birthday: string | null | undefined): string | null {
  const parsed = parseBirthday(birthday);
  if (!parsed) return null;
  // Any leap year, so 29 February is a real date to format rather than 1 March.
  const on = new Date(parsed.year ?? 2024, parsed.month - 1, parsed.day);
  return format(on, parsed.year === null ? 'd MMMM' : 'd MMMM yyyy');
}
