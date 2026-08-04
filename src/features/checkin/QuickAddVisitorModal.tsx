/**
 * Journey 3: a student nobody has ever seen walks in.
 *
 * Three fields, one button, done. Everything else about this person — parent
 * contact, allergies — is the core team's problem later; asking a
 * door volunteer for it while six people wait behind is how a queue stalls. The
 * incomplete profile is the handoff signal, so leaving it incomplete is correct.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Button, Modal, SelectField, TextField } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { gradeDescription, haptic } from '@/lib/utils';
import { quickAddAndCheckIn } from '@/services/attendance';
import { GRADES, type Grade, type TallyEvent } from '@/types';

/**
 * What the grade field opens on.
 *
 * A youth ministry gets the middle of its band, which is one fewer tap for
 * most of the students walking in. A gathering that hands children back opens
 * on no grade at all: a nursery child has none to type, and making a volunteer
 * clear the field forty times a morning is the same mistake as making them
 * reach for undo.
 */
function defaultGrade(event: Pick<TallyEvent, 'requiresCheckOut'>): Grade | null {
  return event.requiresCheckOut ? null : 9;
}

export interface QuickAddVisitorModalProps {
  open: boolean;
  onClose: () => void;
  event: TallyEvent;
  uid: string;
  /** Seeds the name fields from whatever the counselor already typed in search. */
  initialName?: string;
  /** Lets the page announce the add in its aria-live region. */
  onAdded?: (name: string) => void;
}

export function QuickAddVisitorModal({
  open,
  onClose,
  event,
  uid,
  initialName,
  onAdded,
}: QuickAddVisitorModalProps) {
  const { show } = useToast();
  const formId = useId();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [grade, setGrade] = useState<Grade | null>(() => defaultGrade(event));
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string }>({});

  useEffect(() => {
    if (!open) return;
    const parts = (initialName ?? '').trim().split(/\s+/).filter(Boolean);
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
    setGrade(defaultGrade(event));
    setErrors({});
  }, [open, initialName, event]);

  const handleSubmit = (submitted: FormEvent<HTMLFormElement>) => {
    submitted.preventDefault();

    const first = firstName.trim();
    const last = lastName.trim();
    if (!first || !last) {
      setErrors({
        firstName: first ? undefined : 'Required',
        lastName: last ? undefined : 'Required',
      });
      return;
    }

    const name = `${first} ${last}`;

    // Close and confirm before the write resolves: Firestore caches the batch
    // locally and the roster listener echoes it back within a frame, so waiting
    // here would only hold the counselor at a spinner.
    onClose();
    haptic();
    show(`${name} added and checked in`, { tone: 'success' });
    onAdded?.(name);

    void quickAddAndCheckIn({
      draft: { firstName: first, lastName: last, grade },
      event,
      uid,
    }).catch(() => {
      show(`Could not save ${name}. Please add them again.`, { tone: 'error' });
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a visitor"
      description="The core team fills in parent contact details later."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="lg">
            Save &amp; check in
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          label="First name"
          value={firstName}
          onChange={(changed) => setFirstName(changed.target.value)}
          error={errors.firstName ?? null}
          autoCapitalize="words"
          autoComplete="off"
          enterKeyHint="next"
          required
        />
        <TextField
          label="Last name"
          value={lastName}
          onChange={(changed) => setLastName(changed.target.value)}
          error={errors.lastName ?? null}
          autoCapitalize="words"
          autoComplete="off"
          enterKeyHint="done"
          required
        />
        <SelectField
          label="Grade"
          value={grade ?? ''}
          onChange={(changed) =>
            setGrade(changed.target.value === '' ? null : (Number(changed.target.value) as Grade))
          }
        >
          {/* A real answer, not a blank one to be filled in later: a child too
              young for a grade has none, and the document simply omits it. */}
          <option value="">No grade</option>
          {GRADES.map((value) => (
            <option key={value} value={value}>
              {gradeDescription(value)}
            </option>
          ))}
        </SelectField>
      </form>
    </Modal>
  );
}
