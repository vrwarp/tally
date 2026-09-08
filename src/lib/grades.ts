/**
 * What a grade is called, in whatever language the reader has chosen.
 *
 * Split out of `lib/utils.ts` because it stopped being string formatting and
 * became translation. English builds "9th" out of a number and an ordinal
 * suffix; no other language does. Chinese writes 9年级 — the numeral, then the
 * noun, with no ordinal at all — and Kindergarten and Pre-K are words rather
 * than positions in a sequence.
 *
 * So the ordinal is an ICU `selectordinal`, which is the one construct that
 * gets this right per language, and the three special grades are their own
 * keys. A `GradeStrings` is threaded through the pure formatters (the CSV
 * builders, the kiosk's label tokens) and built by `useGrades()` in components.
 */
import { PRE_K } from '@/types';

/** The five keys a grade can render as. */
export interface GradeStrings {
  (
    key: 'preK' | 'kindergarten' | 'shortK' | 'ordinal' | 'ordinalWithNoun' | 'none',
    values?: Record<string, number>,
  ): string;
}

/**
 * The short token for a grade: `Pre-K`, `K`, `1st`, `9th`.
 *
 * The two grades below 1st have names rather than numbers, and an ordinal
 * would print "0th" and "-1th" for them — the second of which is not a
 * hypothetical: it reached a lobby screen. Everything below Pre-K has no grade
 * at all and never reaches here — see `Grade`.
 *
 * "Pre-K" rather than "PK", because that is what Planning Center calls it on
 * the profile these children arrive from — so it is the name already on the
 * screen the office is looking at while a volunteer reads the label.
 */
export function gradeName(t: GradeStrings, grade: number): string {
  if (grade === PRE_K) return t('preK');
  return grade === 0 ? t('shortK') : t('ordinal', { grade });
}

/**
 * The same thing with its noun, for the places that read "9th grade".
 *
 * Kindergarten needs the whole word: "K grade" is not English, and a screen
 * reader saying it beside a child's name is worse. Pre-K is the same — it is
 * already the name of the year, so "Pre-K grade" only adds a stumble.
 */
export function gradeDescription(t: GradeStrings, grade: number): string {
  if (grade === PRE_K) return t('preK');
  return grade === 0 ? t('kindergarten') : t('ordinalWithNoun', { grade });
}

/**
 * The ordinal to print for somebody's grade, or null when nobody has one.
 *
 * A null grade is every adult on a hand-picked roster — the leaders and
 * volunteers a list-mode roster deliberately carries — and every child too
 * young to have one. It used to be spelled as a number plus a `gradeOnFile`
 * flag, and the flag was routinely wrong: the sync set it from whether the
 * upstream value was *blank*, not whether it had been clamped, so a real 3rd
 * grader was printed as a 6th grader as a fact about them.
 *
 * Callers with a slot to fill fall back to `t('none')`; callers where the
 * grade is one clause of a longer line drop the clause instead, because
 * "No grade ·" spends the width that line needs on the thing it is least about.
 */
export function gradeLabel(t: GradeStrings, student: { grade: number | null }): string | null {
  return student.grade === null ? null : gradeName(t, student.grade);
}

/**
 * The same, with its noun — for aria labels and any line that reads "9th
 * grade". Kindergarten becomes "Kindergarten" rather than "K grade".
 */
export function gradeSentence(t: GradeStrings, student: { grade: number | null }): string | null {
  return student.grade === null ? null : gradeDescription(t, student.grade);
}
