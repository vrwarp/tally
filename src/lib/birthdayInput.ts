/**
 * A birthday the way somebody types one, read while they are still typing.
 *
 * Tally used to ask for a birthday in three controls — a month dropdown, a day
 * box, a year box — which is the shape a form takes when the form is thinking
 * about the database. Nobody says a birthday that way. A leader standing in
 * front of the student who has just answered types `1214`, or `12/14`, or
 * `Dec 14`, and every one of those is unambiguous to a person.
 *
 * So it is one box and this parser. The rules, in the order they matter:
 *
 *   - **Separators are noise.** `12/14`, `12-14`, `12.14`, `12 14` and `1214`
 *     are one date. Anything that is not a letter or a digit is a boundary and
 *     nothing else.
 *   - **A bare run of digits is read month-first and greedily.** `112` is 2
 *     November rather than 12 January, because taking the longest month is what
 *     makes `1212` mean 12 December — and a rule that changed its mind between
 *     three digits and four would be worse than either answer. The month is
 *     decided once, from the front: a run whose first two digits are a month is
 *     never re-read as a one-digit one, or the date under the box would jump
 *     from December to January and back while somebody typed.
 *   - **The year is optional, and never guessed.** `12/14` is a birthday with
 *     no year, which Planning Center can hold — see `birthdayField.ts`.
 *   - **Half-typed is not wrong.** `1`, `12`, `12/1` on the way to `12/14`, two
 *     digits of a four-digit year: all `partial`, which the field draws in the
 *     same grey as a hint. An error that appears on the first keystroke and
 *     clears on the fourth teaches nothing and reads as a fault.
 *
 * The refusals are the other half. `2/30` is `impossible` rather than
 * `unreadable`: the difference is whether Tally understood somebody and has to
 * disagree, or did not understand them at all, and the two want different
 * sentences under the box.
 */
import { format } from 'date-fns';
import { EARLIEST_BIRTH_YEAR, isRealBirthday } from '@/lib/birthday';

export type BirthdayInputReading =
  /** Nothing typed. */
  | { state: 'empty' }
  /** Could still become a date if they keep going. Say nothing sharp. */
  | { state: 'partial' }
  /** Not a date, and not on the way to one. */
  | { state: 'unreadable' }
  /** Understood, and refused. */
  | { state: 'impossible'; reason: ImpossibleReason }
  /** Understood. `year` is null when they did not give one. */
  | { state: 'read'; month: number; day: number; year: number | null };

export type ImpossibleReason =
  /** 31 February, 31 April — a day that month never has. */
  | 'no-such-day'
  /** 29 February against a year that does not have one. */
  | 'not-that-year'
  /** A year of birth that has not happened. */
  | 'future-year'
  /** Before `EARLIEST_BIRTH_YEAR`, which is nobody on a youth roster. */
  | 'early-year';

const ENGLISH_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/**
 * Month names a typed word is matched against.
 *
 * English always, because the abbreviations people type are English on a form
 * whose every other word is; plus the reader's own locale, so a month name this
 * app would *print* is one it can also read back.
 */
const MONTH_NAMES: readonly (readonly string[])[] = ENGLISH_MONTHS.map((english, index) => {
  // Any year: only the month name is read off it.
  const local = format(new Date(2024, index, 1), 'MMMM').toLowerCase();
  return local === english ? [english] : [english, local];
});

/** A number read off the input, or why it is not one yet. */
type Figure = number | 'growing' | 'bad';

/**
 * What somebody has typed so far, as a date or as the reason it is not one.
 *
 * `now` settles two things and only two: which years are in the future, and
 * which century a two-digit year belongs to.
 */
