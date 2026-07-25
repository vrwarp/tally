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
import { Button } from '@/components/ui';
import { useToast } from '@/context/toastContext';
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
 * Contact affordances for one student, driven by whatever contact actually
 * exists. A phone gets both call and text — a leader chasing a 9th grader on a
 * Tuesday morning usually texts first and calls if that goes nowhere.
 */
export function FollowUpActions({ student, className }: FollowUpActionsProps) {
  const phone = student.parentPhone?.trim() ?? '';
  const email = student.parentEmail?.trim() ?? '';
  const name = studentFullName(student);
  const parent = student.parentName?.trim() || `${name}'s parent`;

  if (!phone && !email) {
    return (
      <p className={cn('text-xs text-warn-400', className)}>
        No parent contact on file — nobody can follow up until somebody adds one.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {phone ? (
        <>
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
        </>
      ) : (
        <>
          <ActionLink
            href={`mailto:${email}`}
            label={`Email ${parent} about ${name} at ${email}`}
            icon="✉"
          >
            Email
          </ActionLink>
          <span className="min-w-0 truncate text-xs text-ink-500">{email}</span>
        </>
      )}
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
