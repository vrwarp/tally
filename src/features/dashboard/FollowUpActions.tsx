/**
 * Follow-up actions for a dashboard row (Journey 5, step 3).
 *
 * Journey 5 ends with "assign a counselor to follow up". Tally stores no
 * assignment: an ownership schema is one more thing that goes stale, and what
 * leaders actually do is phone one or two families and paste the rest into the
 * team group chat. So a row offers the two things a phone can do — dial and
 * text — and the list offers a clipboard copy for the chat.
 */
import type { ReactNode } from 'react';
import { Button, Spinner } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { usePersonDetails } from '@/hooks/usePersonDetails';
import { pcoPersonUrl } from '@/lib/planningCenter';
import { cn, formatPhone } from '@/lib/utils';
import { buildContactList } from '@/features/dashboard/contactList';
import { studentFullName, type Student } from '@/types';

/** `tel:`/`sms:` want a dialable string, not "(555) 010-0100". */
function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

function ActionLink({
  href,
  label,
  icon,
  children,
}: {
  href: string;
  label: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-ink-800 px-3 text-sm font-semibold text-ink-100 ring-1 ring-ink-700 hover:bg-ink-700"
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </a>
  );
}

export interface FollowUpActionsProps {
  student: Student;
  className?: string;
}

/**
 * Contact affordances for one student.
 *
 * Tally does not hold parent contact details; Planning Center does, and they are
 * read one person at a time. That used to be spent as a feature: the row named
 * who to chase and offered to look up *how*, so a list of twenty students never
 * put twenty parents' phone numbers on a leader's phone at once. The reads are
 * cheap now — a cache in front of Planning Center absorbs them — and what is
 * left of the old design is a tap between a leader and the only thing the row
 * is for. So the row fetches on sight.
 *
 * The tap is gone; the honesty is not. Every state this can land in says which
 * one it is, because a row that resolves to nothing is a row somebody has to
 * work out by hand: no record upstream, no contact on the record, a Planning
 * Center that could not be reached. Each is a different thing to go and fix.
 *
 * A leader chasing a 9th grader on a Tuesday morning usually texts first and
 * calls if that goes nowhere, so a phone number gets both.
 */
export function FollowUpActions({ student, className }: FollowUpActionsProps) {
  const { details, error, loaded, unavailable, retry } = usePersonDetails(student);

  const name = studentFullName(student);
  const phone = details?.parentPhone?.trim() ?? '';
  const email = details?.parentEmail?.trim() ?? '';
  const parent = details?.parentName?.trim() || `${name}'s parent`;

  let body: ReactNode;

  if (unavailable) {
    body = (
      <p className="text-xs text-warn-400">
        Not in Planning Center yet, so there is nobody to call. Add them there to follow up.
      </p>
    );
  } else if (error) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-danger-400">{error}</p>
        <Button variant="ghost" size="sm" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  } else if (!loaded) {
    // Also the frame before the fetch starts, which is why this asks `loaded`
    // rather than `loading` — otherwise every row blinks through an empty state
    // on its way to the spinner.
    body = (
      <p className="flex items-center gap-2 text-xs text-ink-500">
        <Spinner /> Looking up contact details…
      </p>
    );
  } else if (!details) {
    // Read, and Planning Center returned nobody: the person behind this student
    // was deleted or merged upstream. Distinct from "no contact on file", and
    // fixed in a different place.
    body = (
      <p className="text-xs text-warn-400">
        Planning Center no longer has a record for {name} — deleted or merged there. Nobody can
        follow up until that is sorted out.
      </p>
    );
  } else if (!phone && !email) {
    /*
     * The one state that is a job rather than a dead end. Tally holds no parent
     * contact and cannot be given one, so the fix is upstream — but "the fix is
     * upstream" was for a while the entire row, a sentence on a list where the
     * row above it had a button. Saying where to go is the same information; a
     * link is that information somebody can act on with a thumb.
     */
    body = (
      <p className="text-xs text-warn-400">
        Planning Center has no parent contact for {name}.{' '}
        {student.pcoPersonId ? (
          <a
            href={pcoPersonUrl(student.pcoPersonId)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Add a parent contact for ${name} in Planning Center`}
            className="font-semibold underline"
          >
            Add one there
          </a>
        ) : (
          'Nobody can follow up until somebody adds one there.'
        )}
      </p>
    );
  } else if (phone) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <ActionLink
          href={`tel:${dialable(phone)}`}
          label={`Call ${parent} about ${name} at ${formatPhone(phone)}`}
          icon="📞"
        >
          Call
        </ActionLink>
        <ActionLink
          href={`sms:${dialable(phone)}`}
          label={`Text ${parent} about ${name} at ${formatPhone(phone)}`}
          icon="💬"
        >
          Text
        </ActionLink>
        <span className="text-xs tabular-nums text-ink-500">{formatPhone(phone)}</span>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <ActionLink
          href={`mailto:${email}`}
          label={`Email ${parent} about ${name} at ${email}`}
          icon="✉"
        >
          Email
        </ActionLink>
        <span className="min-w-0 truncate text-xs text-ink-500">{email}</span>
      </div>
    );
  }

  /*
   * Named and grouped, which matters more now than it did behind a button. The
   * button carried the student's name in its own label; a list that reveals
   * everything at once would otherwise read to a screen reader as a run of
   * loose phone numbers with nothing tying each to the student above it.
   */
  return (
    <div role="group" aria-label={`Contact details for ${name}`} className={cn('min-w-0', className)}>
      {body}
    </div>
  );
}

export interface CopyContactsButtonProps {
  students: readonly Student[];
  /** Heading pasted above the names, so the message explains itself. */
  title: string;
}

export function CopyContactsButton({ students, title }: CopyContactsButtonProps) {
  const { show } = useToast();

  const copy = async () => {
    // Absent on http origins and in a few in-app browsers; say so rather than
    // silently doing nothing.
    if (!navigator.clipboard) {
      show('Copying is blocked on this device.', { tone: 'error' });
      return;
    }

    try {
      // Names and grades only. Pulling contact details for everybody would mean
      // one Planning Center read per student to build a list that mostly gets
      // skimmed — and would put a screenful of parents' numbers on a clipboard.
      await navigator.clipboard.writeText(buildContactList(title, students));
      show(`Copied ${students.length} ${students.length === 1 ? 'name' : 'names'}`, {
        tone: 'success',
      });
    } catch {
      show('Could not copy to the clipboard.', { tone: 'error' });
    }
  };

  return (
    <Button
      variant="secondary"
      size="md"
      onClick={() => void copy()}
      disabled={students.length === 0}
    >
      Copy list
    </Button>
  );
}
