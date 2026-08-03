/**
 * Create or edit one student.
 *
 * The interesting constraint is Planning Center. Once a student is linked, the
 * fields listed in `PCO_MANAGED_STUDENT_FIELDS` are owned there, and what this
 * form may do about that is a *setting* rather than a rule:
 *
 *   - Under `create` — the default — anything typed into them would be silently
 *     reverted by the next read, because Tally keeps no copy and the roster is
 *     Planning Center's answer. A form that accepts an edit it cannot keep is
 *     worse than one that refuses it, so those inputs render disabled with a
 *     link to the place the edit actually belongs.
 *   - Under `full` the church has asked Tally to write, so the same boxes are
 *     editable and Save carries them straight upstream through
 *     `updateStudentProfile`. Nothing is written to Firestore on the way: a
 *     linked student's name, grade, birthday and allergies are Planning Center's,
 *     and a copy kept here would be shown by nothing and pushed back over a later
 *     correction.
 *
 * Which of the two is in force is `profileWritable` on the person details —
 * answered by the server, because the browser cannot see the setting. Everything
 * Tally owns — notes — stays editable in both.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  Button,
  ErrorBanner,
  Modal,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/ui';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { useToast } from '@/context/toastContext';
import { AddParentContact } from '@/features/students/AddParentContact';
import { BirthdayField } from '@/features/students/EditBirthday';
import { invalidateAllergyNotes } from '@/hooks/useAllergyNotes';
import { invalidatePersonDetails, usePersonDetails } from '@/hooks/usePersonDetails';
import {
  BLANK_BIRTHDAY_FIELD,
  birthdayFieldFrom,
  readBirthdayField,
} from '@/lib/birthdayField';
import { pcoPersonUrl } from '@/lib/planningCenter';
import { formatPhone, ordinalGrade } from '@/lib/utils';
import { updateStudentProfile } from '@/services/functions';
import { createStudent, updateStudent, type StudentDraft } from '@/services/students';
import {
  GRADES,
  PCO_MANAGED_STUDENT_FIELDS,
  composeFirstName,
  splitFirstName,
  studentFullName,
  type Grade,
  type PcoPersonDetails,
  type Student,
  type StudentStatus,
} from '@/types';

function isPcoManaged(field: keyof Student): boolean {
  return (PCO_MANAGED_STUDENT_FIELDS as readonly string[]).includes(field);
}

/**
 * `firstName` and `nickname` are two boxes here and one field on the student.
 *
 * Planning Center's own edit form splits them, and `Student.firstName` holds
 * the composite it builds — so offering a single box would mean asking a leader
 * to type the quotes themselves, and getting a name Planning Center cannot
 * store back if they typed them wrong.
 */
interface FormState {
  firstName: string;
  nickname: string;
  lastName: string;
  /**
   * Null for a linked student Planning Center holds no grade for — nothing
   * selected, rather than the bottom of the range.
   *
   * The number on their row is where the sync's clamp landed, not a grade
   * anybody holds (see `gradeLabel`). Opening the form on it would have a
   * leader press Save on a 6th grade they never chose, and under
   * `PCO_WRITE_BACK=full` that writes the 6 onto a grown adult upstream. Null
   * means "not part of this edit", exactly as `undefined` does on the patch
   * `updateStudentProfile` takes.
   */
  grade: Grade | null;
  /** Planning Center's `medical_notes`. Only ever editable on a linked student. */
  allergies: string;
  /**
   * Planning Center's `birthdate`, as one box of text. Seeded from the roster's
   * day and re-seeded with the year when the details read lands, since that is
   * the only thing that carries one. See `lib/birthdayField.ts`.
   */
  birthday: string;
  notes: string;
  status: StudentStatus;
}

const BLANK: FormState = {
  firstName: '',
  nickname: '',
  lastName: '',
  grade: 9,
  allergies: '',
  birthday: BLANK_BIRTHDAY_FIELD,
  notes: '',
  status: 'active',
};

function fromStudent(student: Student | null): FormState {
  if (!student) return BLANK;
  const name = splitFirstName(student.firstName);
  return {
    firstName: name.firstName,
    nickname: name.nickname ?? '',
    lastName: student.lastName,
    grade: student.gradeOnFile === false ? null : student.grade,
    // Not on the student at all — it is read one person at a time and seeded
    // below, once the details land.
    allergies: '',
    birthday: birthdayFieldFrom(student.birthday),
    notes: student.notes ?? '',
    status: student.status,
  };
}

