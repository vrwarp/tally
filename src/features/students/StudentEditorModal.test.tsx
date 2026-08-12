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
  vi.fn<
    (...args: unknown[]) => Promise<{
      data: {
        status: string;
        wrote: string[];
        message: string;
        person?: Record<string, unknown> | null;
      };
    }>
  >(async () => ({
    data: {
      status: 'updated',
      wrote: ['first_name'],
      message: 'Saved first name in Planning Center.',
      // The row the write hands back, which is what the roster is corrected
      // from — see `applyRosterPerson`.
      person: {
        id: 'pco_4200003',
        pcoPersonId: '4200003',
        firstName: 'Sofía',
        lastName: 'Delgado',
        grade: 11,
        status: 'active',
        searchName: 'sofia delgado',
        profileComplete: null,
        hasAllergies: true,
        birthday: null,
        
      },
    },
  })),
);
const setParentContact = vi.hoisted(() => vi.fn());
const addParent = vi.hoisted(() => vi.fn());
vi.mock('@/services/functions', () => ({ updateStudentProfile, setParentContact, addParent }));

/*
 * Save no longer waits on the backend — it queues a job — so this is the seam
 * these tests now assert against. Mocked rather than imported for the same
 * reason every Firestore-touching module here is: the real one reaches
 * `@/lib/firebase`, which throws at import time with no project configured.
 */
const enqueueUpstreamEdit = vi.hoisted(() =>
  /*
   * Returns synchronously, like the real one: the job exists on the device the
   * moment it is called, and the promise it hands back is the *server's*
   * answer, which the screens deliberately do not wait for.
   */
  vi.fn<(...args: unknown[]) => { editId: string; written: Promise<void> }>(() => ({
    editId: 'edit-1',
    written: Promise.resolve(),
  })),
);
vi.mock('@/services/upstreamEdits', () => ({ enqueueUpstreamEdit }));

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
const applyRosterPerson = vi.fn();
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
    birthdate: null,
    householdAdult: true,
    contactWritable: true,
    profileWritable: true,
    parentCreatable: false,
    ...overrides,
  };
}

function open(student: Student | null, onSaved = vi.fn(), onClose = vi.fn()) {
  const data = {
    students: student ? [student] : [],
    events: [],
    series: [],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: null,
    rosterBackends: [],
    refreshRoster,
    applyRosterPerson,
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

  render(wrap(<StudentEditorModal open onClose={onClose} student={student} onSaved={onSaved} />));
  return onSaved;
}

const save = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
};

beforeEach(() => {
  updateStudentProfile.mockClear();
  enqueueUpstreamEdit.mockClear();
  updateStudent.mockClear();
  createStudent.mockClear();
  refreshRoster.mockClear();
  applyRosterPerson.mockClear();
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
    expect(enqueueUpstreamEdit).not.toHaveBeenCalled();
    expect(updateStudent.mock.calls[0]?.[1]).toEqual({ notes: 'Rides with the Kims' });
  });
});

