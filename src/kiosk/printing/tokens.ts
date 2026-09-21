/**
 * What a template's `{{tokens}}` resolve to for one child at one gathering.
 *
 * Its own module rather than a function inside `index.ts` so it can be tested:
 * that file pulls in WebUSB and a `?worker` import, neither of which exists
 * under vitest, and the rules below are worth more than a mock of the transport.
 *
 * Resolved here rather than in `lib/labelTemplate.ts` because a grade reads as
 * "8th grade" through `gradeDescription` and a time through the locale, neither
 * of which a module shared with the Cloud Functions may import. Everything else
 * comes from the roster row and the binding — which is all the kiosk has, and
 * all it is meant to have.
 */
import { gradeDescription, type GradeStrings } from '@/lib/grades';
import type { LabelTokenValues } from '@/lib/labelTemplate';
import { splitFirstName } from '@/types';
import type { KioskBinding } from '../binding';
import type { KioskStudent } from '../search';

/**
 * The values a template's tokens resolve to for this child at this gathering.
 *
 * All but one. `allergy` is deliberately absent: it is the only value the roster
 * row does not answer, and it arrives from a callable rather than from a field.
 * `allergyFor` folds it in at rasterise time, which is where waiting is allowed.
 * A missing token reads as empty anyway, so a template using `{{allergy}}` on a
 * kiosk that never looked prints the same tidy label as one for a child with
 * nothing on file.
 */
export function tokenValuesFor(
  grades: GradeStrings,
  /**
   * The kiosk's language, for the two tokens `Intl` writes.
   *
   * Passed rather than defaulted, on the same argument as `grades`: a lobby set
   * to Chinese on a tablet sold in English would otherwise print `Sep 7` under
   * a name in Chinese, and the language of the sticker is the language of the
   * room. See `eventWindow` in `../binding.ts`.
   */
  locale: string,
  student: KioskStudent,
  binding: KioskBinding,
  /**
   * When the sticker's moment was, for a label coming out late.
   *
   * Absent means now, which is every ordinary label: a check-in prints in the
   * same second it is taken. A name tag the printer *owed* is the exception —
   * drawn twenty minutes after the child walked in — and `{{time}}` on a
   * nursery sticker is what the room reads for how long they have been here.
   * A tag saying 9:40 for a child who arrived at 9:12 is a tag read wrongly, so
   * the moment travels with the tag rather than being taken from the clock when
   * it finally reaches the tape. See `../owed.ts`.
   */
  atMs?: number,
): LabelTokenValues {
  const now = atMs === undefined ? new Date() : new Date(atMs);
  // `student.firstName` is the composite the roster row displays — `Benson
  // “蔡秉洲”` — because that is what makes both spellings searchable. A sticker
  // wants the halves apart: see the `LABEL_TOKENS` comment for why the quotes
  // cost more here than they do on a screen.
  const { firstName, nickname } = splitFirstName(student.firstName);
  return {
    firstName,
    // Empty, not absent, for the child who has no second name — the same
    // distinction `SPARSE_SAMPLE_VALUES` draws. Both read as nothing through
    // `fillLabelTokens`; empty is what a kiosk that looked and found none sends.
    nickname: nickname ?? '',
    lastName: student.lastName,
    // No full stop: a template that wants one can say `{{lastInitial}}.`, and a
    // child with no surname on the roster then gets nothing rather than a stray
    // dot. See `fillLabelTokens`.
    lastInitial: student.lastName ? student.lastName.slice(0, 1).toUpperCase() : '',
    grade: student.grade === null ? '' : gradeDescription(grades, student.grade),
    eventTitle: binding.title,
    // Empty rather than absent, like `nickname`: a kiosk that looked and found
    // no room sends nothing, and a line that is only this token drops.
    location: binding.location ?? '',
    date: now.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    time: now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
  };
}
