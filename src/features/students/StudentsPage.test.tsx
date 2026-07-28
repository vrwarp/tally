/**
 * What a roster row is allowed to say, in what colour, and what happens when
 * somebody presses it.
 *
 * Three things this pins down, all of which had gone wrong by drift rather than
 * by decision:
 *
 * 1. Amber. `warnings.ts` rules that amber and a ⚠ mean a physical consequence
 *    at the door, and that an allergy is the only flag that earns one — a
 *    missing parent phone number is clerical and gets a neutral chip, so that a
 *    counselor never learns amber is usually paperwork. The check-in row obeyed
 *    that table; this page wrote its own badge and kept the old amber. The same
 *    student's missing contact was therefore a warning on one screen and a chip
 *    on the other, one navigation apart.
 * 2. The allergy itself, which this page did not show at all, though every row
 *    already carries `hasAllergies`.
 * 3. That a badge is a way in and not a label. Every flag on the row names
 *    something somebody would then have to go elsewhere to do.
 *
 * The tone assertions are deliberately about *tone*, not about text, because
 * the text is not the part that was wrong.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/context/ToastProvider';
import { StudentsPage } from '@/features/students/StudentsPage';
import { makeSettings, makeStudent } from '../../../tests/factories';
import type { Student } from '@/types';

const useData = vi.hoisted(() => vi.fn());
const useAuth = vi.hoisted(() => vi.fn());
const useParentContact = vi.hoisted(() => vi.fn());
const getPersonDetails = vi.hoisted(() => vi.fn());
const updateStudent = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/context/dataContext', () => ({ useData }));
vi.mock('@/context/authContext', () => ({ useAuth }));
vi.mock('@/hooks/useParentContact', () => ({
  useParentContact,
  invalidateParentContact: vi.fn(),
}));

/*
 * Two modals sit on this page permanently, both closed, and importing them
 * reaches the service layer — which calls `initializeApp` at module scope and
 * throws without a Firebase config. Stubbing the modules they bottom out in is
 * enough; nothing here presses anything that would talk to Firestore.
 */
vi.mock('@/lib/firebase', () => ({
  USE_EMULATORS: false,
  firebaseApp: {},
  db: {},
  auth: {},
  popupRedirectResolver: vi.fn(),
}));
vi.mock('@/services/functions', () => ({
  addRosterMember: vi.fn(),
  importPlanningCenterList: vi.fn(),
  searchPlanningCenterPeople: vi.fn(),
  pushStudentToPlanningCenter: vi.fn(),
  removeRosterMember: vi.fn(),
  setParentContact: vi.fn(),
  getPersonDetails,
}));
vi.mock('@/services/students', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateStudent,
  setStudentStatus: vi.fn(async () => {}),
}));

/** Tally's amber, from `Badge.tsx` — the one class that carries the meaning. */
const AMBER = 'text-warn-400';

/** Sat 14 March 2026, so the birthday windows are a fixed fortnight. */
const TODAY = new Date(2026, 2, 14, 10, 0);