describe('when write-back is full', () => {
  beforeEach(() => {
    personDetails.current = details();
  });

  /**
   * The corridor case, which is the one the whole queue was built for.
   *
   * Offline, a Firestore write is applied on the device at once and its promise
   * stays pending until a server acknowledges it — which may be minutes. This
   * used to be awaited before closing, so a leader with no signal pressed Save
   * and sat looking at an open dialog with a spinner in it. Nothing here mocks
   * the network: a job whose server acknowledgement never comes is exactly what
   * a `written` promise that never settles is.
   */
  it('closes on the write reaching the device, not on a server answering', async () => {
    const onClose = vi.fn();
    enqueueUpstreamEdit.mockReturnValueOnce({
      editId: 'edit-1',
      written: new Promise<void>(() => {}),
    });
    open(linked(), vi.fn(), onClose);

    await userEvent.clear(screen.getByLabelText(/Last name/));
    await userEvent.type(screen.getByLabelText(/Last name/), 'Chen-Ito');
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(enqueueUpstreamEdit).toHaveBeenCalled();
  });

  /**
   * The other half of not waiting: a job the rules refused never existed, so no
   * strip will ever appear on the record to report it. If this screen says
   * nothing either, the correction is gone and nobody is told.
   */
  it('says so when the job could not be written at all', async () => {
    // Built inside the implementation rather than ahead of it: a rejected
    // promise created before the call is unhandled for a turn, and Node counts
    // that as an unhandled rejection even though the screen attaches a handler
    // the instant it is given one.
    enqueueUpstreamEdit.mockImplementationOnce(() => ({
      editId: 'edit-1',
      written: Promise.reject(new Error('permission-denied')),
    }));
    open(linked());

    await userEvent.clear(screen.getByLabelText(/Last name/));
    await userEvent.type(screen.getByLabelText(/Last name/), 'Chen-Ito');
    await save();

    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(expect.stringMatching(/could not be saved/i)),
    );
  });

  it('lets a leader correct the name that Planning Center holds', () => {
    open(linked());

    expect(screen.getByLabelText(/First name/)).toBeEnabled();
    expect(screen.getByLabelText(/Grade/)).toBeEnabled();
    expect(screen.getByRole('link', { name: /Open in Planning Center/ })).toBeInTheDocument();
  });

  it('queues only the field that changed, and keeps no copy in Tally', async () => {
    open(linked());

    const first = screen.getByLabelText(/First name/);
    await userEvent.clear(first);
    await userEvent.type(first, 'Sofía');
    await save();

    await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
    const queued = enqueueUpstreamEdit.mock.calls[0]?.[0] as {
      studentId: string;
      patch: Record<string, unknown>;
      baseline: Record<string, unknown>;
    };
    expect(queued.studentId).toBe('pco_4200003');
    expect(queued.patch).toEqual({ firstName: 'Sofía' });
    /*
     * The last name and the grade are *absent*, and that is the assertion that
     * matters. `updateStudentProfile` sent every managed field on every save,
     * which is right for a request somebody waits on — the server diffs against
     * a fresh read. It is wrong for a queued one: a second leader restating a
     * value they never touched patches the first leader's in-flight correction
     * back out, and both are told they succeeded.
     */
    expect(queued.patch).not.toHaveProperty('lastName');
    expect(queued.patch).not.toHaveProperty('grade');
    // What the form was showing, so the drain can tell a value somebody else
    // changed in between from the one this edit is replacing.
    expect(queued.baseline).toMatchObject({ firstName: 'Sofia' });

    // Notes and nothing else: the name went where the name lives.
    expect(updateStudent.mock.calls[0]?.[1]).toEqual({ notes: '' });
    // And nothing waits on the roster, because nothing has landed yet to read.
    expect(applyRosterPerson).not.toHaveBeenCalled();
    expect(refreshRoster).not.toHaveBeenCalled();
  });

  it('shows the allergy Planning Center holds, and saves an edit to it', async () => {
    open(linked());

    const allergies = screen.getByLabelText(/Allergies/);
    expect(allergies).toHaveValue('Severe peanut allergy — EpiPen in her bag');

    await userEvent.clear(allergies);
    await userEvent.type(allergies, 'Peanuts. EpiPen in her bag.');
    await save();

    await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
    expect(
      (enqueueUpstreamEdit.mock.calls[0]?.[0] as { patch: Record<string, unknown> }).patch,
    ).toMatchObject({ allergies: 'Peanuts. EpiPen in her bag.' });
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
    expect(enqueueUpstreamEdit).not.toHaveBeenCalled();
  });

  /**
   * The refusal moved, and that is the point of this whole change.
   *
   * A backend can still say no — a birthday it will not take, credentials that
   * have been rotated — but nobody finds out while a modal is open, because the
   * modal is not waiting any more. The job carries the refusal, the record's
   * strip says what happened and offers the one move, and it survives the tab
   * being closed. What this asserts is the half that used to be a spinner:
   * pressing Save returns.
   */
  it('closes on Save instead of waiting for the backend to answer', async () => {
    open(linked());

    const first = screen.getByLabelText(/First name/);
    await userEvent.clear(first);
    await userEvent.type(first, 'Sofía');
    await save();

    await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
    // Nothing on this path talks to the backend at all any more: the callable
    // that used to hold the modal open while Planning Center thought about it
    // is not reached, so Save has nothing left to wait for.
    expect(updateStudentProfile).not.toHaveBeenCalled();
  });

  it('still refuses to write the status, which is a roster decision', () => {
    open(linked());

    expect(screen.getByLabelText(/Status/)).toBeDisabled();
    expect(screen.getByText(/Remove from roster/)).toBeInTheDocument();
  });

  /**
   * The birthday arrives in two pieces: the roster's day, which this form opens
   * with, and the year, which only the one-person details read carries. So these
   * are as much about where each half comes from as about the date.
   */
  describe('the birthday', () => {
    it('opens on the day the roster carries when that is all anybody has', () => {
      open(linked({ birthday: '06-28' }));

      expect(screen.getByLabelText('Birthday')).toHaveValue('06 / 28 / ');
    });

    /**
     * The year, once Planning Center has been read. A box showing `06 / 28 /`
     * beside a student it holds a 2008 for reads as a year nobody filled in,
     * and every correction of the day looks like it is about to delete one.
     */
    it('fills the year in when the details read lands with one', async () => {
      personDetails.current = details({ birthdate: '2008-06-28' });
      open(linked({ birthday: '06-28' }));

      await waitFor(() =>
        expect(screen.getByLabelText('Birthday')).toHaveValue('06 / 28 / 2008'),
      );
    });

    /** An untouched box is not an edit, whatever it is showing. */
    it('is left out of a save that did not touch the date it opened on', async () => {
      personDetails.current = details({ birthdate: '2008-06-28' });
      open(linked({ birthday: '06-28' }));

      await waitFor(() =>
        expect(screen.getByLabelText('Birthday')).toHaveValue('06 / 28 / 2008'),
      );
      await save();

      /*
       * Nothing is queued at all. The form opened on the date already on file
       * and nobody typed, so there is no instruction in it — and under a queue
       * that is the stronger statement, because a job carrying an empty patch
       * would put a mark on every screen showing this student for a save that
       * asked for nothing.
       */
      await waitFor(() => expect(updateStudent).toHaveBeenCalled());
      expect(enqueueUpstreamEdit).not.toHaveBeenCalled();
    });

    /** And the correction that was impossible before: the year itself. */
    it('sends the whole date when the year on screen is corrected', async () => {
      personDetails.current = details({ birthdate: '2008-06-28' });
      open(linked({ birthday: '06-28' }));

      const box = screen.getByLabelText('Birthday');
      await waitFor(() => expect(box).toHaveValue('06 / 28 / 2008'));
      await userEvent.clear(box);
      await userEvent.type(box, '6/28/2009');
      await save();

      await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
      expect((enqueueUpstreamEdit.mock.calls[0]?.[0] as { patch: Record<string, unknown> }).patch).toMatchObject({ birthday: '2009-06-28' });
    });

    it('sends the corrected day on its own, so the year upstream is kept', async () => {
      open(linked({ birthday: '06-28' }));

      const box = screen.getByLabelText('Birthday');
      await userEvent.clear(box);
      await userEvent.type(box, '6/26');
      await save();

      await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
      expect((enqueueUpstreamEdit.mock.calls[0]?.[0] as { patch: Record<string, unknown> }).patch).toMatchObject({ birthday: '06-26' });
    });

    it('sends the whole date when a leader types the year too', async () => {
      open(linked({ birthday: null }));

      await userEvent.type(screen.getByLabelText('Birthday'), '4/2/2013');
      await save();

      await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
      expect((enqueueUpstreamEdit.mock.calls[0]?.[0] as { patch: Record<string, unknown> }).patch).toMatchObject({ birthday: '2013-04-02' });
    });

    /**
     * The bug this exists to stop: a leader fixing a *name* on a student with no
     * birthdate upstream. Sending the birthday on every save — as every other
     * managed field is — would make the server refuse the whole edit over a box
     * nobody typed in.
     */
    it('is left out of a save that did not touch it', async () => {
      open(linked({ birthday: null }));

      const first = screen.getByLabelText(/First name/);
      await userEvent.clear(first);
      await userEvent.type(first, 'Sofía');
      await save();

      await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
      expect(
        (enqueueUpstreamEdit.mock.calls[0]?.[0] as { patch: Record<string, unknown> }).patch,
      ).not.toHaveProperty('birthday');
    });

    /**
     * Planning Center holds a birthday with no year — it keeps 1885 for one and
     * shows no age — so a leader who has just been told "the second of April"
     * is not asked for a year they were never given.
     */
    it('takes a day with no year on a student who has no birthdate upstream', async () => {
      open(linked({ birthday: null }));

      await userEvent.type(screen.getByLabelText('Birthday'), '4/2');
      await save();

      await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
      expect((enqueueUpstreamEdit.mock.calls[0]?.[0] as { patch: Record<string, unknown> }).patch).toMatchObject({ birthday: '04-02' });
    });

    it('refuses a day that month does not have', async () => {
      open(linked({ birthday: '06-28' }));

      const box = screen.getByLabelText('Birthday');
      await userEvent.clear(box);
      await userEvent.type(box, '2/31');
      await save();

      expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
      expect(enqueueUpstreamEdit).not.toHaveBeenCalled();
    });

    it('offers no birthday box at all when Tally may not write it', () => {
      personDetails.current = details({ profileWritable: false, contactWritable: false });
      open(linked());

      expect(screen.queryByLabelText('Birthday')).not.toBeInTheDocument();
    });
  });
});

