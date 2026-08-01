/**
 * One place for the "add parent contact" dialog to live, above the rows that
 * ask for it.
 *
 * The dialog used to belong to the row that opened it, which is the obvious
 * place to put it and the one place it cannot survive. Every list that offers
 * it is a list still being decided while a leader reads it: the roster arrives
 * from Planning Center, the attendance window settles, and the session-wide
 * "who can we reach" map lands last of all. Each of those answers can rewrite a
 * row from under a thumb, and an unmounted row takes its dialog with it.
 *
 * A first-timer's row is the clearest case, and the one people hit. Until the
 * contact map answers, the row cannot know anybody is unreachable, so it
 * renders `FollowUpActions` — which looks the student up itself, finds no phone
 * number, and offers the form. When the map lands and confirms nobody can be
 * reached, the row swaps to its own pill offering the same form. Two routes to
 * one dialog, and the swap between them closed a half-typed one. The incomplete
 * list has its own version: a student the map reports as reachable drops off it
 * entirely, mid-sentence.
 *
 * So the dialog is hosted once, here, and rows only ask for it. Nothing a
 * background read does to a list can take back a form somebody is already
 * filling in.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ParentContactModal } from '@/features/students/ParentContactModal';
import {
  ParentContactHostContext,
  type ParentContactHostValue,
} from '@/features/students/parentContactHostContext';
import type { Student } from '@/types';

/** The student being written about, and who wants telling once it lands. */
interface OpenForm {
  student: Student;
  onAdded?: () => void;
}

export function ParentContactHost({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<OpenForm | null>(null);

  const open = useCallback((student: Student, onAdded?: () => void) => {
    setForm({ student, onAdded });
  }, []);

  const value = useMemo<ParentContactHostValue>(() => ({ open }), [open]);

  return (
    <ParentContactHostContext.Provider value={value}>
      {children}
      {/* Keyed by student, so opening the form for somebody else starts an
          empty one rather than inheriting half a name from the last row. */}
      {form ? (
        <ParentContactModal
          key={form.student.id}
          student={form.student}
          onClose={() => setForm(null)}
          onAdded={form.onAdded}
        />
      ) : null}
    </ParentContactHostContext.Provider>
  );
}
