/**
 * A birthday as an edit form holds it: three boxes of text, and what they mean.
 *
 * Separate from `lib/birthday.ts`, which is about dates, and from
 * `features/students/EditBirthday.tsx`, which draws them. This is the bit in
 * between — the reason a birthday needs three boxes rather than a date picker,
 * expressed as a function two screens can share.
 *
 * The reason is the year. Tally is never *sent* it: the roster carries `MM-DD` so
 * that a phone holding eighty-five children does not hold eighty-five dates of
 * birth. So the form cannot show a year it does not have, and there are two cases
 * rather than one:
 *
 *   - Correcting a birthday already on file: month and day, year box left empty,
 *     and the server keeps whatever year Planning Center holds.
 *   - Filling in a blank one: there is no year upstream to keep, so the year is
 *     required. Planning Center computes an age from this field, and a guessed
 *     year is a wrong age on a child's permanent record.
 *
 * Nothing here can delete a birthday. Every other field in the student editor
 * can be cleared and this one cannot, for the same reason the year is asked for:
 * a blank box in a form that was never shown the value is not evidence that
 * somebody decided to empty it. Untouched boxes mean "leave it alone".
 */
import { birthdayParts, composeBirthday, EARLIEST_BIRTH_YEAR } from '@/lib/birthday';

/** The three boxes, as strings, because a half-typed year is a real state. */
export interface BirthdayFieldsState {
  month: string;
  day: string;
  year: string;
}

export const BLANK_BIRTHDAY_FIELDS: BirthdayFieldsState = { month: '', day: '', year: '' };

/**
 * The boxes as they should open for this student: the day Planning Center holds,
 * and an empty year, always — see above.
 */
export function birthdayFieldsFrom(birthday: string | null | undefined): BirthdayFieldsState {
  const parts = birthdayParts(birthday);
  if (!parts) return BLANK_BIRTHDAY_FIELDS;
  return { month: String(parts.month), day: String(parts.day), year: '' };
}

export type BirthdayFieldsRead =
  /** `value` is what to send, or undefined when this edit changes nothing. */
  | { ok: true; value: string | undefined }
  | { ok: false; error: string };

/**
 * What the three boxes mean, or the sentence to put under them.
 *
 * Checked here rather than left to the server for the refusals a leader can see
 * coming — half a date, and a blank year on a student with no birthdate upstream
 * to take one from. The server checks both again; it is the only thing that can,
 * since only it knows what is on file.
 */
export function readBirthdayFields(
  fields: BirthdayFieldsState,
  options: { onFile: string | null },
): BirthdayFieldsRead {
  const month = fields.month.trim();
  const day = fields.day.trim();
  const year = fields.year.trim();

  if (!month && !day) {
    if (year) return { ok: false, error: 'Give a month and a day as well as the year.' };
    // Nothing typed. On a student who has one on file that is "leave it alone",
    // never "delete it" — there is no way to ask for that here.
    return { ok: true, value: undefined };
  }
  if (!month || !day) {
    return { ok: false, error: 'Give both a month and a day.' };
  }

  if (year && !/^\d{4}$/.test(year)) {
    return { ok: false, error: 'Write the year in full, as four digits.' };
  }

  const composed = composeBirthday({
    month: Number(month),
    day: Number(day),
    year: year ? Number(year) : null,
  });
  if (composed === null) {
    return {
      ok: false,
      error: year
        ? `That day does not exist. Years run from ${EARLIEST_BIRTH_YEAR} to now.`
        : 'That day does not exist in that month.',
    };
  }

  // No year, no birthdate upstream: nothing to keep the day against.
  if (!year && options.onFile === null) {
    return {
      ok: false,
      error: 'Planning Center has no birthdate for them yet, so the year is needed too.',
    };
  }

  // Unchanged, as far as this form can tell. A year on its own is still a
  // change — the day matches and the year upstream may not.
  if (!year && composed === options.onFile) return { ok: true, value: undefined };

  return { ok: true, value: composed };
}
