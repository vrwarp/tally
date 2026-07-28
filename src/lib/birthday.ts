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
 * Everything here works on `MM-DD` — the day of the year, never the year. See
 * `PcoRosterPerson.birthday` for why a browser holding the whole roster is not
 * given ages.
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

interface MonthDay {
  month: number;
  day: number;
}

function parse(birthday: string | null | undefined): MonthDay | null {
  if (!birthday) return null;

  const match = PATTERN.exec(birthday);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { month, day };
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
  const parsed = parse(birthday);
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
  const parsed = parse(birthday);
  if (!parsed) return null;
  return format(nearestOccurrence(parsed, now), 'd MMM');
}

/** "14 March" — for a sentence, where there is room to say it properly. */
export function formatBirthdayLong(birthday: string | null | undefined): string | null {
  const parsed = parse(birthday);
  if (!parsed) return null;
  // Any leap year, so 29 February is a real date to format rather than 1 March.
  return format(new Date(2024, parsed.month - 1, parsed.day), 'd MMMM');
}
