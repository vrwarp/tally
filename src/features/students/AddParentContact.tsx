/**
 * The one place Tally will write a parent's phone number into Planning Center.
 *
 * Every other screen that finds a student nobody can reach says so and points
 * upstream, which is honest but is also a leader retyping a number into a second
 * website on a phone. This does it in place — under two conditions the server
 * decides, never the browser:
 *
 *   - `PCO_WRITE_BACK=full`. Not the default, and a church that has not asked
 *     for it gets the pointer it always got.
 *   - Planning Center already has an adult in the student's household. Tally
 *     will not invent a parent; a household with nobody in it is a family
 *     somebody has to build upstream, and this says so rather than offering a
 *     form that would fail.
 *
 * Both arrive as `contactWritable` on the person details, so this component
 * never guesses at either.
 */
import { useState, type FormEvent } from 'react';
import { Button, TextField } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { pcoPersonUrl } from '@/lib/planningCenter';
import { setParentContact } from '@/services/functions';
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

export function AddParentContact({ student, details, onAdded }: AddParentContactProps) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const missing = (
    <p className="mt-1 text-sm text-warn-400">
      Nothing in Planning Center — nobody can reach this family in an emergency.
    </p>
  );

  /* ---- No upstream record at all ----------------------------------------- */
  if (!student.pcoPersonId) {
    return (
      <>
        {missing}
        <p className="mt-1 text-xs text-ink-500">
          Tally holds no parent contact of its own. Once this student reaches Planning Center, their
          contact details are added there.
        </p>
      </>
    );
  }

  /* ---- Upstream, but Tally may not write --------------------------------- */
  if (!details?.contactWritable) {
    return (
      <>
        {missing}
        <p className="mt-1 text-xs text-ink-500">
          {details && !details.householdAdult
            ? // A different job from adding a number, and it cannot be done from
              // here: there is nobody in this household to put one on.
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

  /* ---- Tally may write --------------------------------------------------- */
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
        setOpen(false);
        setPhone('');
        setEmail('');
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

  if (!open) {
    return (
      <>
        {missing}
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => setOpen(true)}>
          ＋ Add parent contact
        </Button>
      </>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-2 flex flex-col gap-3">
      <p className="text-xs text-ink-500">
        Saved onto {details.parentName ?? `${name}'s parent`} in Planning Center. Either field is
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
            setOpen(false);
            setProblem(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
