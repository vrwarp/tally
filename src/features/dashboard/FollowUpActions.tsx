/**
 * Follow-up actions for a dashboard row (Journey 5, step 3).
 *
 * Journey 5 ends with "assign a counselor to follow up". Tally stores no
 * assignment: an ownership schema is one more thing that goes stale, and what
 * leaders actually do is phone one or two families and paste the rest into the
 * team group chat. So a row offers the two things a phone can do — dial and
 * text — and the list offers a clipboard copy for the chat.
 */
import { useState, type ReactNode } from 'react';
import { Button, Modal, Spinner } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { usePersonDetails } from '@/hooks/usePersonDetails';
import { cn, formatPhone } from '@/lib/utils';
import { AddParentContactButton } from '@/features/dashboard/AddParentContactButton';
import { buildContactList } from '@/features/dashboard/contactList';
import { backendLabelOf, studentFullName, type Student } from '@/types';

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

/**
 * "Contact parent", and the dialog behind it.
 *
 * The button is the row's; everything about *how* to reach the family is the
 * dialog's. That split is what lets a call list stay a list: the row carries a
 * name, a streak and one control, and the details — whose number this is, the
 * digits themselves, whether there is an email as well — arrive only for the
 * row somebody actually chose.
 *
 * `tel:` and `sms:` are protocols a desktop services unreliably, which is why
 * the number is printed here in full and selectable rather than hidden behind
 * the links: on a laptop, reading the digits *is* how a leader places the
 * call, and that used to be a `lg:`-only span squeezed beside the pills.
 */
