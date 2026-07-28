/**
 * What the Edit profile form will and will not let a leader change.
 *
 * The whole behaviour turns on one server-answered flag. Under the default
 * write-back mode the managed fields are read-only, because an edit typed into
 * them would be reverted by the next read of Planning Center — Tally keeps no
 * copy to hold it. Under `full` the same boxes are the church's own record,
 * edited in place, and Save carries them upstream instead of into Firestore.
 *
 * The allergy assertions are the ones to keep: `medical_notes` is a child's
 * medical record, and a form that cannot see the current value must not be able
 * to erase it by saving an empty box.
 */
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { StudentEditorModal } from '@/features/students/StudentEditorModal';
import type { PcoPersonDetails, Student } from '@/types';
import { makeSettings, makeStudent } from '../../../tests/factories';

const updateStudentProfile = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ data: { status: string; wrote: string[]; message: string } }>>(
    async () => ({
      data: { status: 'updated', wrote: ['first_name'], message: 'Saved first name in Planning Center.' },
    }),
  ),
);
const setParentContact = vi.hoisted(() => vi.fn());
vi.mock('@/services/functions', () => ({ updateStudentProfile, setParentContact }));

const updateStudent = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}));
const createStudent = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(async () => 'new-student'),
);
vi.mock('@/services/students', () => ({ updateStudent, createStudent }));

/**
 * The details read is stubbed at the hook rather than the callable: what these
 * tests are about is the form's response to the answer, and the hook memoises
 * across renders in a way that would leak between them.
 */
const personDetails = vi.hoisted(() => ({ current: null as PcoPersonDetails | null, loading: false }));
const refreshDetails = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/usePersonDetails', () => ({
  invalidatePersonDetails: vi.fn(),
  usePersonDetails: () => ({
    details: personDetails.current,
    loading: personDetails.loading,
    error: null,
    loaded: !personDetails.loading,
    unavailable: false,
    retry: vi.fn(),
    refresh: refreshDetails,
  }),
}));

const refreshRoster = vi.fn(async () => {});
const show = vi.fn();

function linked(overrides: Partial<Student> = {}): Student {
  return makeStudent({
    id: 'pco_4200003',
    firstName: 'Sofia',
    lastName: 'Delgado',
    grade: 11,
    pcoPersonId: '4200003',
    hasAllergies: true,
    ...overrides,
  });
}

function details(overrides: Partial<PcoPersonDetails> = {}): PcoPersonDetails {
  return {
    pcoPersonId: '4200003',
    parentName: 'Marisol Delgado',
    parentPhone: null,
    parentEmail: null,
    allergies: 'Severe peanut allergy — EpiPen in her bag',
    householdAdult: true,
    contactWritable: true,
    profileWritable: true,
    ...overrides,
  };
}

function open(student: Student | null, onSaved = vi.fn()) {
  const data = {
    students: student ? [student] : [],
    events: [],
    series: [],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: null,
    refreshRoster,
  } as unknown as DataContextValue;

  const auth = { user: { uid: 'core-1' }, can: () => true } as unknown as AuthContextValue;
  const toast: ToastContextValue = { show, dismiss: vi.fn(), toasts: [] };

  const wrap = (children: ReactNode) => (
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
      </DataContext.Provider>
    </AuthContext.Provider>
  );

  render(wrap(<StudentEditorModal open onClose={() => {}} student={student} onSaved={onSaved} />));
  return onSaved;
}

const save = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
};

beforeEach(() => {
  updateStudentProfile.mockClear();
  updateStudent.mockClear();
  createStudent.mockClear();
  refreshRoster.mockClear();
  refreshDetails.mockClear();
  show.mockClear();
  personDetails.current = null;
  personDetails.loading = false;
});

describe('when write-back is not full', () => {
  beforeEach(() => {
    personDetails.current = details({ profileWritable: false, contactWritable: false });
  });

  it('leaves the managed fields read-only and says where they belong', () => {
    open(linked());

    expect(screen.getByLabelText(/First name/)).toBeDisabled();
    expect(screen.getByLabelText(/Grade/)).toBeDisabled();
    expect(screen.getAllByText('Managed in Planning Center').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Edit them in Planning Center/ })).toBeInTheDocument();
  });

  it('offers no allergy box at all, rather than one that cannot be saved', () => {
    open(linked());

    expect(screen.queryByLabelText(/Allergies/)).not.toBeInTheDocument();
  });

  it('saves the notes and writes nothing upstream', async () => {
    open(linked());

    await userEvent.type(screen.getByLabelText(/Notes/), 'Rides with the Kims');
    await save();

    await waitFor(() => expect(updateStudent).toHaveBeenCalled());
    expect(updateStudentProfile).not.toHaveBeenCalled();
    expect(updateStudent.mock.calls[0]?.[1]).toEqual({ notes: 'Rides with the Kims' });
  });
});

