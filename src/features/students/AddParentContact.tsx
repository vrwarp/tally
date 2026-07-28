/**
 * The place Tally will write a family into Planning Center.
 *
 * Every screen that finds a student nobody can reach says so. This is the one
 * that can also fix it, and there are two different repairs behind that single
 * sentence — which one a leader is offered is decided by the server, never
 * guessed at here:
 *
 *   - `contactWritable`: Planning Center has an adult in the household and
 *     nobody has put a number on them. One form, two fields, done.
 *   - `parentCreatable`: there is no adult at all. That is not a missing field,
 *     it is a missing person, so the form asks for a name as well — and Tally
 *     creates the parent, and the household if there is none.
 *
 * Both arrive on the person details, and exactly one of them is ever true under
 * `PCO_WRITE_BACK=full`. Neither is true under any other mode, which is when
 * this goes back to being a pointer at Planning Center.
 *
 * ## Why adding a parent asks twice
 *
 * A church's parents are already in People — they attend — they are simply not
 * linked to their child's household. So the first Save is a question: the
 * server searches for adults of that name and hands back whoever it finds, and
 * only a person looking at that list decides whether this is the same David Kim
 * or a different one. Creating a duplicate is a merge somebody does by hand;
 * attaching a child to the wrong household shows one family another family's
 * phone number. Neither is a decision worth automating.
 */
import { useState, type FormEvent } from 'react';
import { Button, TextField } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { pcoPersonUrl } from '@/lib/planningCenter';
import { addParent, setParentContact, type ExistingPerson } from '@/services/functions';
import { studentFullName, type PcoPersonDetails, type Student } from '@/types';

export interface AddParentContactProps {
  student: Student;
  /** Null while the lookup is in flight or Planning Center has no such person. */
  details: PcoPersonDetails | null;
  /** Called after a write lands, so the screen re-reads what it now says. */
  onAdded: () => void;
}

/** Mirrors `normalizePhone` on the server, so a refusal happens before a round trip. */
function usablePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** Mirrors `normalizeEmail` on the server. */
function usableEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(raw.trim());
}

const MISSING = (
  <p className="mt-1 text-sm text-warn-400">
    Nothing in Planning Center — nobody can reach this family in an emergency.
  </p>
);

export function AddParentContact({ student, details, onAdded }: AddParentContactProps) {
  const [open, setOpen] = useState(false);

  /* ---- No upstream record at all ----------------------------------------- */
  if (!student.pcoPersonId) {
    return (
      <>
        {MISSING}
        <p className="mt-1 text-xs text-ink-500">
          Tally holds no parent contact of its own. Once this student reaches Planning Center, their
          contact details are added there.
        </p>
      </>
    );
  }

  const writable = details?.contactWritable === true;
  const creatable = details?.parentCreatable === true;

  /* ---- Tally may not write at all ---------------------------------------- */
  if (!writable && !creatable) {
    return (
      <>
        {MISSING}
        <p className="mt-1 text-xs text-ink-500">
          {details && !details.householdAdult
            ? // Write-back is turned down: the family still has to be built, and
              // Planning Center is the only place that can do it.
              'Planning Center has no adult in this household yet, so there is nobody to put a number on.'
            : 'Parent contact is kept in Planning Center.'}{' '}
          <a
            href={pcoPersonUrl(student.pcoPersonId)}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand-300 underline"
          >
            Add it there
          </a>
          .
        </p>
      </>
    );
  }

  if (!open) {
    return (
      <>
        {MISSING}
        {creatable ? (
          <p className="mt-1 text-xs text-ink-500">
            Planning Center has no adult in this household yet. Tally can add one.
          </p>
        ) : null}
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => setOpen(true)}>
          {creatable ? '＋ Add a parent' : '＋ Add parent contact'}
        </Button>
      </>
    );
  }

  const close = () => setOpen(false);

  return creatable ? (
    <ParentForm student={student} onClose={close} onAdded={onAdded} />
  ) : (
    <ContactForm student={student} details={details} onClose={close} onAdded={onAdded} />
  );
}

/* -------------------------------------------------------------------------- */
/* A number for the adult already on file                                      */
/* -------------------------------------------------------------------------- */