function renderRoster(students: Student[], reachable: Record<string, boolean> = {}) {
  vi.setSystemTime(TODAY);

  useData.mockReturnValue({
    students,
    events: [],
    series: [],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: TODAY,
    refreshRoster: vi.fn(async () => {}),
  });
  // `useAuth().user` is the Firebase Auth user, not the profile document —
  // `uid` is what every write in this feature stamps itself with.
  useAuth.mockReturnValue({ user: { uid: 'counselor-1' } });
  useParentContact.mockReturnValue({
    reachable: new Map(Object.entries(reachable)),
    loading: false,
    loaded: true,
    error: null,
    refresh: vi.fn(),
  });

  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentsPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** The row itself, found through the link a leader would press. */
function row(name: RegExp) {
  return screen.getByRole('link', { name }).closest('li') as HTMLElement;
}

describe('StudentsPage roster rows', () => {
  it('gives the allergy an amber badge, on a page that used to omit it entirely', () => {
    renderRoster([
      makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin', hasAllergies: true }),
    ]);

    const badge = within(row(/Aiden/)).getByRole('button', { name: /allergic to/i });
    expect(badge).toHaveClass(AMBER);
    expect(badge).toHaveTextContent('Allergy');
  });

  it('states a missing parent contact as a neutral chip, never as amber', () => {
    renderRoster([
      makeStudent({
        id: 's1',
        firstName: 'Aaron',
        lastName: 'Mensah',
        profileComplete: false,
        hasAllergies: false,
      }),
    ]);

    const badge = within(row(/Aaron/)).getByRole('button', { name: /add a parent contact/i });
    expect(badge).not.toHaveClass(AMBER);
    expect(badge).toHaveTextContent('No contact');
  });

  it('spends amber on the allergy alone when a student carries both flags', () => {
    renderRoster([
      makeStudent({
        id: 's1',
        firstName: 'Almus',
        lastName: 'Au',
        profileComplete: false,
        hasAllergies: true,
      }),
    ]);

    const amber = within(row(/Almus/))
      .getAllByRole('button')
      .filter((badge) => badge.classList.contains(AMBER));
    expect(amber).toHaveLength(1);
    expect(amber[0]).toHaveAccessibleName(/allergic to/i);
  });

  it('reads the same answer the chip count reads, so the two cannot disagree', () => {
    // Tally holds no flag for this student — `profileComplete` is null, "nobody
    // looked" — and Planning Center's answer is the only one there is.
    renderRoster(
      [makeStudent({ id: 'pco_9', firstName: 'Alena', lastName: 'Ruiz', profileComplete: null })],
      { pco_9: false },
    );

    expect(within(row(/Alena/)).getByText('No contact')).toBeInTheDocument();
  });
});

describe('StudentsPage last-seen column', () => {
  it('says when a student was last around, compactly enough to be a column', () => {
    renderRoster([
      makeStudent({
        id: 's1',
        firstName: 'Allen',
        lastName: 'Yu',
        lastAttendedAt: new Date(2026, 1, 21, 19, 0),
      }),
    ]);

    expect(within(row(/Allen/)).getByText('3 wks ago')).toBeInTheDocument();
  });

  it('renders nothing rather than "Never" for a student nobody has seen', () => {
    renderRoster([
      makeStudent({ id: 's1', firstName: 'Alma', lastName: 'Alba', lastAttendedAt: null }),
    ]);

    // `lastAttendedAt` only reaches back to the day this ministry adopted
    // Tally, so a blank is the honest claim — and a lane of grey "Never" is a
    // lane the eye stops reading.
    expect(within(row(/Alma/)).queryByText(/never/i)).not.toBeInTheDocument();
  });
});

describe('StudentsPage note snippet', () => {
  it('shows what somebody typed about a student, in full on hover', () => {
    const note = 'Brother of Almus — same lift home';
    renderRoster([makeStudent({ id: 's1', firstName: 'Aaron', lastName: 'M', notes: note })]);

    expect(within(row(/Aaron/)).getByText(note)).toHaveAttribute('title', note);
  });
});

describe('StudentsPage birthday badges', () => {
  const withBirthday = (birthday: string | null, firstName = 'Bea') =>
    makeStudent({ id: 'pco_7', firstName, lastName: 'Okafor', pcoPersonId: '7', birthday });

  it('marks the day itself', () => {
    renderRoster([withBirthday('03-14')]);
    expect(within(row(/Bea/)).getByRole('button', { name: /birthday is today/i })).toHaveTextContent(
      'Today',
    );
  });

  it('marks the week ahead with the date, not the word "soon"', () => {
    renderRoster([withBirthday('03-18')]);
    expect(
      within(row(/Bea/)).getByRole('button', { name: /birthday is on 18 March/i }),
    ).toHaveTextContent('18 Mar');
  });

  it('marks the week behind too, because that is the one a ministry misses', () => {
    renderRoster([withBirthday('03-10')]);
    expect(
      within(row(/Bea/)).getByRole('button', { name: /birthday was on 10 March/i }),
    ).toHaveTextContent('10 Mar');
  });

  it('says so when Planning Center holds no birthdate', () => {
    renderRoster([withBirthday(null)]);
    expect(within(row(/Bea/)).getByText('No birthday')).toBeInTheDocument();
  });

  it('does not say it about a student Planning Center has never heard of', () => {
    // A quick-added visitor has no birthday for the same reason they have no
    // anything: their push has not landed. "Queued" already says that, and it
    // is the chip with the action on it.
    renderRoster([
      makeStudent({
        id: 'tally-1',
        firstName: 'Kylie',
        lastName: 'Novak',
        pcoPersonId: null,
        birthday: null,
      }),
    ]);

    expect(within(row(/Kylie/)).queryByText('No birthday')).not.toBeInTheDocument();
    expect(within(row(/Kylie/)).getByText('Queued')).toBeInTheDocument();
  });

  it('says nothing at all the rest of the year', () => {
    renderRoster([withBirthday('09-02')]);
    expect(within(row(/Bea/)).queryByText(/birthday/i)).not.toBeInTheDocument();
    expect(within(row(/Bea/)).queryByText(/🎂/)).not.toBeInTheDocument();
  });
});

describe('StudentsPage badge actions', () => {
  it('opens the allergy note without leaving the roster', async () => {
    const user = userEvent.setup();
    getPersonDetails.mockResolvedValue({
      data: { allergies: 'Peanuts — carries an EpiPen', contactWritable: false },
    });

    renderRoster([
      makeStudent({
        id: 'pco_4',
        firstName: 'Aiden',
        lastName: 'Shin',
        pcoPersonId: '4',
        hasAllergies: true,
      }),
    ]);

    await user.click(within(row(/Aiden/)).getByRole('button', { name: /allergic to/i }));

    const panel = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(panel).getByText(/carries an EpiPen/)).toBeInTheDocument(),
    );
    // Still on the roster — the row is behind the panel, not replaced by it.
    expect(screen.getAllByRole('link', { name: /Aiden/ }).length).toBeGreaterThan(0);
  });

  it('lets somebody take the visitor badge off a student who is not one any more', async () => {
    const user = userEvent.setup();
    renderRoster([
      makeStudent({ id: 's1', firstName: 'Kylie', lastName: 'Novak', isVisitor: true }),
    ]);

    await user.click(within(row(/Kylie/)).getByRole('button', { name: /marked as a visitor/i }));
    await user.click(await screen.findByRole('button', { name: /not a visitor any more/i }));

    await waitFor(() =>
      expect(updateStudent).toHaveBeenCalledWith(
        's1',
        { isVisitor: false },
        'counselor-1',
        expect.objectContaining({ id: 's1' }),
      ),
    );
  });

  it('does not follow the row link when a badge is pressed', async () => {
    const user = userEvent.setup();
    renderRoster([
      makeStudent({ id: 's1', firstName: 'Kylie', lastName: 'Novak', isVisitor: true }),
    ]);

    await user.click(within(row(/Kylie/)).getByRole('button', { name: /marked as a visitor/i }));

    // The badges sit on top of a row-wide link. If the press fell through, the
    // router would have navigated and this panel would never have opened.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Kylie/ }).length).toBeGreaterThan(0);
  });
});
