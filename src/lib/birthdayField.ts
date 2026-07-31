/**
 * A birthday as an edit form holds it: one box of text, and what it means.
 *
 * Separate from `lib/birthday.ts`, which is about dates, from
 * `lib/birthdayInput.ts`, which turns what somebody typed into a month, a day
 * and perhaps a year, and from `features/students/EditBirthday.tsx`, which
 * draws the box. This is the bit in between — what the box means to Planning
 * Center, expressed as a function two screens can share.
 *
 * The year is the whole subject. Tally is never *sent* it: the roster carries
 * `MM-DD` so that a phone holding eighty-five children does not hold eighty-five
 * dates of birth. So the box cannot open on a year it has never seen, and a
 * leader typing a day without one is the ordinary case rather than the broken
 * one:
 *
 *   - Correcting a birthday already on file: the day alone, and the server
 *     keeps whatever year Planning Center holds.
 *   - Filling in a blank one: the day alone is still enough. Planning Center
 *     stores a birthday nobody knows the year of — it keeps 1885 for exactly
 *     this, and shows no age against it — so Tally has no business demanding a
 *     year a leader standing in front of the student may not have. Typing one
 *     is better, and optional.
 *
 * The one date that still needs a year is 29 February on a student with nothing
 * on file: 1885 has no 29 February, so there is no year-less date to store.
 *
 * Nothing here can delete a birthday. Every other field in the student editor
 * can be cleared and this one cannot: an empty box in a form that was never
 * shown the value is not evidence that somebody decided to empty it. An
 * untouched box means "leave it alone".
 */
import { format } from 'date-fns';
import {
  birthdayParts,
  composeBirthday,
  formatBirthdayLong,
  EARLIEST_BIRTH_YEAR,
} from '@/lib/birthday';
import {
  formatBirthdayInput,
  parseBirthdayInput,
  type ImpossibleReason,
} from '@/lib/birthdayInput';

/** An empty box, which means "leave whatever is upstream alone". */
export const BLANK_BIRTHDAY_FIELD = '';

/**
 * The box as it should open for this student: the day Planning Center holds, in
 * the shape the box holds it in, and never a year — see above.
 */
export function birthdayFieldFrom(birthday: string | null | undefined): string {
  const parts = birthdayParts(birthday);
  if (!parts) return BLANK_BIRTHDAY_FIELD;
  return formatBirthdayInput(`${pad(parts.month)}${pad(parts.day)}`);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export type BirthdayFieldRead =
  /** `value` is what to send, or undefined when this edit changes nothing. */
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

export interface BirthdayFieldOptions {
  /** Null when Planning Center holds no birthdate for them. */
  onFile: string | null;
  now?: Date;
}

/**
 * What the box means, or the sentence to put under it.
 *
 * Checked here rather than left to the server for every refusal a leader can
 * see coming. The server checks again; it is the only thing that can, since
 * only it knows what is on file.
 */
export function readBirthdayField(text: string, options: BirthdayFieldOptions): BirthdayFieldRead {
  const reading = parseBirthdayInput(text, options.now ?? new Date());

  if (reading.state === 'empty') {
    // Nothing typed. On a student who has one on file that is "leave it alone",
    // never "delete it" — there is no way to ask for that here.
    return { ok: true, value: undefined };
  }
  if (reading.state === 'partial') {
    return {
      ok: false,
      error: reading.year
        ? 'Finish the year, or take it out — a birthday can go in without one.'
        : 'That is half a date. Give a month and a day at least.',
    };
  }
  if (reading.state === 'impossible') {
    return { ok: false, error: refusal(reading.reason) };
  }

  const { month, day, year } = reading;
  if (year === null && needsYearForLeapDay(month, day, options.onFile)) {
    return { ok: false, error: LEAP_DAY_NEEDS_YEAR };
  }

  const composed = composeBirthday({ month, day, year });
  // Every refusal `composeBirthday` has left is one the parser has already made.
  if (composed === null) return { ok: false, error: refusal('no-such-day') };

  // Unchanged, as far as this form can tell. A year on its own is still a
  // change — the day matches and the year upstream may not.
  if (year === null && composed === options.onFile) return { ok: true, value: undefined };

  return { ok: true, value: composed };
}

/** Grey or red, and the sentence — the live half of the same reading. */
export interface BirthdayFieldNote {
  /** `bad` is drawn as an error; `quiet` and `good` are drawn as a hint. */
  tone: 'quiet' | 'good' | 'bad';
  say: string;
}

/**
 * The date as Tally understands it so far, in words, under the box.
 *
 * Ambiguity is the reason this exists. `1214` and `112` are readings of what
 * somebody meant, and a reading made silently is one nobody can correct.
 * Printing "14 December" under the box as they type is what turns a clever
 * parser into an honest one — and it is also how a leader finds out the year is
 * optional without a sentence telling them so.
 */
export function describeBirthdayField(
  text: string,
  options: BirthdayFieldOptions,
): BirthdayFieldNote {
  const reading = parseBirthdayInput(text, options.now ?? new Date());
  const { onFile } = options;

  if (reading.state === 'empty') {
    return {
      tone: 'quiet',
      say:
        onFile === null
          ? 'Just the numbers — the year is optional.'
          : 'Left empty, the birthday Planning Center holds stays as it is.',
    };
  }
  if (reading.state === 'partial') {
    return {
      tone: 'quiet',
      say: reading.year ? 'Keep going, or leave the year out.' : 'Keep going.',
    };
  }
  if (reading.state === 'impossible') return { tone: 'bad', say: refusal(reading.reason) };

  const { month, day, year } = reading;
  if (year !== null) {
    return { tone: 'good', say: `${format(new Date(year, month - 1, day), 'd MMMM yyyy')}.` };
  }
  if (needsYearForLeapDay(month, day, onFile)) return { tone: 'bad', say: LEAP_DAY_NEEDS_YEAR };

  const composed = composeBirthday({ month, day });
  const said = formatBirthdayLong(composed);
  if (composed === onFile) return { tone: 'good', say: `${said} — already what Planning Center holds.` };
  return {
    tone: 'good',
    say:
      onFile === null
        ? `${said}, with no year. Planning Center will show no age.`
        : `${said}, keeping the year Planning Center holds.`,
  };
}

/**
 * 1885 — the year Planning Center keeps for a birthday nobody knows the year of
 * — is not a leap year, so a 29 February with no year has nowhere to go.
 * Anywhere there is a year on file, the server checks 29 February against that
 * one instead.
 */
function needsYearForLeapDay(month: number, day: number, onFile: string | null): boolean {
  return month === 2 && day === 29 && onFile === null;
}

const LEAP_DAY_NEEDS_YEAR =
  'Planning Center cannot hold 29 February without a year, and it has none for them. Give the year too.';

function refusal(reason: ImpossibleReason): string {
  switch (reason) {
    case 'no-such-day':
      return 'That day does not exist in that month.';
    case 'not-that-year':
      return 'February had no 29th in that year.';
    case 'future-year':
      return 'That year has not happened yet.';
    case 'early-year':
      return `Years run from ${EARLIEST_BIRTH_YEAR} to now.`;
  }
}
