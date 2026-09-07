/**
 * The birthday, on the student's own page.
 *
 * It used to be said nowhere here. The roster's badge only speaks in the
 * fortnight around the day — and, for a student with no date at all, only on a
 * wide screen — so the one screen that is *about* a student was silent about a
 * date the ministry exists to notice, and the only way to change one was to
 * know that "Edit profile" hides a box for it.
 *
 * So what is worth pinning down is the pair: that the date is on the profile
 * whether or not it is near, and that the way to fix it is the same
 * `EditBirthday` the roster badge opens — behind the same gate, which the
 * server answers and this page never guesses at.
 *
 * Below that, the other thing this page must not be quiet about: the gatherings
 * its reader was not shown. Same principle as the birthday — the profile is the
 * screen that says what is true about a student, so what it cannot see it has
 * to name rather than leave as a shorter-looking history.
 */
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { StudentDetailPage } from '@/features/students/StudentDetailPage';
import type { PcoPersonDetails, Student } from '@/types';
import { makeEvent, makeSettings, makeStudent } from '../../../tests/factories';

const updateStudentProfile = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ data: { status: string; wrote: string[]; message: string } }>>(
    async () => ({
      data: {
        status: 'updated',
        wrote: ['birthdate'],
        message: 'Saved birthday in Planning Center.',
      },
    }),
  ),
);
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
vi.mock('@/services/upstreamEdits', () => ({
  enqueueUpstreamEdit,
  // The record's sync strip reads the queue through `useData`; nothing in this
  // file drives it, and the real module reaches `@/lib/firebase`.
  cancelUpstreamEdit: async () => {},
  retryUpstreamEdit: async () => {},
  dismissUpstreamEdit: async () => {},
  subscribeUpstreamEdits: () => () => {},
}));

vi.mock('@/services/functions', () => ({
  updateStudentProfile,
  addRosterMember: vi.fn(),
  removeRosterMember: vi.fn(),
  pushStudentToPlanningCenter: vi.fn(),
  recreatePlanningCenterPerson: vi.fn(),
  setParentContact: vi.fn(),
  addParent: vi.fn(),
}));
vi.mock('@/services/students', () => ({ setStudentStatus: vi.fn(), updateStudent: vi.fn() }));
// The aging-out record streams from Firestore in the real page; nothing in
// this suite is about it, so the stream answers "none".
vi.mock('@/services/transitions', () => ({
  subscribeTransitions: (onChange: (transitions: never[]) => void) => {
    onChange([]);
    return () => {};
  },
  releaseStudent: vi.fn(),
  undoRelease: vi.fn(),
}));

/*
 * The two halves of the page that talk to Firestore. Neither has anything to
 * say about a birthday, and importing them reaches the service layer, which
 * calls `initializeApp` at module scope.
 */
const profileHistory = vi.hoisted(() => ({
  /** Event ids the reader was refused, as `useProfileHistory` reports them. */
  withheld: new Set<string>(),
}));
vi.mock('@/features/students/useProfileHistory', () => ({
  useProfileHistory: () => ({
    snapshots: [],
    withheld: profileHistory.withheld,
    loading: false,
    error: null,
  }),
}));
vi.mock('@/features/students/EarlierAttendance', () => ({ EarlierAttendance: () => null }));

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

/** Sat 14 March 2026 — the day every date on this page is read against. */
const NOW = new Date(2026, 2, 14, 10, 0);

const refreshRoster = vi.fn(async () => {});
const applyRosterPerson = vi.fn();
const show = vi.fn();

function details(overrides: Partial<PcoPersonDetails> = {}): PcoPersonDetails {
  return {
    pcoPersonId: '4200003',
    contactName: 'Ana Delgado',
    contactPhone: '5550100100',
    contactEmail: null,
    allergies: null,
    birthdate: null,
    householdAdult: true,
    contactWritable: true,
    profileWritable: true,
    adultCreatable: false,
    ...overrides,
  };
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

function openProfile(student: Student, over: Partial<DataContextValue> = {}) {
  vi.setSystemTime(NOW);

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
    upstreamEdits: [],
    ...over,
  } as unknown as DataContextValue;

  const auth = { user: { uid: 'core-1' }, can: () => true } as unknown as AuthContextValue;
  const toast: ToastContextValue = { show, dismiss: vi.fn(), toasts: [] };

  const wrap = (children: ReactNode) => (
    <MemoryRouter initialEntries={[`/students/${student.id}`]}>
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={data}>
          <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  );

  render(
    wrap(
      <Routes>
        <Route path="/students/:studentId" element={<StudentDetailPage />} />
      </Routes>,
    ),
  );
}

beforeEach(() => {
  updateStudentProfile.mockClear();
  refreshRoster.mockClear();
  applyRosterPerson.mockClear();
  show.mockClear();
  personDetails.current = details();
  personDetails.loading = false;
  profileHistory.withheld = new Set<string>();
});

/**
 * What the profile says about the part of the history it was not shown.
 *
 * Per-gathering access means a counselor who works Fridays and not Sundays is
 * refused the Sunday register — by design, and an ordinary thing to be. What is
 * not ordinary is a page that silently answers a shorter question: the streak,
 * the last-seen date and the grid are all built from the nights that came back,
 * so a dropped gathering makes a student look like they come less than they do,
 * on the screen somebody reads before deciding whether to ring their family.
 */
