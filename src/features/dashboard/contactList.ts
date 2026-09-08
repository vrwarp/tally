import { gradeLabel, type GradeStrings } from '@/lib/grades';
import { studentFullName, type Student } from '@/types';
import type { PcoPersonDetails } from '@/types';

/**
 * Plain text, because it is going into a group chat rather than a document.
 *
 * Journey 5 ends with the core team dividing a follow-up list between people.
 * What actually happens is that someone pastes the names into a thread, so the
 * useful export is text a human can read, not a CSV.
 *
 * Contact details are passed in rather than read off the student, because Tally
 * does not hold them: they come from Planning Center, one person at a time, for
 * the people a leader has actually opened. Anyone not in `contacts` is still
 * listed — "who" is useful even when "how" has not been looked up.
 */
/**
 * The three keys this builder needs, as a narrow function type.
 *
 * A pure module cannot call a hook, and handing it the whole `t` would make
 * every key in the catalogue reachable from a formatter. The caller passes the
 * translator it already has.
 */
export type ContactListTranslator = (
  key: 'listContactFallback' | 'listRowWithGrade' | 'listRow',
  values?: Record<string, string>,
) => string;

export function buildContactList(
  t: ContactListTranslator,
  grades: GradeStrings,
  title: string,
  students: readonly Student[],
  contacts: ReadonlyMap<string, PcoPersonDetails> = new Map(),
): string {
  const lines = students.map((student) => {
    const details = contacts.get(student.id);
    const contact =
      details?.contactPhone?.trim() || details?.contactEmail?.trim() || t('listContactFallback');
    // The bracket goes rather than filling with a grade nobody holds: this
    // paste lands in a group chat, where "(6th)" beside an adult's name is a
    // claim about them that whoever reads it has no way to check.
    const grade = gradeLabel(grades, student);
    return grade
      ? t('listRowWithGrade', { name: studentFullName(student), grade, contact })
      : t('listRow', { name: studentFullName(student), contact });
  });
  return [title, ...lines].join('\n');
}