function ContactForm({
  student,
  details,
  onClose,
  onAdded,
}: {
  student: Student;
  details: PcoPersonDetails | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { show } = useToast();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const name = studentFullName(student);
  const phoneOk = phone.trim() === '' || usablePhone(phone);
  const emailOk = email.trim() === '' || usableEmail(email);
  /*
   * Both fields have to be *either* empty or good, not just one of them good.
   * The server drops what it cannot use and reports success on the rest, so a
   * mistyped number alongside a fine email would be silently discarded under a
   * green toast — and the number is the half somebody would want in an
   * emergency.
   */
  const valid = phoneOk && emailOk && (phone.trim() !== '' || email.trim() !== '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !valid) return;

    setBusy(true);
    setProblem(null);
    try {
      const response = await setParentContact({
        studentId: student.id,
        phone: phone.trim() || null,
        email: email.trim() || null,
      });

      // 'already-set' is not a failure and not a success: somebody filled this
      // in upstream while the form was open. Re-reading is the right response to
      // both, because in both cases the screen is now out of date.
      if (response.data.status === 'updated' || response.data.status === 'already-set') {
        show(response.data.message, {
          tone: response.data.status === 'updated' ? 'success' : 'info',
        });
        onClose();
        onAdded();
        return;
      }

      // Everything else is the server declining, and it says why in a sentence
      // meant for the person reading it.
      setProblem(response.data.message);
    } catch {
      setProblem('Could not reach Planning Center to add this. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-2 flex flex-col gap-3">
      <p className="text-xs text-ink-500">
        Saved onto {details?.parentName ?? `${name}'s parent`} in Planning Center. Either field is
        enough.
      </p>

      <TextField
        label="Parent phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        onChange={(changed) => setPhone(changed.target.value)}
        error={phoneOk ? null : 'That is not a number anybody could ring.'}
      />
      <TextField
        label="Parent email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(changed) => setEmail(changed.target.value)}
        error={emailOk ? null : 'That does not look like an email address.'}
      />

      {problem ? <p className="text-sm text-danger-400">{problem}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={busy} disabled={!valid}>
          Save to Planning Center
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onClose();
            setProblem(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* A parent, and a household to put them in                                    */
/* -------------------------------------------------------------------------- */

function ParentForm({
  student,
  onClose,
  onAdded,
}: {
  student: Student;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { show } = useToast();
  const [firstName, setFirstName] = useState('');
  // Right far more often than it is wrong, and wrong is one edit away. A blank
  // box here would have most leaders retyping the surname on the line above.
  const [lastName, setLastName] = useState(student.lastName);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Non-null once the server has said "these people already have this name". */
  const [candidates, setCandidates] = useState<ExistingPerson[] | null>(null);

  const phoneOk = phone.trim() === '' || usablePhone(phone);
  const emailOk = email.trim() === '' || usableEmail(email);
  const valid = firstName.trim() !== '' && phoneOk && emailOk;

  /**
   * One trip to the server, in whichever of its three shapes applies: an
   * opening ask, "it is this person", or "it is nobody you found".
   */
  const send = async (choice: { personId?: string; createNew?: boolean } = {}) => {
    setBusy(true);
    setProblem(null);
    try {
      const response = await addParent({
        studentId: student.id,
        personId: choice.personId ?? null,
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        createNew: choice.createNew === true,
      });

      if (response.data.status === 'existing-people') {
        setCandidates(response.data.candidates);
        return;
      }

      if (response.data.status === 'added') {
        show(response.data.message, { tone: 'success' });
        onClose();
        onAdded();
        return;
      }

      // 'already-has-adult' is the interesting one: somebody built this family
      // upstream while the form was open, so the screen is out of date rather
      // than wrong. Re-reading turns it back into the add-a-number case.
      if (response.data.status === 'already-has-adult') {
        show(response.data.message, { tone: 'info' });
        onClose();
        onAdded();
        return;
      }

      setProblem(response.data.message);
    } catch {
      setProblem('Could not reach Planning Center to add this. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  /* ---- "Planning Center already has somebody by that name" ---------------- */
  if (candidates && candidates.length > 0) {
    return (
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-sm text-ink-200">
          Planning Center already has {candidates.length === 1 ? 'this person' : 'these people'} by
          that name. Adding {student.firstName} to their household is almost always what you want —
          a second record for the same parent has to be merged by hand later.
        </p>

        <ul className="flex flex-col gap-2">
          {candidates.map((candidate) => (
            <li
              key={candidate.pcoPersonId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink-800/60 px-3 py-2"
            >
              <span className="text-sm text-ink-100">
                {candidate.name}
                <span className="block text-xs text-ink-500">
                  {candidate.reachable
                    ? 'Already has contact details in Planning Center'
                    : 'No contact details on file yet'}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() => void send({ personId: candidate.pcoPersonId })}
              >
                This is them
              </Button>
            </li>
          ))}
        </ul>

        {problem ? <p className="text-sm text-danger-400">{problem}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" loading={busy} onClick={() => void send({ createNew: true })}>
            None of these — add a new person
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && valid) void send();
      }}
      className="mt-2 flex flex-col gap-3"
    >
      <p className="text-xs text-ink-500">
        Added to Planning Center as an adult in {student.firstName}&rsquo;s household, and the
        household itself if there is not one yet. A phone number or email is optional now and can be
        added later.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Parent first name"
          value={firstName}
          onChange={(changed) => setFirstName(changed.target.value)}
          autoCapitalize="words"
          autoComplete="off"
          required
        />
        <TextField
          label="Parent last name"
          value={lastName}
          onChange={(changed) => setLastName(changed.target.value)}
          autoCapitalize="words"
          autoComplete="off"
        />
      </div>

      <TextField
        label="Parent phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        onChange={(changed) => setPhone(changed.target.value)}
        error={phoneOk ? null : 'That is not a number anybody could ring.'}
      />
      <TextField
        label="Parent email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(changed) => setEmail(changed.target.value)}
        error={emailOk ? null : 'That does not look like an email address.'}
      />

      {problem ? <p className="text-sm text-danger-400">{problem}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={busy} disabled={!valid}>
          Save to Planning Center
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onClose();
            setProblem(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
