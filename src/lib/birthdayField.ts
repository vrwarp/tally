/**
 * A birthday as an edit form holds it: one box of text, and what it means.
 *
 * Separate from `lib/birthday.ts`, which is about dates, from
 * `lib/birthdayInput.ts`, which turns what somebody typed into a month, a day
 * and perhaps a year, and from `features/students/EditBirthday.tsx`, which
 * draws the box. This is the bit in between — what the box means to Planning
 * Center, expressed as a function two screens can share.
 *
 * The year is the whole subject, and which of two things it is depends on who
 * is asking. A *roster* carries `MM-DD` and nothing else, so that a phone
 * holding eighty-five children does not hold eighty-five dates of birth. The
 * one-person details read — the same read that carries an allergy note and a
 * parent's phone number — carries the whole date, so a form that has it opens
 * on it. `onFile` here is whichever of the two its caller was given, and the
 * shapes are the two Tally writes back.
 *
 * A leader typing a day without a year stays the ordinary case rather than the
 * broken one:
 *
 *   - Correcting a birthday already on file: the day alone, and the server
 *     keeps whatever year Planning Center holds. Rubbing the year out of a box
 *     that was showing one means the same thing — it is not a request to delete
 *     it, and the sentence under the box names the year being kept.
 *   - Filling in a blank one: the day alone is still enough. Planning Center
 *     stores a birthday nobody knows the year of — it keeps 1885 for exactly
 *     this, and shows no age against it — so Tally has no business demanding a
 *     year a leader standing in front of the student may not have. Typing one
 *     is better, and optional.
 *
 * The one date that still needs a year is 29 February on a student with no year
 * on file: 1885 has no 29 February, so there is no year-less date to store.
 *
 * Nothing here can delete a birthday. Every other field in the student editor
 * can be cleared and this one cannot: an empty box in a form that was never
 * shown the value is not evidence that somebody decided to empty it. An
 * untouched box means "leave it alone".
 */
import { format } from 'date-fns';
import {
  birthdayYear,
  composeBirthday,
  formatBirthdayLong,
  parseBirthday,
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
 * The box as it should open for this student: what Planning Center holds, in
 * the shape the box holds it in — with the year when whoever is asking has been
 * given one.
 *
 * Handed a roster row's `MM-DD` this opens on the day alone, because that is
 * all a roster knows. Handed the details read's `YYYY-MM-DD` it opens on the
 * whole date: hiding a year the screen has in its hand made every edit of the
 * day look like it was about to delete the year, and left a leader who could
 * see the birthday was wrong by a year with no way to say so.
 */
export function birthdayFieldFrom(birthday: string | null | undefined): string {
  const parts = parseBirthday(birthday);
  if (!parts) return BLANK_BIRTHDAY_FIELD;
  // Stryker disable next-line ConditionalExpression,StringLiteral:
  // `formatBirthdayInput` reads digits and treats everything else as a
  // separator, so `String(null)` and any other letters come out of it as the
  // same empty year slot. This says what is meant rather than leaning on that.
  const year = parts.year === null ? '' : String(parts.year);
  return formatBirthdayInput(`${pad(parts.month)}${pad(parts.day)}${year}`);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export type BirthdayFieldRead =
  /** `value` is what to send, or undefined when this edit changes nothing. */
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

export interface BirthdayFieldOptions {
  /**
   * What Planning Center holds — `MM-DD` from a roster row, `YYYY-MM-DD` from
   * the one-person read, null when it holds no birthdate at all.
   */
  onFile: string | null;
  now?: Date;
}

/**
 * Whether this typing is what is already upstream, and therefore nothing to
 * send.
 *
 * The year is compared only when one was typed. A leader who cleared the year
 * out of the box and left the day alone has not asked for the year to change —
 * an empty year means "keep whatever is there", the same thing it means on a
 * box that never showed one.
 */
function alreadyOnFile(
  reading: { month: number; day: number; year: number | null },
  onFile: string | null,
): boolean {
  const held = parseBirthday(onFile);
  if (held === null) return false;
  if (held.month !== reading.month || held.day !== reading.day) return false;
  return reading.year === null || reading.year === held.year;
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

  // Unchanged, as far as this form can tell — and it can tell rather more than
  // it used to, now that the year is on screen: a box opened on 14 March 2011
  // and pressed without being touched has nothing to send, where before every
  // Save carried a day upstream for the server to find identical.
  if (alreadyOnFile({ month, day, year }, options.onFile)) return { ok: true, value: undefined };

  const composed = composeBirthday({ month, day, year });
  // Stryker disable next-line all: every refusal `composeBirthday` has left is
  // one the parser above has already made, so nothing reaches this. It is here
  // because the two are separate modules and only one of them says so.
  if (composed === null) return { ok: false, error: refusal('no-such-day') };

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
  const unchanged = alreadyOnFile({ month, day, year }, onFile);

  if (year !== null) {
    const said = format(new Date(year, month - 1, day), 'd MMMM yyyy');
    return {
      tone: 'good',
      say: unchanged ? `${said} — already what Planning Center holds.` : `${said}.`,
    };
  }
  if (needsYearForLeapDay(month, day, onFile)) return { tone: 'bad', say: LEAP_DAY_NEEDS_YEAR };

  const said = formatBirthdayLong(composeBirthday({ month, day }));
  if (unchanged) return { tone: 'good', say: `${said} — already what Planning Center holds.` };

  // Named rather than alluded to, wherever it is known. "The year Planning
  // Center holds" is the most that can be said to somebody who has never been
  // shown it — which is still the case on a screen holding only a roster row —
  // but a box that opened on 2011 and has had the year rubbed out of it can
  // simply say which year it is about to keep.
  const held = birthdayYear(onFile);
  if (onFile === null) {
    return { tone: 'good', say: `${said}, with no year. Planning Center will show no age.` };
  }
  return {
    tone: 'good',
    say:
      held === null
        ? `${said}, keeping the year Planning Center holds.`
        : `${said}, keeping ${held}.`,
  };
}

/**
 * 1885 — the year Planning Center keeps for a birthday nobody knows the year of
 * — is not a leap year, so a 29 February with no year has nowhere to go.
 * Anywhere there is a year on file, the server checks 29 February against that
 * one instead.
 *
 * Still `onFile === null` rather than "no year in `onFile`", now that a year can
 * be there. A bare `MM-DD` is two different facts — the roster's day, whose year
 * upstream this screen has not been told, and the details read's answer that
 * nobody upstream knows one — and only the second is a reason to refuse. The
 * server can tell them apart and does; refusing here would turn "a year you have
 * not been shown yet" into a wrong error on a real 29 February.
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
