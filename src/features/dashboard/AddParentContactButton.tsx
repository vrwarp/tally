/**
 * The thing a leader presses on a row for a student nobody can reach.
 *
 * Every dashboard list that can name such a student used to hand the job to
 * Planning Center: a link, a new tab, somebody else's product, and a leader who
 * has lost their place in a call list to type a phone number. That is the right
 * answer on an install where Tally may not write — and the wrong one on
 * `PCO_WRITE_BACK=full`, where the form to do it has existed on the student's
 * own profile all along.
 *
 * So the row opens that form. Which of the two it turns out to be — a number on
 * an adult already on file, or an adult and a household to put them in — is
 * decided inside, by the server, on the read the modal makes when it opens; and
 * on an install with write-back turned down the same modal is where the link to
 * Planning Center now lives. One press either way, and the list is still
 * underneath when it closes.
 *
 * The dialog itself is not this button's to hold — see `ParentContactHost`.
 * These rows sit on lists that are still settling while somebody reads them,
 * and a row that owned its own dialog closed it the moment a background read
 * rewrote the list under it.
 */
import { Link } from 'react-router-dom';
import { useParentContactHost } from '@/features/students/parentContactHostContext';
import { cn } from '@/lib/utils';
import { studentFullName, type Student } from '@/types';

/** The warn-tinted pill these rows have always used. */
const PILL =
  'inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-warn-500/10 px-3 text-sm font-semibold ' +
  'text-warn-400 ring-1 ring-warn-500/25 hover:bg-warn-500/15';

export interface AddParentContactButtonProps {
  student: Student;
  /**
   * Called once a contact lands, for the list holding a "who can we reach"
   * answer that has just stopped being true. Everything Tally itself caches is
   * dropped by the modal without being asked.
   */
  onAdded?: () => void;
  className?: string;
}

export function AddParentContactButton({
  student,
  onAdded,
  className,
}: AddParentContactButtonProps) {
  const host = useParentContactHost();
  const name = studentFullName(student);

  /*
   * A student who exists only in Tally has no upstream record to hang an adult
   * off, so there is nothing for the form to write to and no point opening it.
   * Their profile is where the push lives, and it says so — the same place this
   * row has always sent them.
   */
  if (!student.pcoPersonId) {
    return (
      <Link
        to={`/students/${student.id}`}
        aria-label={`Add a contact for ${name}`}
        className={cn(PILL, className)}
      >
        <span aria-hidden="true">＋</span>
        Add a contact
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => host.open(student, onAdded)}
      aria-label={`Add a contact for ${name}`}
      className={cn(PILL, className)}
    >
      <span aria-hidden="true">＋</span>
      Add a contact
    </button>
  );
}