describe('when write-back is full', () => {
  beforeEach(() => {
    personDetails.current = details();
  });

  it('lets a leader correct the name that Planning Center holds', () => {
    open(linked());

    expect(screen.getByLabelText(/First name/)).toBeEnabled();
    expect(screen.getByLabelText(/Grade/)).toBeEnabled();
    expect(screen.getByRole('link', { name: /Open in Planning Center/ })).toBeInTheDocument();
  });

  it('sends the edit straight upstream, and keeps no copy in Tally', async () => {
    open(linked());

    const first = screen.getByLabelText(/First name/);
    await userEvent.clear(first);
    await userEvent.type(first, 'Sofía');
    await save();

    await waitFor(() => expect(updateStudentProfile).toHaveBeenCalled());
    expect(updateStudentProfile.mock.calls[0]?.[0]).toMatchObject({
      studentId: 'pco_4200003',
      firstName: 'Sofía',
      lastName: 'Delgado',
      grade: 11,
    });
    // Notes and nothing else: the name went where the name lives.
    expect(updateStudent.mock.calls[0]?.[1]).toEqual({ notes: '' });
    expect(refreshRoster).toHaveBeenCalledWith(true);
  });

  it('shows the allergy Planning Center holds, and saves an edit to it', async () => {
    open(linked());

    const allergies = screen.getByLabelText(/Allergies/);
    expect(allergies).toHaveValue('Severe peanut allergy — EpiPen in her bag');

    await userEvent.clear(allergies);
    await userEvent.type(allergies, 'Peanuts. EpiPen in her bag.');
    await save();

    await waitFor(() => expect(updateStudentProfile).toHaveBeenCalled());
    expect(updateStudentProfile.mock.calls[0]?.[0]).toMatchObject({
      allergies: 'Peanuts. EpiPen in her bag.',
    });
  });

  /**
   * The failure this guards against is silent and permanent. The allergy box is
   * the only field whose value arrives *after* the form opens, so a form that
   * unlocked before the read landed would show an empty box over a real peanut
   * allergy — and saving it would delete that from the church's database.
   */
  it('stays read-only until it can see what Planning Center holds', async () => {
    personDetails.current = null;
    personDetails.loading = true;
    open(linked());

    expect(screen.getByLabelText(/First name/)).toBeDisabled();
    expect(screen.queryByLabelText(/Allergies/)).not.toBeInTheDocument();

    await save();
    await waitFor(() => expect(updateStudent).toHaveBeenCalled());
    expect(updateStudentProfile).not.toHaveBeenCalled();
  });

  it('keeps the form open and shows why when Planning Center refuses', async () => {
    updateStudentProfile.mockResolvedValueOnce({
      data: { status: 'invalid', wrote: [], message: 'A last name is required.' },
    });
    open(linked());

    await save();

    expect(await screen.findByText('A last name is required.')).toBeInTheDocument();
    expect(updateStudent).not.toHaveBeenCalled();
  });

  it('still refuses to write the status, which is a roster decision', () => {
    open(linked());

    expect(screen.getByLabelText(/Status/)).toBeDisabled();
    expect(screen.getByText(/Remove from roster/)).toBeInTheDocument();
  });
});

describe('parent contact', () => {
  it('offers the form in place of a link when Tally may write one', () => {
    personDetails.current = details();
    open(linked());

    expect(screen.getByRole('button', { name: /Add parent contact/ })).toBeInTheDocument();
  });

  it('points upstream when there is no adult in the household to write onto', () => {
    personDetails.current = details({ householdAdult: false, contactWritable: false });
    open(linked());

    expect(screen.queryByRole('button', { name: /Add parent contact/ })).not.toBeInTheDocument();
    expect(screen.getByText(/no adult in this household/)).toBeInTheDocument();
  });

  it('shows what is on file rather than offering to add a second number', () => {
    personDetails.current = details({ parentPhone: '(510) 555-0142' });
    open(linked());

    expect(screen.getByText(/510/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add parent contact/ })).not.toBeInTheDocument();
  });
});

describe('a visitor Tally created', () => {
  it('is edited in Tally, because Planning Center has never heard of them', async () => {
    open(makeStudent({ id: 'tally-1', pcoPersonId: null, firstName: 'Nia', lastName: 'Fontaine' }));

    expect(screen.getByLabelText(/First name/)).toBeEnabled();
    await save();

    await waitFor(() => expect(updateStudent).toHaveBeenCalled());
    expect(updateStudentProfile).not.toHaveBeenCalled();
    expect(updateStudent.mock.calls[0]?.[1]).toMatchObject({
      firstName: 'Nia',
      lastName: 'Fontaine',
    });
  });
});
