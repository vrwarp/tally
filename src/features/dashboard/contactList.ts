import { ordinalGrade } from '@/lib/utils';
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
export function buildContactList(
  title: string,
  students: readonly Student[],
  contacts: ReadonlyMap<string, PcoPersonDetails> = new Map(),
): string {
  const lines = students.map((student) => {
    const details = contacts.get(student.id);
    const contact =
      details?.parentPhone?.trim() || details?.parentEmail?.trim() || 'contact in Planning Center';
    return `- ${studentFullName(student)} (${ordinalGrade(student.grade)}) ${contact}`;
  });
  return [title, ...lines].join('\n');
}
