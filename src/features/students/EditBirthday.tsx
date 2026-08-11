/**
 * Filling in or correcting a birthday, from inside Tally.
 *
 * Tally used to say — on the badge, and on the student editor — that this was
 * Planning Center's field and a leader should go and edit it there. That is true
 * about *ownership* and was being used to justify a dead end: a leader standing
 * in front of the student who has just said when their birthday is had to open
 * another product, find the person again, and type it there. Under
 * `PCO_WRITE_BACK=full` the church has already said Tally may write to people it
 * is linked to, and this is a smaller claim than the name.
 *
 * One box rather than a date picker or three controls, and an optional year: the
 * argument for that shape is in `lib/birthdayField.ts`, and the reading of what
 * gets typed into it is in `lib/birthdayInput.ts`. This file is the drawing of
 * it, plus the one screen that has to own its own Save.
 */
import { useState } from 'react';
import { Button, MaskedField } from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useToast } from '@/context/toastContext';
import { invalidatePersonDetails } from '@/hooks/usePersonDetails';
import { birthdayFieldFrom, describeBirthdayField, readBirthdayField } from '@/lib/birthdayField';
import { birthdayMaskGhost, formatBirthdayInput } from '@/lib/birthdayInput';
import { enqueueUpstreamEdit } from '@/services/upstreamEdits';
import { backendLabelOf, type Student } from '@/types';

export interface BirthdayFieldProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * What Planning Center holds: `YYYY-MM-DD` where the details read has been
   * given a year, `MM-DD` where only the roster's day is known, and null when
   * there is no birthdate at all.
   */
  onFile: string | null;
  /** A refusal from a save attempt, which outranks the live reading below. */
  error?: string | null;
  disabled?: boolean;
  /** Injectable so a test can decide which years are in the future. */
  now?: Date;
}

/**
 * One box that punctuates itself, over a sentence that keeps up with the typing.
 *
 * The three controls this replaced — a month dropdown, a day box, a year box —
 * were the database's shape rather than a person's. Nobody says a birthday in
 * three fields; they say "December the fourteenth", and on a phone at a door
 * they type `1214`. So the box takes digits and puts the slashes in itself, and
 * draws the rest of `MM / DD / YYYY` faded behind what is still to come — the
 * shape is answered rather than asked for.
 *
 * The sentence underneath is the other half. `1214` and `112` are readings of
 * what somebody meant, and a reading made silently is one nobody can correct, so
 * the date is printed in words before anybody presses Save. It goes through
 * `hint` and `error` rather than a paragraph of its own so that the control is
 * described by it, turns red with it, and reads like every other field here.
 */
export function BirthdayField({
  value,
  onChange,
  onFile,
  error,
  disabled,
  now,
}: BirthdayFieldProps) {
  const note = describeBirthdayField(value, { onFile, now });
  const wrong = error ?? (note.tone === 'bad' ? note.say : null);

  return (
    <MaskedField
      label="Birthday"
      value={value}
      onValueChange={onChange}
      format={formatBirthdayInput}
      ghost={birthdayMaskGhost(value)}
      disabled={disabled}
      // Digits are the whole vocabulary now, so a numeric keypad is the right
      // one — and it is the keyboard this is used on, at a door, one-handed.
      inputMode="numeric"
      autoComplete="off"
      // A full `MM / DD / YYYY`. The formatter refuses to return more; this
      // stops the browser accepting a longer paste first.
      maxLength={14}
      className="tabular-nums"
      hint={wrong ? undefined : note.say}
      error={wrong}
    />
  );
}

export interface EditBirthdayProps {
  student: Student;
  /**
   * The whole date Planning Center holds, from the host's person details —
   * `YYYY-MM-DD`, or `MM-DD` when nobody upstream knows the year, or null for
   * no birthdate at all.
   *
   * Passed in rather than read here because every host of this already has the
   * details in hand: the gate that decides whether to render this at all is on
   * the same object. Omitted, this falls back to the roster's day, which is the
   * most any screen without them knows.
   */
  onFile?: string | null;
  /**
   * Called after a write lands, for a host that stays on screen and is showing
   * the year — which only the memoised details hold, and which this has just
   * dropped. Not `onDone`: that one is Cancel too, and a cancelled edit has
   * nothing to re-read.
   */
  onSaved?: () => void;
  /** Closes whatever is hosting this, once the write has landed. */
  onDone: () => void;
}

/**
 * The fields plus their own Save, for the roster badge — which is where somebody
 * notices a birthday is wrong or missing, and where there is no other form to
 * hang this off.
 */
export function EditBirthday({ student, onFile, onSaved, onDone }: EditBirthdayProps) {
  const { show } = useToast();
  const { user, profile } = useAuth();
  // `undefined` is "the host has no details", not "no birthdate": a host that
  // has read Planning Center and found none passes null, and both open blank.
  const held = onFile === undefined ? student.birthday : onFile;
  const [text, setText] = useState<string>(() => birthdayFieldFrom(held));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const read = readBirthdayField(text, { onFile: held });
    if (!read.ok) {
      setProblem(read.error);
      return;
    }
    if (read.value === undefined) {
      // Nothing to send. Closing rather than reporting it: the leader either
      // typed the day already on file or typed nothing, and both mean "done".
      onDone();
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      /*
       * Queued, exactly as the editor's Save is, and for the same reason.
       *
       * This panel used to block on the backend confirming the write, on the
       * grounds that it is the part somebody is entitled to wait for. That was
       * true when it was the only such path; it stopped being true the moment
       * the editor stopped waiting, because a leader would then meet two
       * behaviours for the same field depending on which control they reached
       * it through — and this is the control they reach it through at a door.
       *
       * The roster corrects itself from the job rather than from a write's
       * answer: `applyPendingEdits` draws the typed day, marked as not upstream
       * yet, until the drain lands it.
       */
      await enqueueUpstreamEdit({
        studentId: student.id,
        patch: { birthday: read.value },
        ...(held ? { baseline: { birthday: held } } : { baseline: {} }),
        uid: user?.uid ?? '',
        authorName: profile?.displayName ?? user?.email ?? 'Somebody',
      });
      invalidatePersonDetails(student.id);
      onSaved?.();
      show(`Saving ${student.firstName}\u2019s birthday to ${backendLabelOf(student)}.`);
      onDone();
    } catch {
      setProblem(`${backendLabelOf(student)} could not be reached. Nothing was changed.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <BirthdayField
        value={text}
        onChange={(changed) => {
          setProblem(null);
          setText(changed);
        }}
        onFile={held}
        error={problem}
        disabled={busy}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy}>
          Save to {backendLabelOf(student)}
        </Button>
      </div>
    </div>
  );
}