export function parseBirthdayInput(raw: string, now: Date = new Date()): BirthdayInputReading {
  // `14th Dec` is the same date as `14 Dec`, and stripping the suffix here
  // keeps `th` away from the month matcher.
  const text = raw.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  if (text === '') return { state: 'empty' };

  const tokens = text.match(/\p{L}+|\d+/gu);
  // Separators and nothing else — a half-deleted `12/`, say.
  if (!tokens) return { state: 'partial' };

  const words = tokens.filter((token) => /\p{L}/u.test(token));
  const numbers = tokens.filter((token) => /\d/.test(token));
  // Two words: two month names, or one and something that is not a month.
  if (words.length > 1) return { state: 'unreadable' };

  return words.length === 1 ? fromNamedMonth(words[0], numbers, now) : fromNumbers(numbers, now);
}

/** "dec", "december", "sept" — or the two answers that are not one month. */
function monthFromWord(word: string): number | 'none' | 'ambiguous' {
  const matches = MONTH_NAMES.flatMap((names, index) =>
    names.some((name) => name.startsWith(word)) ? [index + 1] : [],
  );

  if (matches.length === 0) return 'none';
  // "j" is January, June and July at once: somebody mid-word, not a mistake.
  if (matches.length > 1) return 'ambiguous';
  return matches[0];
}

function fromNamedMonth(word: string, numbers: readonly string[], now: Date): BirthdayInputReading {
  const month = monthFromWord(word);
  if (month === 'none') return { state: 'unreadable' };
  if (month === 'ambiguous') return { state: 'partial' };
  // "December" alone: the month is settled and the day is still coming.
  if (numbers.length === 0) return { state: 'partial' };
  if (numbers.length > 2) return { state: 'unreadable' };

  if (numbers.length === 2) {
    // "2011 December 14" as readily as "December 14 2011".
    const yearFirst = numbers[0].length === 4;
    const day = readSmall(yearFirst ? numbers[1] : numbers[0]);
    const year = readYear(yearFirst ? numbers[0] : numbers[1], now);
    return finish(month, day, year, now);
  }

  const only = numbers[0];
  if (only.length <= 2) return finish(month, readSmall(only), null, now);

  // "dec 142011" — a day and a year with nothing between them.
  const split = splitDayAndYear(only, now);
  return split ? finish(month, split.day, split.year, now) : { state: 'partial' };
}

function fromNumbers(numbers: readonly string[], now: Date): BirthdayInputReading {
  if (numbers.length === 0) return { state: 'partial' };
  if (numbers.length === 1) return fromDigitRun(numbers[0], now);
  if (numbers.length > 3) return { state: 'unreadable' };

  // ISO, which is what a date pasted from anywhere else tends to look like.
  if (numbers[0].length === 4) {
    if (numbers.length === 2) return { state: 'partial' };
    return finish(readSmall(numbers[1]), readSmall(numbers[2]), Number(numbers[0]), now);
  }

  if (numbers.length === 2 && numbers[1].length > 2) {
    // "12/142011", and every keystroke of "12/2011" on the way to somewhere.
    const split = splitDayAndYear(numbers[1], now);
    return split
      ? finish(readSmall(numbers[0]), split.day, split.year, now)
      : { state: 'partial' };
  }

  return finish(
    readSmall(numbers[0]),
    readSmall(numbers[1]),
    numbers.length === 3 ? readYear(numbers[2], now) : null,
    now,
  );
}

/**
 * A single run of digits: the month off the front, then the day, then whatever
 * is left as a year.
 *
 * Only a whole year is taken here. `12122011` is 12 December 2011 and `121211`
 * is still `partial` — a two-digit year is fine when somebody separated it
 * themselves (`12/12/11`), but inside a bare run it would make every keystroke
 * on the way to a four-digit year land on a different plausible date, and
 * `12120` reading as 1 December 2020 for exactly one keystroke is worse than
 * saying nothing for two.
 */
