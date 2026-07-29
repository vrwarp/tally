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
 * Three boxes rather than a date picker, and an optional year: the whole argument
 * for that shape is in `lib/birthdayFields.ts`, which is also where the reading
 * of them lives. This file is the drawing of them, plus the one screen that has
 * to own its own Save.
 */
import { useId, useState } from 'react';
import { format } from 'date-fns';
import { Button, SelectField, TextField } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import {
  birthdayFieldsFrom,
  readBirthdayFields,
  type BirthdayFieldsState,
} from '@/lib/birthdayFields';
import { updateStudentProfile } from '@/services/functions';
import type { Student } from '@/types';

/** Month names in the reader's own locale, for the dropdown. */
const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  // Any year: only the month name is read off it.
  label: format(new Date(2024, index, 1), 'MMMM'),
}));

export interface BirthdayFieldsProps {
  fields: BirthdayFieldsState;
  onChange: (fields: BirthdayFieldsState) => void;
  /** Null when Planning Center has no birthdate, which makes the year required. */
  onFile: string | null;
  error?: string | null;
  disabled?: boolean;
}

/**
 * Month on its own line, then day and year side by side.
 *
 * Three controls in one row clipped "September" in the narrow modal the roster
 * badge opens, and a month a leader cannot read is worse than a taller form. The
 * year comes last and stays optional, because it is the box they most often have
 * no answer for.
 *
 * A `fieldset` rather than three loose fields: "Day" and "Year" mean nothing on
 * their own, and somebody moving through the form with a screen reader has to be
 * told what the three of them are between them. The legend sits outside the flex
 * container it labels, because `<legend>` in a flex parent is laid out by rules
 * of its own.
 */
export function BirthdayFields({
  fields,
  onChange,
  onFile,
  error,
  disabled,
}: BirthdayFieldsProps) {
  const hintId = useId();
  const set = <K extends keyof BirthdayFieldsState>(key: K, value: string) =>
    onChange({ ...fields, [key]: value });
  const digits = (raw: string, length: number) => raw.replace(/\D/g, '').slice(0, length);

  return (
    <fieldset className="min-w-0" aria-describedby={hintId}>
      <legend className="mb-1.5 text-sm font-medium text-ink-300 pointer-fine:mb-1 pointer-fine:text-xs">
        Birthday
      </legend>
      <div className="flex flex-col gap-2">
        <SelectField
          label="Month"
          value={fields.month}
          onChange={(changed) => set('month', changed.target.value)}
          disabled={disabled}
        >
          <option value="">—</option>
          {MONTHS.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Day"
            value={fields.day}
            onChange={(changed) => set('day', digits(changed.target.value, 2))}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="off"
            placeholder="14"
          />
          <TextField
            label="Year"
            value={fields.year}
            onChange={(changed) => set('year', digits(changed.target.value, 4))}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="off"
            placeholder="2011"
          />
        </div>
      </div>
      {error ? (
        <p id={hintId} className="mt-1.5 text-xs leading-snug text-danger-400">
          {error}
        </p>
      ) : (
        <p id={hintId} className="mt-1.5 text-xs leading-snug text-ink-500">
          {onFile === null
            ? 'Saved in Planning Center. It needs the whole date the first time, so the year is required.'
            : 'Saved in Planning Center. Leave the year blank to keep the one it holds — Tally is never sent the year.'}
        </p>
      )}
    </fieldset>
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
  const [fields, setFields] = useState<BirthdayFieldsState>(() =>
    birthdayFieldsFrom(student.birthday),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const read = readBirthdayFields(fields, { onFile: student.birthday });
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
      <BirthdayFields
        fields={fields}
        onChange={(changed) => {
          setProblem(null);
          setFields(changed);
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
