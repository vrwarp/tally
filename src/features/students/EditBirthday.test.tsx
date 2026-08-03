/**
 * The birthday badge, and the form behind it.
 *
 * The badge is where somebody notices — usually with the student in front of
 * them having just said when it is — so the thing worth asserting is that the
 * panel takes the answer rather than sending them to another product, and that
 * it only offers to when the church has turned write-back on.
 *
 * The box carries the rest of the weight. It is one field that reads whatever
 * shape a birthday was typed in, and says back what it made of it before
 * anybody presses Save.
 */
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { RowBadgeModal } from '@/features/students/RowBadgeModal';
import type { PcoPersonDetails, PcoRosterPerson, Student } from '@/types';
import { makeSettings, makeStudent } from '../../../tests/factories';

/** The row Planning Center holds once the write has landed. */
function savedRow(overrides: Partial<PcoRosterPerson> = {}): PcoRosterPerson {
  return {
    id: 'pco_4200003',
    pcoPersonId: '4200003',
    firstName: 'Sofia',
    lastName: 'Delgado',
    grade: 9,
    status: 'active',
    searchName: 'sofia delgado',
    profileComplete: null,
    hasAllergies: false,
    birthday: '03-16',
    gradeOnFile: true,
    ...overrides,
  };
}

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
      wrote: ['birthdate'],
      message: 'Saved birthday in Planning Center.',
      person: {
        id: 'pco_4200003',
        pcoPersonId: '4200003',
        firstName: 'Sofia',
        lastName: 'Delgado',
        grade: 9,
        status: 'active',
        searchName: 'sofia delgado',
        profileComplete: null,
        hasAllergies: false,
        birthday: '03-16',
        gradeOnFile: true,
      },
    },
  })),
);
vi.mock('@/services/functions', () => ({
  updateStudentProfile,
  setParentContact: vi.fn(),
  addParent: vi.fn(),
  pushStudentToPlanningCenter: vi.fn(),
}));
vi.mock('@/services/students', () => ({ updateStudent: vi.fn(), setStudentStatus: vi.fn() }));

