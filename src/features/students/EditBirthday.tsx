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
import { Button, TextField } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { birthdayFieldFrom, describeBirthdayField, readBirthdayField } from '@/lib/birthdayField';
import { updateStudentProfile } from '@/services/functions';
import type { Student } from '@/types';

export interface BirthdayFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Null when Planning Center holds no birthdate for them. */
  onFile: string | null;
  /** A refusal from a save attempt, which outranks the live reading below. */
  error?: string | null;
  disabled?: boolean;
  /** Injectable so a test can decide which years are in the future. */
  now?: Date;
}

/**
 * One box, and a sentence under it that keeps up with the typing.
 *
 * The three controls this replaced — a month dropdown, a day box, a year box —
 * were the database's shape rather than a person's. Nobody says a birthday in
 * three fields; they say "December the fourteenth", and on a phone at a door
 * they type `1214`. Reading that takes a parser, and a parser that guesses
 * silently is worse than the dropdown was — so the guess is printed under the
 * box, in words, before anybody presses Save.
 *
 * The sentence goes through `hint` and `error` rather than a paragraph of its
 * own so that the control is described by it, turns red with it, and reads the
 * same as every other field in the app.
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
    <TextField
      label="Birthday"
      value={value}
      onChange={(changed) => onChange(changed.target.value)}
      disabled={disabled}
      // A numeric keypad is the right one at a door: `1214` is the fastest way
      // to say this, and the parser is built around it. A physical keyboard
      // ignores the hint, so "14 Dec 2011" still works wherever there is one.
      inputMode="numeric"
      autoComplete="off"
      placeholder="12/14/2011"
      hint={wrong ? undefined : note.say}
      error={wrong}
    />
  );
}

export interface EditBirthdayProps {
  student: Student;
  /** Closes whatever is hosting this, once the write has landed. */
  onDone: () => void;
}

/**
 * The fields plus their own Save, for the roster badge — which is where somebody
 * notices a birthday is wrong or missing, and where there is no other form to
 * hang this off.
 */
export function EditBirthday({ student, onDone }: EditBirthdayProps) {
  const { show } = useToast();
  const { refreshRoster } = useData();
  const [text, setText] = useState<string>(() => birthdayFieldFrom(student.birthday));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const read = readBirthdayField(text, { onFile: student.birthday });
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
      const response = await updateStudentProfile({ studentId: student.id, birthday: read.value });
      if (response.data.status !== 'updated' && response.data.status !== 'unchanged') {
        setProblem(response.data.message);
        return;
      }
      /*
       * The roster is where every screen's copy of a linked student's birthday
       * comes from — including the row behind this panel — so refreshing it is
       * all that is needed to make the screen agree with itself. Nothing in the
       * memoised person details holds a birthday.
       */
      await refreshRoster(true);
      show(response.data.status === 'updated' ? response.data.message : 'Already up to date.');
      onDone();
    } catch {
      setProblem('Planning Center could not be reached. Nothing was changed.');
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
        onFile={student.birthday}
        error={problem}
        disabled={busy}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy}>
          Save to Planning Center
        </Button>
      </div>
    </div>
  );
}
