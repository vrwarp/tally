import { formatPhone, ordinalGrade } from '@/lib/utils';
import { studentFullName, type Student } from '@/types';

/**
 * Plain text, because it is going into a group chat rather than a document.
 *
 * Journey 5 ends with the core team dividing a follow-up list between people.
 * What actually happens is that someone pastes the names into a thread, so the
 * useful export is text a human can read, not a CSV. Students with no contact
 * are still listed: "who" is useful even when "how" is missing.
 */
export function buildContactList(title: string, students: readonly Student[]): string {
  const lines = students.map((student) => {
    const phone = student.parentPhone?.trim();
    const contact = phone
      ? formatPhone(phone)
      : student.parentEmail?.trim() || 'no contact on file';
    return `- ${studentFullName(student)} (${ordinalGrade(student.grade)}) ${contact}`;
  });
  return [title, ...lines].join('\n');
}
