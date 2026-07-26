/**
 * Create or edit one student.
 *
 * The interesting constraint is Planning Center. Once a student is linked, the
 * fields listed in `PCO_MANAGED_STUDENT_FIELDS` are owned there: anything typed
 * into them here would be silently reverted by the next pull. A form that
 * accepts an edit it cannot keep is worse than one that refuses it, so those
 * inputs render disabled with a link to the place the edit actually belongs.
 * Everything Tally owns — small group, parent contact, notes — stays editable.
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
import { ordinalGrade } from '@/lib/utils';
import { createStudent, updateStudent, type StudentDraft } from '@/services/students';
import {
  GRADES,
  PCO_MANAGED_STUDENT_FIELDS,
  composeFirstName,
  splitFirstName,
  studentFullName,
  type Gender,
  type Grade,
  type Student,
  type StudentStatus,
} from '@/types';

/** Deep link to a person in Planning Center People. Mirrored in StudentDetailPage. */
function pcoPersonUrl(pcoPersonId: string): string {
  return `https://people.planningcenteronline.com/people/AC${pcoPersonId}`;
}

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
  grade: Grade;
  gender: Gender;
  smallGroupId: string;
  notes: string;
  status: StudentStatus;
}

const BLANK: FormState = {
  firstName: '',
  nickname: '',
  lastName: '',
  grade: 9,
  gender: 'unspecified',
  smallGroupId: '',
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
    grade: student.grade,
    gender: student.gender,
    smallGroupId: student.smallGroupId ?? '',
    notes: student.notes ?? '',
    status: student.status,
  };
}

export interface StudentEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** Omitted or null for create mode. */
  student?: Student | null;
}

export function StudentEditorModal({ open, onClose, student }: StudentEditorModalProps) {
  const { groups } = useData();
  const { user } = useAuth();
  const { show } = useToast();
  const formId = useId();

  const [form, setForm] = useState<FormState>(BLANK);
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(fromStudent(student ?? null));
    setErrors({});
    setSaveError(null);
  }, [open, student]);

  const linked = Boolean(student?.pcoPersonId);
  const locked = (field: keyof Student) => linked && isPcoManaged(field);
  const managedHint = 'Managed in Planning Center';

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

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

    setSaving(true);
    setSaveError(null);

    try {
      if (student) {
        const patch: Partial<StudentDraft> = {
          smallGroupId: form.smallGroupId || null,
          notes: form.notes,
        };
        // Managed fields are left out of the patch entirely rather than written
        // back unchanged — Tally should not be the last writer on a value it
        // does not own.
        if (!linked) {
          patch.firstName = firstName;
          patch.lastName = lastName;
          patch.grade = form.grade;
          patch.gender = form.gender;
          patch.status = form.status;
        }
        await updateStudent(student.id, patch, user.uid, student);
        show(`${studentFullName(student)} saved`, { tone: 'success' });
      } else {
        await createStudent(
          {
            firstName,
            lastName,
            grade: form.grade,
            gender: form.gender,
            smallGroupId: form.smallGroupId || null,
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
      variant="sheet"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="lg" className="flex-[2]" loading={saving}>
            {student ? 'Save changes' : 'Add student'}
          </Button>
        </div>
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
            Name, grade, gender, allergies and status come from Planning Center and would be
            overwritten by the next sync.{' '}
            <a
              href={pcoPersonUrl(student.pcoPersonId)}
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline"
            >
              Edit them in Planning Center
            </a>
            . Small group, parent contact and notes live in Tally.
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
              hint={locked('firstName') ? managedHint : undefined}
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
              hint={locked('lastName') ? managedHint : undefined}
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

        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Grade"
            value={form.grade}
            onChange={(changed) => update('grade', Number(changed.target.value) as Grade)}
            hint={locked('grade') ? managedHint : undefined}
            disabled={locked('grade')}
          >
            {GRADES.map((value) => (
              <option key={value} value={value}>
                {ordinalGrade(value)} grade
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Gender"
            value={form.gender}
            onChange={(changed) => update('gender', changed.target.value as Gender)}
            hint={locked('gender') ? managedHint : 'Only used to split small groups.'}
            disabled={locked('gender')}
          >
            <option value="unspecified">Not specified</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </SelectField>
        </div>

        <SelectField
          label="Small group"
          value={form.smallGroupId}
          onChange={(changed) => update('smallGroupId', changed.target.value)}
          hint="Blank falls back to the group's grade and gender rules."
        >
          <option value="">No group</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </SelectField>

        {/*
          Parent contact and allergies used to be edited here and stored in
          Firestore. They are Planning Center's, and Tally no longer keeps a
          copy — so this is a pointer rather than a form. It is a real
          reduction: a leader who wants to record an emergency number does it
          upstream, where the church's own records are, instead of in a second
          place that has to be reconciled.
        */}
        <div className="rounded-xl bg-ink-900 px-3 py-2.5 ring-1 ring-ink-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Parent contact and allergies
          </p>
          <p className="mt-1 text-sm text-ink-300">
            {student?.pcoPersonId ? (
              <>
                Kept in Planning Center, not in Tally.{' '}
                <a
                  href={pcoPersonUrl(student.pcoPersonId)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-brand-300 underline"
                >
                  Edit them there
                </a>
                .
              </>
            ) : (
              'Once this student reaches Planning Center, their parent contact and allergies are edited there.'
            )}
          </p>
        </div>

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
            locked('status')
              ? managedHint
              : 'Inactive students stay in history but leave every roster.'
          }
          disabled={locked('status')}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </SelectField>
      </form>
    </Modal>
  );
}