function ContactParentButton({
  student,
  details,
}: {
  student: Student;
  details: { parentName?: string | null; parentPhone?: string | null; parentEmail?: string | null };
}) {
  const [open, setOpen] = useState(false);

  const name = studentFullName(student);
  const phone = details.parentPhone?.trim() ?? '';
  const email = details.parentEmail?.trim() ?? '';
  const parent = details.parentName?.trim() || `${name}'s parent`;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        leading={<span aria-hidden="true">📞</span>}
        onClick={() => setOpen(true)}
        /* The row says whose parent it is; the button's own label must too, or
           a screen reader on a call list hears a run of identical controls. */
        aria-label={`Contact parent for ${name}`}
      >
        Contact parent
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={parent}
        description={`About ${name}`}
        size="sm"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {phone ? (
            <div className="flex flex-col gap-3">
              {/* Selectable, and the largest thing in the dialog: on a laptop
                  this is the answer, not a fallback for one. */}
              <p className="text-center text-xl font-semibold tabular-nums text-ink-50">
                {formatPhone(phone)}
              </p>
              <div className="flex gap-2 [&>*]:flex-1">
                <ActionLink
                  href={`tel:${dialable(phone)}`}
                  label={`Call ${parent} about ${name} at ${formatPhone(phone)}`}
                  icon="📞"
                >
                  Call parent
                </ActionLink>
                <ActionLink
                  href={`sms:${dialable(phone)}`}
                  label={`Text ${parent} about ${name} at ${formatPhone(phone)}`}
                  icon="💬"
                >
                  Text parent
                </ActionLink>
              </div>
            </div>
          ) : null}

          {email ? (
            <div className="flex flex-col gap-3">
              <p className="break-all text-center text-sm text-ink-200">{email}</p>
              <ActionLink
                href={`mailto:${email}`}
                label={`Email ${parent} about ${name} at ${email}`}
                icon="✉"
              >
                Email parent
              </ActionLink>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

export interface FollowUpActionsProps {
  student: Student;
  className?: string;
  /**
   * Called when this row has just put a parent contact into Planning Center, so
   * a list holding its own "who can we reach" answer can ask again. The row
   * itself re-reads without being told.
   */
  onContactAdded?: () => void;
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
 *
 * ## Every label says "parent"
 *
 * None of these numbers belong to the student. Tally holds no contact details
 * for a 12-year-old and never will; what Planning Center hands back is an adult
 * in their household. A row that reads "Aaron Sun … Call" invites exactly the
 * wrong reading of that, and the row above it on the same card is a 6th grader.
 * So the buttons name who is on the other end. On the buttons rather than
 * beside them: this component sits in a row that folds onto one line on a
 * laptop, and every pixel spent there is taken from the student's name.
 */
export function FollowUpActions({ student, className, onContactAdded }: FollowUpActionsProps) {
  const { details, error, loaded, unavailable, retry, refresh } = usePersonDetails(student);

  const name = studentFullName(student);
  const label = backendLabelOf(student);
  const phone = details?.parentPhone?.trim() ?? '';
  const email = details?.parentEmail?.trim() ?? '';

  let body: ReactNode;

  if (unavailable) {
    body = (
      <p className="text-xs text-warn-400">
        Not in {label} yet, so there is nobody to call. Add them there to follow up.
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
        <Spinner /> Looking up parent contact…
      </p>
    );
  } else if (!details) {
    // Read, and Planning Center returned nobody: the person behind this student
    // was deleted or merged upstream. Distinct from "no contact on file", and
    // fixed in a different place.
    body = (
      <p className="text-xs text-warn-400">
        {label} no longer has a record for {name} — deleted or merged there. Nobody can follow up
        until that is sorted out.
      </p>
    );
  } else if (!phone && !email) {
    /*
     * The one state that is a job rather than a dead end, and the job is now
     * doable from here. It used to be a sentence pointing at Planning Center —
     * true, and a new tab away from a call list — but the read this row already
     * made is the same read the form needs, so the row can simply offer the
     * form. What opens is decided inside `ParentContactModal`: a number on the
     * adult on file, a parent and a household where there is neither, or the
     * pointer at Planning Center on an install that will not let Tally write.
     *
     * The pill alone, on the one line every other answer here fits on.
     *
     * It used to be a sentence with the pill under it, which made this the one
     * state taller than the rest — so a call list a leader had started reading
     * grew, row by row, as each row's lookup landed. Putting the sentence
     * beside the pill was not enough either: at the width this column has on a
     * laptop the two together wrap, which is the same extra line by another
     * route. The pill is not a poorer statement than the sentence was — it is
     * amber, it says "Add parent contact", and its label names the student —
     * and the incomplete-profiles card on the same screen has always offered
     * exactly this and nothing else.
     */
    body = (
      <AddParentContactButton
        student={student}
        onAdded={() => {
          // The row is looking at an answer its own write just made wrong.
          refresh();
          onContactAdded?.();
        }}
      />
    );
  } else {
    /*
     * One button, and the ways to reach the parent behind it.
     *
     * This used to be the affordances themselves — Call and Text side by side,
     * with the number printed beside them on a wide screen. Three things went
     * wrong with that, and all three are about the list rather than the row.
     * At 390px the two pills do not fit on one line, so every row wore them
     * stacked and stood about 200px tall: a call list showed three names, and
     * the whole job of this screen is scanning a dozen. On a laptop the pair
     * plus the digits claimed 378px of the row, which is why the student's own
     * name had to be capped to survive at 1280. And a third control had
     * nowhere to go — see the Resolve button in `MiaList`, which is what
     * forced the question.
     *
     * Collapsed, the row is one line at every width and the dialog says more
     * than the strip could: whose number it is, in full, with Call and Text as
     * targets the size of a thumb rather than pills squeezed into a column.
     * The cost is one tap before a call — paid once per call actually made,
     * where the old layout charged every row on the screen for the two people
     * a leader eventually rang.
     */
    body = <ContactParentButton student={student} details={details} />;
  }

  /*
   * Named and grouped, which matters more now than it did behind a button. The
   * button carried the student's name in its own label; a list that reveals
   * everything at once would otherwise read to a screen reader as a run of
   * loose phone numbers with nothing tying each to the student above it. Whose
   * number it is belongs in that name too — "contact details for Aaron Sun"
   * read as Aaron's own.
   */
  /*
   * `min-h-12 items-center`: the strip is one action-pill line tall from its
   * first frame, whatever it currently holds.
   *
   * Twelve rather than eleven because that is what the pills actually come to:
   * they are `inline-flex` at `min-h-11`, and an inline box carries its
   * line-height's leading on top of its own height.
   *
   * This row lands in stages — a spinner line, then whichever answer Planning
   * Center gives — and the answers are mostly 44px pills while the waiting
   * states are a line of small text. Sized by content, every row on a call
   * list grew ~24px as its lookup landed, one row at a time, under a leader
   * who had already started reading. Reserving the pill's height makes the
   * swap invisible: text states centre in the space the buttons will take.
   */
  return (
    <div
      role="group"
      aria-label={`Parent contact for ${name}`}
      className={cn('flex min-h-12 min-w-0 items-center', className)}
    >
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

  /*
   * Ghost, and small, to match `ExportCsvButton`.
   *
   * The two sit together in a card header, above a column of `Call`/`Text`
   * pills that act on one student. At secondary weight they were the same
   * object as those, so a list-level act and a student-level act wore one
   * uniform and only position told them apart. Both step down together: the
   * pair stays parallel, and the header reads as subordinate to its heading.
   */
  return (
    <Button
      variant="ghost"
      size="md"
      onClick={() => void copy()}
      disabled={students.length === 0}
      // The ring is the touch affordance `ghost` gives up; see `ExportCsvButton`.
      className="shrink-0 whitespace-nowrap ring-1 ring-ink-800"
    >
      Copy list
    </Button>
  );
}