describe('a gathering the reader is not on', () => {
  const friday = makeEvent({
    id: 'friday-night',
    title: 'Friday Fellowship',
    seriesId: 'friday',
    startAt: new Date(2026, 2, 6, 19, 0),
    endAt: new Date(2026, 2, 6, 21, 0),
  });
  const sunday = makeEvent({
    id: 'sunday-morning',
    title: 'A title nobody typed',
    seriesId: 'sunday-school',
    startAt: new Date(2026, 2, 8, 9, 0),
    endAt: new Date(2026, 2, 8, 11, 0),
  });
  const series = [
    { id: 'friday', title: 'Friday Fellowship' },
    { id: 'sunday-school', title: 'Sunday School' },
  ];

  it('names it, and says the numbers above do not count it', () => {
    profileHistory.withheld = new Set(['sunday-morning']);

    openProfile(linked(), { events: [friday, sunday], series } as Partial<DataContextValue>);

    // By name — "some of this is missing" leaves a leader guessing at how much.
    // The series title, not the occurrence's own, so it reads the same here as
    // in the gathering headers below it.
    expect(screen.getByText(/Sunday School is left out/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing above counts those nights/)).toBeInTheDocument();
  });

  it('says nothing at all when the whole history was theirs to see', () => {
    openProfile(linked(), { events: [friday, sunday], series } as Partial<DataContextValue>);

    expect(screen.queryByText(/left out/)).not.toBeInTheDocument();
  });
});

describe('the birthday on a student profile', () => {
  /**
   * A birthday in August, read in March. The roster says nothing about it — by
   * design, the badge is a fortnight wide — and that is exactly the case where
   * the profile has to.
   */
  it('says the date even when it is nowhere near today', () => {
    openProfile(linked({ birthday: '08-22' }));

    expect(screen.getByText('22 August')).toBeInTheDocument();
  });

  it('marks the ones worth interrupting a read for', () => {
    openProfile(linked({ birthday: '03-14' }));

    expect(screen.getByText('14 March')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  /**
   * The year. The roster's row cannot carry one — eighty-five children on a
   * phone must not be eighty-five dates of birth — but this page has read
   * Planning Center for this one student, and a profile is where a date of
   * birth is a date of birth rather than a day to buy a cake on.
   */
  it('shows the year once Planning Center has been read for this student', async () => {
    personDetails.current = details({ birthdate: '2011-08-22' });
    openProfile(linked({ birthday: '08-22' }));

    expect(await screen.findByText('22 August 2011')).toBeInTheDocument();
  });

  /** And says whose gap it is when there is genuinely no year upstream. */
  it('says Planning Center holds no year when it holds none', async () => {
    personDetails.current = details({ birthdate: '08-22' });
    openProfile(linked({ birthday: '08-22' }));

    expect(await screen.findByText(/holds no year for them/)).toBeInTheDocument();
  });

  it('names the gap rather than leaving a blank', () => {
    openProfile(linked({ birthday: null }));

    expect(screen.getByText('Not on file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a birthday' })).toBeInTheDocument();
  });

  /**
   * The whole point of putting it here: a leader is told a birthday while
   * looking at the student, and the answer goes in without leaving the page.
   */
  it('takes a correction in place and queues it upstream', async () => {
    openProfile(linked({ birthday: '03-14' }));

    await userEvent.click(screen.getByRole('button', { name: 'Change' }));

    const box = screen.getByRole('textbox', { name: 'Birthday' });
    expect(box).toHaveValue('03 / 14 / ');

    await userEvent.clear(box);
    await userEvent.type(box, '0315');
    await userEvent.click(screen.getByRole('button', { name: /Save to Planning Center/ }));

    await waitFor(() =>
      expect(enqueueUpstreamEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'pco_4200003',
          patch: { birthday: '03-15' },
        }),
      ),
    );
    /*
     * Nothing re-reads and nothing is applied from an answer, because there is
     * no answer yet: the queued job is what every screen's copy of this
     * birthday comes from until the drain lands it, and `applyPendingEdits`
     * draws it marked as not upstream.
     */
    expect(applyRosterPerson).not.toHaveBeenCalled();
    expect(refreshRoster).not.toHaveBeenCalled();
    // And the box closes, rather than leaving a form open over the value it
    // just changed.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Birthday' })).toBeNull());
  });

  /**
   * Write-back turned down. Planning Center owns the field in every mode, so
   * the honest offer here is the record itself — never a box whose Save the
   * server would refuse.
   */
  it('points at Planning Center when Tally may not write', () => {
    personDetails.current = details({ profileWritable: false });
    openProfile(linked({ birthday: '03-14' }));

    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Change it there' }).getAttribute('href')).toContain(
      '4200003',
    );
  });

  /**
   * A visitor quick-added at a door. There is no record upstream to hold a
   * birthday yet, and Tally keeps none of its own — so this says where one will
   * go rather than offering a box that has nowhere to write.
   */
  it('explains that a student Tally created has nowhere to keep one yet', () => {
    personDetails.current = null;
    openProfile(linked({ id: 'local-1', pcoPersonId: null, birthday: null, isVisitor: true }));

    expect(screen.getByText('Not on file')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a birthday' })).toBeNull();
    expect(screen.getByText(/Tally keeps no birthday of its own/)).toBeInTheDocument();
  });
});
