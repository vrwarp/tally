/**
 * "Add a parent contact", wherever somebody is standing when they notice one is
 * missing.
 *
 * The write itself lives in `AddParentContact`, which already carries every
 * refusal — no upstream record, no adult in the household, write-back turned
 * down — and picks between adding a number and building a family. What was
 * missing was a way to *get* to it: the form existed on the student's profile
 * and behind a roster badge, and every other screen that names an unreachable
 * student sent people to Planning Center in a new tab instead. On an install
 * running `PCO_WRITE_BACK=full` that is a trip to another product to type two
 * fields Tally is allowed to write.
 *
 * So the read and the invalidation that follows a write are packaged once here,
 * as a panel any surface can host and a modal any row can open.
 */
import { Button, ErrorBanner, Modal, Spinner } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { invalidateAdultContact } from '@/hooks/useAdultContact';
import { invalidatePersonDetails, usePersonDetails } from '@/hooks/usePersonDetails';
import { AddParentContact } from '@/features/students/AddParentContact';
import { backendLabelOf, studentFullName, type Student } from '@/types';

export interface ParentContactPanelProps {
  student: Student;
  /** Closes whatever is hosting this, once the write has landed. */
  onDone: () => void;
  /**
   * Anything else on screen holding a "who can we reach" answer that the write
   * has just made wrong — the dashboard's session-wide map, most of the time.
   * The three things Tally itself caches are dropped either way.
   */
  onAdded?: () => void;
}

/**
 * The read that feeds the form, plus the invalidation that makes the screen
 * behind it agree with itself afterwards.
 */
export function ParentContactPanel({ student, onDone, onAdded }: ParentContactPanelProps) {
  const { details, loading, loaded, error, retry, refresh } = usePersonDetails(student);
  const { refreshRoster } = useData();

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (loading || !loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-400">
        <Spinner /> Reading {backendLabelOf(student)}…
      </p>
    );
  }

  return (
    <AddParentContact
      student={student}
      details={details}
      // Opening this *is* the request. Everything hosting it got here from a
      // control that said "add parent contact", so the collapsed state would be
      // that same offer made a second time.
      defaultOpen
      onCancel={onDone}
      onAdded={() => {
        // Three things held an answer that has just stopped being true: this
        // student's details, the session-wide "who can we reach" map the chip
        // count reads, and the roster row itself.
        invalidatePersonDetails(student.id);
        invalidateAdultContact();
        refresh();
        void refreshRoster(true);
        onAdded?.();
        onDone();
      }}
    />
  );
}

export interface ParentContactModalProps {
  student: Student;
  onClose: () => void;
  /** Forwarded to the panel — see `ParentContactPanelProps.onAdded`. */
  onAdded?: () => void;
}

/**
 * The panel as a dialog, for the lists that name an unreachable student in a
 * row and have nowhere to put a form.
 *
 * A modal rather than an expanding row on purpose: these are call lists worked
 * top to bottom, and a row that grew a four-field form under a thumb would push
 * the next five students off the screen.
 */
export function ParentContactModal({ student, onClose, onAdded }: ParentContactModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Add parent contact"
      description={studentFullName(student)}
      size="sm"
    >
      <ParentContactPanel student={student} onDone={onClose} onAdded={onAdded} />
    </Modal>
  );
}
