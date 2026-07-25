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

interface FormState {
  firstName: string;
  lastName: string;
  grade: Grade;
  gender: Gender;
  smallGroupId: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  allergies: string;
  notes: string;
  status: StudentStatus;
}

const BLANK: FormState = {
  firstName: '',
  lastName: '',
  grade: 9,
  gender: 'unspecified',
  smallGroupId: '',
  parentName: '',
  parentPhone: '',
  parentEmail: '',
  allergies: '',
  notes: '',
  status: 'active',
};

function fromStudent(student: Student | null): FormState {
  if (!student) return BLANK;
  return {
    firstName: student.firstName,
    lastName: student.lastName,
    grade: student.grade,
    gender: student.gender,
    smallGroupId: student.smallGroupId ?? '',
    parentName: student.parentName ?? '',
    parentPhone: student.parentPhone ?? '',
    parentEmail: student.parentEmail ?? '',
    allergies: student.allergies ?? '',
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

  // Journey 3's payoff: a visitor stops being "missing info" the moment a
  // counselor can reach a parent, and `updateStudent` clears the flag for us.
  const clearsMissingInfo =
    Boolean(student?.isVisitor) &&
    !student?.profileComplete &&
    Boolean(form.parentPhone.trim() || form.parentEmail.trim());

  const handleSubmit = async (submitted: FormEvent<HTMLFormElement>) => {
    submitted.preventDefault();
    if (!user || saving) return;

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    if (!firstName || !lastName) {
      setErrors({
        firstName: firstName ? undefined : 'Required',
        lastName: lastName ? undefined : 'Required',
      });
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (student) {
        const patch: Partial<StudentDraft> = {
          smallGroupId: form.smallGroupId || null,
          parentName: form.parentName,
          parentPhone: form.parentPhone,
          parentEmail: form.parentEmail,
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
          patch.allergies = form.allergies;
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
            parentName: form.parentName,
            parentPhone: form.parentPhone,
            parentEmail: form.parentEmail,
            allergies: form.allergies,
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

        <TextField
          label="Parent name"
          value={form.parentName}
          onChange={(changed) => update('parentName', changed.target.value)}
          autoCapitalize="words"
          autoComplete="off"
        />
        <TextField
          label="Parent phone"
          type="tel"
          inputMode="tel"
          value={form.parentPhone}
          onChange={(changed) => update('parentPhone', changed.target.value)}
          autoComplete="off"
        />
        <TextField
          label="Parent email"
          type="email"
          inputMode="email"
          value={form.parentEmail}
          onChange={(changed) => update('parentEmail', changed.target.value)}
          autoCapitalize="off"
          autoComplete="off"
        />

        {clearsMissingInfo ? (
          <p className="rounded-xl bg-present-500/10 px-3 py-2 text-xs text-present-400 ring-1 ring-present-500/25">
            Saving this clears the “Missing info” flag and takes {student?.firstName} off the
            incomplete-profiles list.
          </p>
        ) : null}

        <TextField
          label="Allergies"
          value={form.allergies}
          onChange={(changed) => update('allergies', changed.target.value)}
          hint={
            locked('allergies') ? managedHint : 'Shown as a warning badge wherever they appear.'
          }
          disabled={locked('allergies')}
          autoComplete="off"
        />

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