export interface StudentEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** Omitted or null for create mode. */
  student?: Student | null;
  /**
   * Called after a save that changed something in Planning Center, so a screen
   * holding person details can re-read them. The roster corrects itself, from
   * the row the write hands back.
   */
  onSaved?: () => void;
}

export function StudentEditorModal({ open, onClose, student, onSaved }: StudentEditorModalProps) {
  const { user } = useAuth();
  const { applyRosterPerson } = useData();
  const { show } = useToast();
  const formId = useId();

  const [form, setForm] = useState<FormState>(BLANK);
  const [errors, setErrors] = useState<{
    firstName?: string;
    lastName?: string;
    grade?: string;
    birthday?: string;
  }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Stop the seeding effects below from overwriting what somebody has typed. */
  const [allergiesEdited, setAllergiesEdited] = useState(false);
  const [birthdayEdited, setBirthdayEdited] = useState(false);

  // Free while the modal is open on a student whose page already asked: the
  // hook memoises the answer for the session.
  const { details, loading: detailsLoading, refresh: refreshDetails } = usePersonDetails(
    open ? (student ?? null) : null,
  );

  useEffect(() => {
    if (!open) return;
    setForm(fromStudent(student ?? null));
    setErrors({});
    setSaveError(null);
    setAllergiesEdited(false);
    setBirthdayEdited(false);
  }, [open, student]);

  /*
   * Allergies are the one field that is not on screen when the form opens: they
   * are not on the student, and the details read may still be in flight. Seeded
   * when it lands, and only until somebody types — a leader who cleared the box
   * while it was loading must not have their deletion undone by a late answer.
   */
  useEffect(() => {
    if (!open || allergiesEdited || !details) return;
    setForm((current) => ({ ...current, allergies: details.allergies ?? '' }));
  }, [open, details, allergiesEdited]);

  /*
   * The birthday is seeded twice for the same reason, and the second time is
   * the interesting one. The form opens on the roster's day — no year, because
   * a roster has none — and the details read arrives with the whole date. Left
   * unseeded, the box would show `03 / 14 /` on a student Planning Center holds
   * a 2011 for, which reads as a year nobody ever filled in and makes every
   * correction of the day look like it is about to remove one.
   *
   * Same guard as above, and the same reason for it: a leader who has already
   * typed must not have it undone by a late answer.
   */
  useEffect(() => {
    if (!open || birthdayEdited || !details) return;
    setForm((current) => ({
      ...current,
      birthday: birthdayFieldFrom(details.birthdate ?? student?.birthday ?? null),
    }));
  }, [open, details, birthdayEdited, student]);

  const linked = Boolean(student?.pcoPersonId);
  /** True only under `PCO_WRITE_BACK=full`; false while the details load. */
  const writable = linked && details?.profileWritable === true;
  const locked = (field: keyof Student) => linked && isPcoManaged(field) && !writable;
  const managedHint = 'Managed in Planning Center';
  const upstreamHint = 'Saved in Planning Center';

  /**
   * Whether Planning Center holds no grade for this student.
   *
   * Only ever true for a linked one: the flag rides on roster rows, and a
   * student Tally created holds the grade a human typed. That is what lets the
   * two paths below store a grade without ever having to invent one.
   */
  const gradeUnknown = student?.gradeOnFile === false;
  const gradeHint = locked('grade')
    ? managedHint
    : !writable
      ? undefined
      : gradeUnknown
        ? 'Planning Center holds no grade for them. Choosing one adds it there.'
        : upstreamHint;

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  /**
   * Carries the managed half of the form upstream. Returns the message to show
   * and the student's roster row as Planning Center now holds it, or throws so
   * the caller can report a refusal without closing.
   *
   * Every managed field is sent on every save rather than only the changed
   * ones. The server compares against a fresh read of the person and patches
   * the difference, which is the only comparison worth making: the value this
   * form opened with may have been corrected in Planning Center since.
   */
  const saveUpstream = async (
    current: Student,
    firstName: string,
    lastName: string,
    birthday: string | undefined,
  ) => {
    const response = await updateStudentProfile({
      studentId: current.id,
      firstName: form.firstName.trim(),
      nickname: form.nickname.trim() || null,
      lastName,
      /*
       * Omitted when the form showed no grade, on the same terms as the
       * birthday below: `undefined` is how this patch says "not part of the
       * edit", and a student Planning Center holds no grade for opened on
       * nothing selected. Sending the clamp instead would write a 6th grade
       * nobody chose onto a person upstream.
       */
      ...(form.grade === null ? {} : { grade: form.grade }),
      /*
       * Omitted unless it changed, unlike every other managed field here.
       *
       * The rest are sent on every save so the server can compare them against a
       * fresh read. This one cannot be: `MM-DD` on a student with no birthdate
       * upstream is a refusal — there is no year to keep it against — and that
       * refusal would fail a save whose author never touched the birthday.
       */
      ...(birthday === undefined ? {} : { birthday }),
      /*
       * Safe to send as a value — including an empty one — only because
       * `writable` is false until the details read lands, so this box has
       * genuinely shown what Planning Center holds. An empty box on a form that
       * never saw the current value would clear a child's medical note without
       * anybody deciding to.
       */
      allergies: form.allergies.trim() || null,
    });

    if (response.data.status === 'updated' || response.data.status === 'unchanged') {
      return {
        message:
          response.data.status === 'updated'
            ? response.data.message
            : `${studentFullName({ firstName, lastName })} saved`,
        person: response.data.person,
      };
    }
    throw new Error(response.data.message);
  };

  const handleSubmit = async (submitted: FormEvent<HTMLFormElement>) => {
    submitted.preventDefault();
    if (!user || saving) return;

    const lastName = form.lastName.trim();
    // Validated on the box the leader typed into; stored as the one composite
    // field the rest of Tally — and Planning Center's display name — uses.
    if (!form.firstName.trim() || !lastName) {
      setErrors({
        firstName: form.firstName.trim() ? undefined : 'Required',
        lastName: lastName ? undefined : 'Required',
      });
      return;
    }
    const firstName = composeFirstName(form.firstName, form.nickname);

    /*
     * Read before anything is written, and only when the box is on screen: a
     * form that never showed the birthday has nothing to say about it, and
     * `fromStudent` would otherwise hand back the day already on file as though
     * somebody had typed it.
     */
    let birthday: string | undefined;
    if (writable) {
      // The whole date, not the roster's day: `writable` is only ever true once
      // the details have landed, so the year on file is known here — and
      // comparing against the day alone would send a birthday nobody changed.
      const read = readBirthdayField(form.birthday, {
        onFile: details?.birthdate ?? student?.birthday ?? null,
      });
      if (!read.ok) {
        setErrors({ birthday: read.error });
        return;
      }
      birthday = read.value;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (student) {
        // The upstream half first: it is the half that can be refused, and a
        // note saved against a name Planning Center rejected is a half-done
        // save nobody asked for.
        const saved = writable
          ? await saveUpstream(student, firstName, lastName, birthday)
          : { message: `${studentFullName(student)} saved`, person: null };

        const patch: Partial<StudentDraft> = { notes: form.notes };
        // Managed fields are left out of the Firestore patch in both modes, and
        // for the same reason in each: under `create` Tally does not own them,
        // and under `full` they have just gone to the place that does.
        if (!linked) {
          patch.firstName = firstName;
          patch.lastName = lastName;
          // Never null here — the blank option is only rendered for a linked
          // student — and left out rather than defaulted if it somehow were,
          // because the one thing that must not be written is an invented one.
          if (form.grade !== null) patch.grade = form.grade;
          patch.status = form.status;
        }
        /*
         * The name passed as `current` is the one that just went upstream, not
         * the one the form opened with.
         *
         * An annotation document carries a name it does not own — enough
         * identity for the security rules and for anybody reading Firestore
         * directly — and `updateStudent` refreshes it from here. Handing it the
         * pre-edit name would leave `students/pco_…` asserting a spelling
         * Planning Center no longer holds.
         *
         * The grade is flagged rather than just passed, because `updateStudent`
         * backfills it onto that document: a blank one must not be written down
         * as the clamp's 6, which would put the invented number somewhere the
         * roster no longer governs.
         */
        await updateStudent(
          student.id,
          patch,
          user.uid,
          writable
            ? {
                firstName,
                lastName,
                grade: form.grade ?? student.grade,
                gradeOnFile: form.grade !== null,
              }
            : student,
        );

        if (writable) {
          /*
           * The roster is where the name and grade on every other screen come
           * from; the memoised details are where the allergies are. Dropping
           * the memo rather than re-reading it here, because this modal is
           * about to close — whoever opened it asks again.
           *
           * The roster row is corrected from the write's own answer rather than
           * by asking for the whole roster again with `force`, which is a sweep
           * of every child in the church for a name somebody just typed. Save
           * still blocks on Planning Center accepting the edit; it no longer
           * blocks on being told back what it wrote.
           */
          applyRosterPerson(saved.person);
          invalidatePersonDetails(student.id);
          // And the notes the check-in badges print, which are held separately
          // and would otherwise go on showing the allergy as it was typed
          // before this edit — on the screen that acts on it.
          invalidateAllergyNotes();
          onSaved?.();
        }
        show(saved.message, { tone: 'success' });
      } else {
        // Create mode never shows the blank option — there is no student to
        // hold no grade — so this refuses nothing anybody can reach. It is here
        // so the one grade Tally stores itself can never be an invented one.
        if (form.grade === null) {
          setErrors({ grade: 'Pick a grade' });
          return;
        }
        await createStudent(
          {
            firstName,
            lastName,
            grade: form.grade,
            notes: form.notes,
            status: form.status,
          },
          user.uid,
        );
        show(`${firstName} ${lastName} added`, { tone: 'success' });
      }
      onClose();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save this student.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={student ? `Edit ${studentFullName(student)}` : 'Add a student'}
      description={
        student
          ? undefined
          : 'Created in Tally and pushed to Planning Center on the next sync.'
      }
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="lg" loading={saving}>
            {student ? 'Save changes' : 'Add student'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(submitted) => void handleSubmit(submitted)}
        className="flex flex-col gap-4"
      >
        {saveError ? <ErrorBanner message={saveError} /> : null}

        {linked && student?.pcoPersonId ? (
          <p className="rounded-xl bg-brand-500/10 px-3 py-2 text-xs text-brand-200 ring-1 ring-brand-500/25">
            {writable ? (
              <>
                Name, grade, birthday and allergies are Planning Center's, and Save writes
                them there — Tally keeps no copy.{' '}
                <a
                  href={pcoPersonUrl(student.pcoPersonId)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  Open in Planning Center
                </a>
                . Notes live in Tally.
              </>
            ) : (
              <>
                Name, grade, birthday, allergies and status come from Planning Center and
                would be overwritten by the next sync.{' '}
                <a
                  href={pcoPersonUrl(student.pcoPersonId)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  Edit them in Planning Center
                </a>
                . Notes live in Tally.
              </>
            )}
          </p>
        ) : null}

        {/* First / Last, then Nickname beneath — the shape of Planning Center's
            own edit form, so the two screens can be read side by side. */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="First name"
              value={form.firstName}
              onChange={(changed) => update('firstName', changed.target.value)}
              error={errors.firstName ?? null}
              hint={locked('firstName') ? managedHint : writable ? upstreamHint : undefined}
              disabled={locked('firstName')}
              autoCapitalize="words"
              autoComplete="off"
              required
            />
            <TextField
              label="Last name"
              value={form.lastName}
              onChange={(changed) => update('lastName', changed.target.value)}
              error={errors.lastName ?? null}
              hint={locked('lastName') ? managedHint : writable ? upstreamHint : undefined}
              disabled={locked('lastName')}
              autoCapitalize="words"
              autoComplete="off"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Nickname"
              value={form.nickname}
              onChange={(changed) => update('nickname', changed.target.value)}
              hint={locked('firstName') ? managedHint : 'Optional. Shown beside the first name.'}
              disabled={locked('firstName')}
              autoCapitalize="words"
              autoComplete="off"
            />
          </div>
        </div>

        <SelectField
          label="Grade"
          value={form.grade ?? ''}
          onChange={(changed) =>
            update('grade', changed.target.value ? (Number(changed.target.value) as Grade) : null)
          }
          hint={gradeHint}
          error={errors.grade ?? null}
          disabled={locked('grade')}
        >
          {/*
            Nothing selected for a student Planning Center holds no grade for.

            The alternative was what this form used to do: open on the sync's
            clamp, so an adult volunteer's edit form said "6th grade" and Save
            agreed with it — silently under `create`, and straight onto their
            Planning Center record under `full`. A leader who knows the answer
            can still pick one, which is the whole point of offering the box;
            what they cannot do any more is supply one by not looking.

            Kept selectable rather than removed once they pick, so choosing a
            grade in this form stays undoable without closing it. Going back to
            it means the save carries no grade at all, not a grade cleared.
          */}
          {gradeUnknown ? <option value="">No grade</option> : null}
          {GRADES.map((value) => (
            <option key={value} value={value}>
              {ordinalGrade(value)} grade
            </option>
          ))}
        </SelectField>

        {/*
          The birthday, on the same terms as the name: Planning Center's field,
          editable here only under `full`. The box opens on the whole date the
          details read carries — year included, where Planning Center holds a
          real one — and a year left out still means "keep what is upstream".
          The whole argument is in `lib/birthdayField.ts`.
        */}
        {writable ? (
          <BirthdayField
            value={form.birthday}
            onChange={(changed) => {
              setBirthdayEdited(true);
              setErrors((current) => ({ ...current, birthday: undefined }));
              update('birthday', changed);
            }}
            onFile={details?.birthdate ?? student?.birthday ?? null}
            error={errors.birthday ?? null}
          />
        ) : null}

        {/*
          Allergies are Planning Center's `medical_notes`, and Tally holds none
          of them. Under `full` this box is the church's own record being edited
          in place; otherwise there is nothing to show that is not already on the
          student's page, so the block below points upstream instead.
        */}
        {writable ? (
          <TextAreaField
            label="Allergies"
            value={form.allergies}
            onChange={(changed) => {
              setAllergiesEdited(true);
              update('allergies', changed.target.value);
            }}
            hint={
              detailsLoading
                ? 'Reading what Planning Center has…'
                : 'Saved in Planning Center as medical notes. Clearing this deletes it there.'
            }
          />
        ) : null}

        <TextAreaField
          label="Notes"
          value={form.notes}
          onChange={(changed) => update('notes', changed.target.value)}
          hint="Visible to the core team. Keep it to what a leader needs to know."
        />

        <SelectField
          label="Status"
          value={form.status}
          onChange={(changed) => update('status', changed.target.value as StudentStatus)}
          hint={
            linked
              ? // Never written upstream, in any mode: nothing in Planning
                // Center is ever deactivated from Tally. Who is on the roster is
                // Tally's own list, and that is the control on the student's page.
                'Whether they are on the roster is set with Remove from roster.'
              : 'Inactive students stay in history but leave every roster.'
          }
          disabled={linked}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </SelectField>
      </form>

      {/*
        Outside the form on purpose. This section writes to Planning Center on
        its own button the moment it is submitted — it is not part of Save
        changes, and a form cannot be nested inside another one.
      */}
      <ParentContactSection
        student={student ?? null}
        details={details}
        loading={detailsLoading}
        onAdded={() => {
          refreshDetails();
          onSaved?.();
        }}
      />
    </Modal>
  );
}

/**
 * Parent contact, as this form can honestly offer it.
 *
 * Three different situations that used to share one sentence — "kept in
 * Planning Center, edit them there" — which was true and useless in the case a
 * leader is usually in: there is no number, write-back is on, and Tally could
 * simply have taken one.
 */
function ParentContactSection({
  student,
  details,
  loading,
  onAdded,
}: {
  student: Student | null;
  details: PcoPersonDetails | null;
  loading: boolean;
  onAdded: () => void;
}) {
  const onFile = details?.parentPhone || details?.parentEmail ? details : null;

  return (
    <div className="mt-4 rounded-xl bg-ink-900 px-3 py-2.5 ring-1 ring-ink-800">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Parent contact</p>

      {!student?.pcoPersonId ? (
        <p className="mt-1 text-sm text-ink-300">
          Once this student reaches Planning Center, their parent contact is added there.
        </p>
      ) : loading && !details ? (
        <p className="mt-1 text-sm text-ink-500">Reading what Planning Center has…</p>
      ) : onFile ? (
        // Already reachable, so there is nothing for Tally to add: the write
        // path only ever fills a gap, and never overwrites what is on file.
        <>
          <p className="mt-1 text-sm text-ink-100">
            {onFile.parentName ? `${onFile.parentName} · ` : ''}
            {onFile.parentPhone ? (
              <span className="tabular-nums">{formatPhone(onFile.parentPhone)}</span>
            ) : null}
            {onFile.parentPhone && onFile.parentEmail ? ' · ' : ''}
            {onFile.parentEmail ? <span className="break-all">{onFile.parentEmail}</span> : null}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Kept in Planning Center.{' '}
            <a
              href={pcoPersonUrl(student.pcoPersonId)}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand-300 underline"
            >
              Change it there
            </a>
            .
          </p>
        </>
      ) : (
        // Every remaining case — writable, no household to write onto, or
        // write-back turned down — is the gate `AddParentContact` already
        // states, on the student's own page, in the same words.
        <AddParentContact student={student} details={details} onAdded={onAdded} />
      )}
    </div>
  );
}
