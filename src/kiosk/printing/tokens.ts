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
import { gradeDescription } from '@/lib/utils';
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
export function tokenValuesFor(student: KioskStudent, binding: KioskBinding): LabelTokenValues {
  const now = new Date();
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
    grade: student.grade === null ? '' : gradeDescription(student.grade),
    eventTitle: binding.title,
    date: now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}