/**
 * A student Planning Center holds no grade for — the adults a hand-picked
 * roster carries on purpose.
 *
 * The number on their row is where the sync's clamp landed, and this form used
 * to open on it. That put a 6th grade in front of a leader who had come to fix
 * something else, and under `full` Save agreed with it and wrote the 6 onto a
 * grown adult's record in Planning Center.
 */
describe('a student with no grade on file', () => {
  const gradeless = () => linked({ grade: null });

  it('opens on nothing selected rather than on the bottom of the range', () => {
    personDetails.current = details();
    open(gradeless());

    expect(screen.getByLabelText(/Grade/)).toHaveValue('');
    expect(screen.getByRole('option', { name: 'No grade' })).toBeInTheDocument();
  });

  it('carries no grade upstream when nobody picked one', async () => {
    personDetails.current = details();
    open(gradeless());

    const first = screen.getByLabelText(/First name/);
    await userEvent.clear(first);
    await userEvent.type(first, 'Alan');
    await save();

    await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
    expect((enqueueUpstreamEdit.mock.calls[0]?.[0] as { patch: Record<string, unknown> }).patch).not.toHaveProperty('grade');
  });

  it('writes no grade onto the annotation document either', async () => {
    // `updateStudent` backfills identity onto `students/pco_…`, and a document
    // outlives the roster row: take this person off the roster and a grade
    // stamped here is all that would be left of them.
    personDetails.current = details({ profileWritable: false, contactWritable: false });
    open(gradeless());

    await userEvent.type(screen.getByLabelText(/Notes/), 'Drives the van');
    await save();

    await waitFor(() => expect(updateStudent).toHaveBeenCalled());
    expect(updateStudent.mock.calls[0]?.[3]).toMatchObject({ grade: null });
  });

  it('takes a grade from a leader who knows it', async () => {
    personDetails.current = details();
    open(gradeless());

    await userEvent.selectOptions(screen.getByLabelText(/Grade/), '8');
    await save();

    await waitFor(() => expect(enqueueUpstreamEdit).toHaveBeenCalled());
    expect((enqueueUpstreamEdit.mock.calls[0]?.[0] as { patch: Record<string, unknown> }).patch).toMatchObject({ grade: 8 });
  });

  it('offers no blank option to a student whose grade is genuinely on file', () => {
    personDetails.current = details();
    open(linked({ grade: 11 }));

    expect(screen.getByLabelText(/Grade/)).toHaveValue('11');
    expect(screen.queryByRole('option', { name: 'No grade' })).not.toBeInTheDocument();
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
    expect(enqueueUpstreamEdit).not.toHaveBeenCalled();
    expect(updateStudent.mock.calls[0]?.[1]).toMatchObject({
      firstName: 'Nia',
      lastName: 'Fontaine',
    });
  });
});