function fromDigitRun(digits: string, now: Date): BirthdayInputReading {
  // `20111214` — but only when the leading four could be a year of birth, or
  // `12122011` would be read as the year 1212.
  if (digits.length === 8) {
    const leading = Number(digits.slice(0, 4));
    if (leading >= EARLIEST_BIRTH_YEAR && leading <= now.getFullYear()) {
      return finish(Number(digits.slice(4, 6)), Number(digits.slice(6, 8)), leading, now);
    }
  }

  // The month, greedily and once. Two digits win whenever they are a month at
  // all; `131` falls back to January because 13 is not one.
  const monthLength = digits.length >= 2 && isMonth(Number(digits.slice(0, 2))) ? 2 : 1;
  const month = Number(digits.slice(0, monthLength));
  const rest = digits.slice(monthLength);
  if (!isMonth(month)) {
    // Not a month yet, but `0` is the first digit of one.
    return digits.length === 1 && digits === '0' ? { state: 'partial' } : { state: 'unreadable' };
  }
  if (rest === '') return { state: 'partial' };

  const split = splitDayAndYear(rest, now);
  if (split) return finish(month, split.day, split.year, now);

  // `mmddyyyy` is the longest this shape gets, so anything shorter that has a
  // month on the front is still on its way somewhere.
  return digits.length < 8 ? { state: 'partial' } : { state: 'unreadable' };
}

/**
 * The digits after the month, as a day and the year that may follow it.
 *
 * Greedy in the same direction: a two-digit day is preferred, and given up only
 * when what it leaves behind is not a year. `1212011` is 1 December 2011
 * because `12|12|011` has no year in it and `12|1|2011` does.
 */
function splitDayAndYear(digits: string, now: Date): { day: number; year: number | null } | null {
  for (const dayLength of [2, 1] as const) {
    if (digits.length < dayLength) continue;
    const day = Number(digits.slice(0, dayLength));
    if (day < 1 || day > 31) continue;

    const yearDigits = digits.slice(dayLength);
    if (yearDigits === '') return { day, year: null };
    if (yearDigits.length === 4) {
      const year = Number(yearDigits);
      // A year that cannot be one leaves the day free to be read the other way.
      if (year >= EARLIEST_BIRTH_YEAR && year <= now.getFullYear()) return { day, year };
    }
  }
  return null;
}

function isMonth(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 12;
}

/** A month or a day: at most two digits, and zero means "still typing". */
function readSmall(digits: string): Figure {
  if (digits.length > 2) return 'bad';
  return Number(digits) === 0 ? 'growing' : Number(digits);
}

/**
 * A year as typed: four digits as they stand, two expanded around today.
 *
 * One digit or three is somebody part-way through typing a year; five is a
 * mistake. `finish` is where that difference becomes a state.
 */
function readYear(digits: string, now: Date): Figure | null {
  if (digits === '') return null;
  if (digits.length === 4) return Number(digits);
  if (digits.length === 1 || digits.length === 3) return 'growing';
  if (digits.length !== 2) return 'bad';

  // `11` is 2011 rather than 1911 on a roster of children, and `99` is 1999
  // rather than a year that has not happened.
  const century = Math.floor(now.getFullYear() / 100) * 100;
  const value = Number(digits);
  return value <= now.getFullYear() % 100 ? century + value : century - 100 + value;
}

/**
 * The last word on a month, a day and a year that have all been read off the
 * box — including the two ways of not being a date yet.
 */
function finish(
  month: Figure,
  day: Figure,
  year: Figure | null,
  now: Date,
): BirthdayInputReading {
  if (month === 'bad' || day === 'bad' || year === 'bad') return { state: 'unreadable' };
  if (month === 'growing' || day === 'growing' || year === 'growing') return { state: 'partial' };

  if (!isMonth(month)) return { state: 'unreadable' };
  if (!Number.isInteger(day) || day < 1 || day > 31) return { state: 'unreadable' };

  if (year !== null) {
    if (year > now.getFullYear()) return { state: 'impossible', reason: 'future-year' };
    if (year < EARLIEST_BIRTH_YEAR) return { state: 'impossible', reason: 'early-year' };
  }

  // The day against the longest February first, so 29 February is refused for
  // the year it was given rather than for existing at all.
  if (!isRealBirthday(month, day)) return { state: 'impossible', reason: 'no-such-day' };
  if (year !== null && !isRealBirthday(month, day, year)) {
    return { state: 'impossible', reason: 'not-that-year' };
  }

  return { state: 'read', month, day, year };
}