const personDetails = vi.hoisted(() => ({
  current: null as PcoPersonDetails | null,
  loading: false,
}));
vi.mock('@/hooks/usePersonDetails', () => ({
  invalidatePersonDetails: vi.fn(),
  usePersonDetails: () => ({
    details: personDetails.current,
    loading: personDetails.loading,
    error: null,
    loaded: !personDetails.loading,
    unavailable: false,
    retry: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const refreshRoster = vi.fn(async () => {});
const applyRosterPerson = vi.fn();
const show = vi.fn();

/** Sat 14 March 2026 — the day the roster's badges are read against. */
const NOW = new Date(2026, 2, 14, 10, 0);

function details(overrides: Partial<PcoPersonDetails> = {}): PcoPersonDetails {
  return {
    pcoPersonId: '4200003',
    parentName: null,
    parentPhone: null,
    parentEmail: null,
    allergies: null,
    birthdate: null,
    householdAdult: true,
    contactWritable: true,
    profileWritable: true,
    parentCreatable: false,
    ...overrides,
  };
}

function openBadge(student: Student) {
  const data = {
    students: [student],
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
    refreshRoster,
    applyRosterPerson,
  } as unknown as DataContextValue;

  const auth = { user: { uid: 'core-1' }, can: () => true } as unknown as AuthContextValue;
  const toast: ToastContextValue = { show, dismiss: vi.fn(), toasts: [] };

  const wrap = (children: ReactNode) => (
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={data}>
          <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  );

  render(wrap(<RowBadgeModal student={student} action="birthday" onClose={() => {}} now={NOW} />));
}

function linked(overrides: Partial<Student> = {}): Student {
  return makeStudent({
    id: 'pco_4200003',
    firstName: 'Sofia',
    lastName: 'Delgado',
    pcoPersonId: '4200003',
    ...overrides,
  });
}

beforeEach(() => {
  updateStudentProfile.mockClear();
  refreshRoster.mockClear();
  applyRosterPerson.mockClear();
  show.mockClear();
  personDetails.current = details();
  personDetails.loading = false;
});

describe('the birthday badge', () => {
  it('offers to take a missing birthday when write-back is on', async () => {
    openBadge(linked({ birthday: null }));

    expect(screen.getByText(/holds no birthdate/)).toBeInTheDocument();
    // No "Add a birthday" press in between: the panel was opened by somebody
    // who already has the answer.
    expect(screen.getByRole('textbox', { name: 'Birthday' })).toBeInTheDocument();
    expect(screen.getByText(/year is optional/)).toBeInTheDocument();
  });

  /**
   * The whole point of one box rather than three: `1214` is a reading of what
   * somebody meant, and a reading nobody is shown is one nobody can correct.
   */
  it('says back the date it made of what was typed, as it is typed', async () => {
    openBadge(linked({ birthday: null }));

    const box = screen.getByRole('textbox', { name: 'Birthday' });
    await userEvent.type(box, '112');
    expect(box).toHaveValue('11 / 2');
    expect(screen.getByText(/^2 November/)).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, '1214');
    // The slashes are the box's, and the rest of the shape is drawn faded after
    // them — `MM / DD / YYYY` with the year still to come.
    expect(box).toHaveValue('12 / 14 / ');
    expect(screen.getByText('YYYY')).toBeInTheDocument();
    expect(screen.getByText(/^14 December/)).toBeInTheDocument();

    await userEvent.type(box, '2011');
    expect(box).toHaveValue('12 / 14 / 2011');
    expect(screen.getByText('14 December 2011.')).toBeInTheDocument();
  });

  /**
   * Planning Center stores a birthday with no year — 1885, and it shows no age
   * — so the day on its own is a complete answer rather than half of one.
   */
  it('takes a day with no year for a student it holds no birthdate for', async () => {
    openBadge(linked({ birthday: null }));

    await userEvent.type(screen.getByRole('textbox', { name: 'Birthday' }), '4/2');
    await userEvent.click(screen.getByRole('button', { name: /Save to Planning Center/ }));

    await waitFor(() => expect(updateStudentProfile).toHaveBeenCalled());
    expect(updateStudentProfile.mock.calls[0]?.[0]).toEqual({
      studentId: 'pco_4200003',
      birthday: '04-02',
    });
  });

  /**
   * The row rather than a re-read is the whole point, and it is worth asserting
   * negatively too: this used to force a roster refresh — every child in the
   * church, paged out of Planning Center — to learn back the date somebody had
   * just typed, with the leader watching a spinner through it.
   */
  it('writes the day upstream and takes the corrected row from the answer', async () => {
    openBadge(linked({ birthday: '03-14' }));

    expect(screen.getByText('14 March')).toBeInTheDocument();

    const box = screen.getByRole('textbox', { name: 'Birthday' });
    await userEvent.clear(box);
    await userEvent.type(box, '3/16');
    await userEvent.click(screen.getByRole('button', { name: /Save to Planning Center/ }));

    await waitFor(() => expect(updateStudentProfile).toHaveBeenCalled());
    expect(updateStudentProfile.mock.calls[0]?.[0]).toEqual({
      studentId: 'pco_4200003',
      birthday: '03-16',
    });
    await waitFor(() => expect(applyRosterPerson).toHaveBeenCalledWith(savedRow()));
    expect(refreshRoster).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith('Saved birthday in Planning Center.');
  });

  /**
   * A server that answers without a row — an older deploy — must still leave
   * the screen agreeing with Planning Center. `applyRosterPerson` is what falls
   * back to a read, so the assertion is that it is called at all.
   */
  it('still hands the write on when the answer carries no row', async () => {
    updateStudentProfile.mockResolvedValueOnce({
      data: { status: 'updated', wrote: ['birthdate'], message: 'Saved birthday in Planning Center.' },
    });
    openBadge(linked({ birthday: '03-14' }));

    const box = screen.getByRole('textbox', { name: 'Birthday' });
    await userEvent.clear(box);
    await userEvent.type(box, '3/16');
    await userEvent.click(screen.getByRole('button', { name: /Save to Planning Center/ }));

    await waitFor(() => expect(applyRosterPerson).toHaveBeenCalledWith(undefined));
  });

  /**
   * The year the roster does not carry and this read does. Without it the panel
   * printed "14 March" over a box opened on `03 / 14 /`, which reads as a year
   * nobody has ever filled in — on a student Planning Center holds one for.
   */
  it('shows the year Planning Center holds, and opens the box on it', () => {
    personDetails.current = details({ birthdate: '2011-03-14' });
    openBadge(linked({ birthday: '03-14' }));

    expect(screen.getByText('14 March 2011')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Birthday' })).toHaveValue('03 / 14 / 2011');
    expect(screen.queryByText(/holds no year/)).toBeNull();
  });

  /**
   * 1885 upstream — Planning Center's own "nobody knows" — arrives as the day
   * alone, and the sentence names whose gap it is. It used to say "Tally is not
   * sent the year", which is no longer true of anybody.
   */
  it('says the year is missing upstream when Planning Center has none', () => {
    personDetails.current = details({ birthdate: '03-14' });
    openBadge(linked({ birthday: '03-14' }));

    expect(screen.getByText('14 March')).toBeInTheDocument();
    expect(screen.getByText(/Planning Center holds no year for Sofia/)).toBeInTheDocument();
  });

  it('keeps the form open and says why when Planning Center refuses', async () => {
    updateStudentProfile.mockResolvedValueOnce({
      data: { status: 'invalid', wrote: [], message: 'Give the year too.' },
    });
    openBadge(linked({ birthday: '03-14' }));

    const box = screen.getByRole('textbox', { name: 'Birthday' });
    await userEvent.clear(box);
    await userEvent.type(box, '3/16');
    await userEvent.click(screen.getByRole('button', { name: /Save to Planning Center/ }));

    expect(await screen.findByText('Give the year too.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Birthday' })).toBeInTheDocument();
  });

  /**
   * The old behaviour, and still the right one when the church has not asked
   * Tally to write: say where the field lives rather than offer a box the write
   * path would refuse.
   */
  it('points upstream instead when write-back is not full', () => {
    personDetails.current = details({ profileWritable: false });
    openBadge(linked({ birthday: null }));

    expect(screen.queryByRole('button', { name: /birthday/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add one in Planning Center/ })).toBeInTheDocument();
  });

  it('has nowhere to put one for a visitor who has not reached Planning Center', () => {
    personDetails.current = null;
    openBadge(makeStudent({ id: 'tally-1', pcoPersonId: null, birthday: null }));

    expect(screen.getByText(/nowhere to put one/)).toBeInTheDocument();
  });
});
