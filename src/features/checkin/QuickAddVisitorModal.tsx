/**
 * Journey 3: a student nobody has ever seen walks in.
 *
 * Three fields, one button, done. That is still the whole of the fast path, and
 * the ordering below is deliberate: nothing about a parent is on screen until
 * somebody asks for it, because a door volunteer with six people behind them is
 * answering "who is this?" and nothing else.
 *
 * ## Why there is a fourth thing at all
 *
 * Because the counselor is very often standing next to the adult who brought
 * the child, and until now the only thing Tally could do with "I'm Dara's mum,
 * it's 555-0134" was nothing. The number went on the back of a hand and the
 * profile sat in the incomplete list until somebody rang round on Tuesday —
 * which is the list this app exists to shorten. Asking *once*, optionally,
 * behind a disclosure, costs the queue nothing and is the difference between a
 * reachable family and a follow-up call nobody makes.
 *
 * What it is not is a decision. Tally holds no parent contact on a student —
 * `noMirroredPersonalData` in `firestore.rules` forbids it, permanently — so
 * what is typed here goes onto a review record and a core-team member decides
 * which David Kim it is on a Tuesday, on the Review screen, with the church's
 * database in front of them. See functions/src/kiosk/visitorParent.ts.
 *
 * Everything else about this person — allergies, an email, a second parent — is
 * still the core team's problem later, and the incomplete profile is still the
 * handoff signal.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Button, Modal, PhoneField, SelectField, TextField } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { gradeDescription, haptic } from '@/lib/utils';
import { quickAddAndCheckIn } from '@/services/attendance';
import { recordVisitorParent } from '@/services/functions';
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

/**
 * The id this press submits the parent under, reused if it has to be retried.
 *
 * The server claims the record with `create()`, so a call whose answer was lost
 * cannot leave a second copy of one family's number behind. `randomUUID` needs
 * a secure context; the fallback is for a test renderer and an http LAN
 * address, where uniqueness within one device is all it has to buy.
 */
function newRegistrationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Ten digits, however they were punctuated. Mirrors the server's rule. */
function phoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
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
  /** Whether the parent questions exist on screen at all. Never open by default. */
  const [askingParent, setAskingParent] = useState(false);
  const [parentFirst, setParentFirst] = useState('');
  const [parentLast, setParentLast] = useState('');
  const [contactPhone, setParentPhone] = useState('');
  const [errors, setErrors] = useState<{
    firstName?: string;
    lastName?: string;
    parentFirst?: string;
    parentLast?: string;
    contactPhone?: string;
  }>({});

  useEffect(() => {
    if (!open) return;
    const parts = (initialName ?? '').trim().split(/\s+/).filter(Boolean);
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
    setGrade(defaultGrade(event));
    setAskingParent(false);
    setParentFirst('');
    setParentLast('');
    setParentPhone('');
    setErrors({});
  }, [open, initialName, event]);

  /*
   * Whether anybody has actually answered the parent questions.
   *
   * Opening the section is not answering it: a counselor who taps "Add parent
   * contact", is handed the child instead and taps Save must not be stopped by
   * a required field they never asked for. A name or a number in the boxes is
   * what turns it into an answer — and once it is one, all of it is required,
   * because half a parent is a record nobody can ring.
   */
  const parentAnswered =
    askingParent && (parentFirst.trim() !== '' || phoneDigits(contactPhone) !== '');

  const openParent = () => {
    setAskingParent(true);
    // Right far more often than it is wrong, and one edit away when it is not.
    if (parentLast.trim() === '') setParentLast(lastName.trim());
  };

  const handleSubmit = (submitted: FormEvent<HTMLFormElement>) => {
    submitted.preventDefault();

    const first = firstName.trim();
    const last = lastName.trim();
    const guardianFirst = parentFirst.trim();
    const guardianLast = parentLast.trim();
    const digits = phoneDigits(contactPhone);

    const found = {
      firstName: first ? undefined : 'Required',
      lastName: last ? undefined : 'Required',
      parentFirst: !parentAnswered || guardianFirst ? undefined : 'Required',
      parentLast: !parentAnswered || guardianLast ? undefined : 'Required',
      /*
       * Ten digits or nothing. A name with no number leaves the family exactly
       * as unreachable as they were, which is the one thing this section exists
       * to change — and the four digits at the end of it are what the family
       * will type at the lobby kiosk next Sunday.
       */
      contactPhone: !parentAnswered
        ? undefined
        : digits.length === 10
          ? undefined
          : 'A 10-digit number',
    };
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      return;
    }

    const name = `${first} ${last}`;
    const guardian = parentAnswered
      ? { firstName: guardianFirst, lastName: guardianLast, phone: digits }
      : null;
    const registrationId = newRegistrationId();

    // Close and confirm before the write resolves: Firestore caches the batch
    // locally and the roster listener echoes it back within a frame, so waiting
    // here would only hold the counselor at a spinner.
    onClose();
    haptic();
    show(`${name} added and checked in`, { tone: 'success' });
    onAdded?.(name);

    void (async () => {
      let studentId: string;
      try {
        studentId = await quickAddAndCheckIn({
          draft: { firstName: first, lastName: last, grade },
          event,
          uid,
        });
      } catch {
        show(`Could not save ${name}. Please add them again.`, { tone: 'error' });
        return;
      }

      if (guardian === null) return;

      /*
       * Its own failure, reported as its own sentence. The child is on the
       * roster and checked in by this point whatever happens next, and a toast
       * that said "could not save Maya" because a phone number did not land
       * would send a counselor back to add a student who is already there.
       */
      try {
        await recordVisitorParent({
          studentId,
          registrationId,
          guardian,
          eventId: event.id,
        });
      } catch {
        show(`${first} is checked in, but the parent contact did not save.`, { tone: 'error' });
      }
    })();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a visitor"
      description="A parent contact is optional, and goes to the core team to add."
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

        {/*
          Below the button, always. The three fields above are the job; this is
          the thing a counselor does when the parent happens to be standing
          there, and it must never be between a thumb and Save.
        */}
        {askingParent ? (
          /*
            A nested panel on the modal's own ground, on the same rung the
            review card's notices use: enough separation to read as "a second
            thing", not enough to read as a second dialog.
          */
          <fieldset className="flex flex-col gap-4 rounded-xl bg-ink-800/40 p-3 ring-1 ring-ink-700">
            <legend className="sr-only">Parent contact</legend>

            {/*
              The boxes first, the reason underneath. The reason is read once
              and never again; the boxes are why the section was opened, and
              three lines of explanation above them pushed the phone field down
              toward the keyboard on a 390px screen.
            */}
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Parent first name"
                value={parentFirst}
                onChange={(changed) => setParentFirst(changed.target.value)}
                error={errors.parentFirst ?? null}
                autoCapitalize="words"
                autoComplete="off"
                enterKeyHint="next"
              />
              <TextField
                label="Parent last name"
                value={parentLast}
                onChange={(changed) => setParentLast(changed.target.value)}
                error={errors.parentLast ?? null}
                autoCapitalize="words"
                autoComplete="off"
                enterKeyHint="next"
              />
            </div>
            <PhoneField
              label="Parent phone"
              value={contactPhone}
              onValueChange={setParentPhone}
              error={errors.contactPhone ?? null}
              autoComplete="tel"
              enterKeyHint="done"
            />

            <div className="flex items-end justify-between gap-3">
              <p className="text-xs text-ink-500">
                Held for the core team to add. Tally keeps no parent details on a student.
              </p>
              {/*
                A way back out, because the section is optional and a counselor
                who opened it by mistake should not have to empty three boxes to
                get past it. Clearing on the way is the point: what is on screen
                is what will be sent.
              */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-mb-1 -mr-2 shrink-0"
                onClick={() => {
                  setAskingParent(false);
                  setParentFirst('');
                  setParentLast('');
                  setParentPhone('');
                  setErrors((held) => ({
                    ...held,
                    parentFirst: undefined,
                    parentLast: undefined,
                    contactPhone: undefined,
                  }));
                }}
              >
                Remove
              </Button>
            </div>
          </fieldset>
        ) : (
          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={openParent}>
            ＋ Add parent contact
          </Button>
        )}
      </form>
    </Modal>
  );
}
