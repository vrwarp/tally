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
import type { Student, UpstreamEdit } from '@/types';

const useData = vi.hoisted(() => vi.fn());
const useAuth = vi.hoisted(() => vi.fn());
const useParentContact = vi.hoisted(() => vi.fn());
const getPersonDetails = vi.hoisted(() => vi.fn());
const updateStudent = vi.hoisted(() => vi.fn(async () => {}));
const downloadCsv = vi.hoisted(() => vi.fn<(filename: string, contents: string) => void>());

// Mocked at the module boundary: a real anchor click on a `blob:` href makes
// jsdom log "Not implemented: navigation" and tells us nothing extra.
vi.mock('@/lib/download', () => ({
  downloadCsv,
  downloadOpensInViewer: () => false,
}));

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

function renderRoster(
  students: Student[],
  reachable: Record<string, boolean> = {},
  dataOverrides: Record<string, unknown> = {},
) {
  vi.setSystemTime(TODAY);

  useData.mockReturnValue({
    students,
    events: [],
    series: [],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: TODAY,
    rosterBackends: [],
    refreshRoster: vi.fn(async () => {}),
    upstreamEdits: [],
    ...dataOverrides,
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

function job(over: Partial<UpstreamEdit> = {}): UpstreamEdit {
  return {
    id: 'edit-1',
    studentId: 's1',
    patch: { lastName: 'Shin-Park', grade: 8 },
    baseline: { lastName: 'Shin', grade: 7 },
    state: 'queued',
    attempts: 0,
    nextAttemptAt: null,
    leaseUntil: null,
    failure: null,
    message: null,
    field: null,
    observed: null,
    survivorPersonId: null,
    survivorName: null,
    createdAt: TODAY,
    createdBy: 'counselor-1',
    createdByName: 'Dana Ruiz',
    updatedAt: TODAY,
    startedAt: null,
    settledAt: null,
    pendingOnDevice: false,
    ...over,
  };
}

/**
 * The band beside the name, which is the wide layout's whole answer to "so
 * what is being changed, and by whom".
 *
 * Worth pinning because it was missing for a while and nothing failed: the
 * phone chip was built, the desktop half was described in a comment and never
 * written, and a laptop showed a filtered in-flight list of rows saying
 * nothing at all. A test that only asserts the mark exists passes in that
 * state, so these assert the two facts the mark cannot carry.
 */
/**
 * A count on a filter is a promise about what pressing it produces.
 *
 * These were taken from the queue and the roster directly, which made them
 * answer a different question from the control they sit on. The first
 * walkthrough of the finished feature caught it in a photograph: "Needs you 6"
 * above a list of five, because a child merged upstream had gone inactive and
 * the status filter was hiding her from the list but not from the count.
 */
describe('the counts and the rows they filter to', () => {
  it('does not count a student the status filter is hiding', async () => {
    const user = userEvent.setup();
    renderRoster(
      [
        makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin' }),
        makeStudent({ id: 's2', firstName: 'Bea', lastName: 'Cruz', status: 'inactive' }),
      ],
      {},
      { upstreamEdits: [job({ state: 'failed' }), job({ id: 'edit-2', studentId: 's2', state: 'failed' })] },
    );

    // Active is the default view, so one of the two failures is out of sight.
    expect(screen.getByRole('button', { name: /Needs you/ })).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: /Needs you/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('counts them again when the roster is showing everybody', async () => {
    const user = userEvent.setup();
    renderRoster(
      [
        makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin' }),
        makeStudent({ id: 's2', firstName: 'Bea', lastName: 'Cruz', status: 'inactive' }),
      ],
      {},
      { upstreamEdits: [job({ state: 'failed' }), job({ id: 'edit-2', studentId: 's2', state: 'failed' })] },
    );

    // By role: the always-mounted editor modal has a Status field too, so a
    // label match finds two.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'all');
    expect(screen.getByRole('button', { name: /Needs you/ })).toHaveTextContent('2');
  });

  it('narrows the counts with the search box, like the list', async () => {
    const user = userEvent.setup();
    renderRoster(
      [
        makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin' }),
        makeStudent({ id: 's2', firstName: 'Bea', lastName: 'Cruz' }),
      ],
      {},
      { upstreamEdits: [job({ state: 'queued' }), job({ id: 'edit-2', studentId: 's2', state: 'queued' })] },
    );

    expect(screen.getByRole('button', { name: /In flight/ })).toHaveTextContent('2');
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'Aiden');
    expect(screen.getByRole('button', { name: /In flight/ })).toHaveTextContent('1');
  });
});

describe('the band a row wears while an edit of it is on its way', () => {
  it('names the fields changing and who asked for it', () => {
    renderRoster([makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin' })], {}, { upstreamEdits: [job()] });

    expect(within(row(/Aiden/)).getByText(/Last name and grade · you/)).toBeInTheDocument();
  });

  it('uses the author\u2019s first name when it is somebody else\u2019s edit', () => {
    renderRoster([makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin' })], {}, { upstreamEdits: [job({ createdBy: 'pastor-2' })] });

    expect(within(row(/Aiden/)).getByText(/Last name and grade · Dana/)).toBeInTheDocument();
  });

  it('keeps the band through the moment it says "Saved"', () => {
    renderRoster(
      [makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin', notes: 'Rides with Bea' })],
      {},
      { upstreamEdits: [job({ state: 'landed' })] },
    );

    // The green mark and the caption that says what it was arrive and leave
    // together. Splitting them would leave "Saved" on a row for a minute or
    // two without saying saved *what* — which is the state a leader is most
    // likely to be scanning, because it is the one they were waiting for.
    expect(within(row(/Aiden/)).getByText(/Last name and grade · you/)).toBeInTheDocument();
    expect(within(row(/Aiden/)).queryByText('Rides with Bea')).not.toBeInTheDocument();
  });

  it('gives the slot back to the note once the job is gone', () => {
    renderRoster(
      [makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin', notes: 'Rides with Bea' })],
      {},
      { upstreamEdits: [] },
    );

    // The sweeper deletes a landed job shortly after, and the row is at rest
    // again: the note is back, and nothing about the edit remains.
    expect(within(row(/Aiden/)).getByText('Rides with Bea')).toBeInTheDocument();
    expect(within(row(/Aiden/)).queryByText(/· you/)).not.toBeInTheDocument();
  });

  it('keeps the band while the job needs a human, when the note matters least', () => {
    renderRoster(
      [makeStudent({ id: 's1', firstName: 'Aiden', lastName: 'Shin', notes: 'Rides with Bea' })],
      {},
      { upstreamEdits: [job({ state: 'failed' })] },
    );

    expect(within(row(/Aiden/)).queryByText('Rides with Bea')).not.toBeInTheDocument();
    expect(within(row(/Aiden/)).getByText(/Last name and grade · you/)).toBeInTheDocument();
  });
});

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

describe('StudentsPage grade', () => {
  /**
   * An adult on a hand-picked roster.
   *
   * Planning Center holds neither a grade nor a graduation year for them, so
   * the sync's clamp parks them on `minGrade` and flags it. Every screen used
   * to read that clamp as a fact and print "6th grade" beside a grown man's
   * name and initials.
   */
  const volunteer = () =>
    makeStudent({
      id: 'pco_41',
      firstName: 'Alan',
      lastName: 'Wan',
      grade: null,
    });

  it('will not call somebody a 6th grader when nobody holds a grade', () => {
    renderRoster([volunteer()]);

    expect(within(row(/Alan/)).queryByText(/6th/)).not.toBeInTheDocument();
    expect(within(row(/Alan/)).getByText('No grade')).toBeInTheDocument();
  });

  it('says so in the accessible name of the row too', () => {
    renderRoster([volunteer()]);

    expect(screen.getByRole('link', { name: 'Alan Wan, no grade on file' })).toBeInTheDocument();
  });

  it('still prints a grade Planning Center genuinely holds', () => {
    renderRoster([
      makeStudent({ id: 'pco_9', firstName: 'Alena', lastName: 'Ruiz', grade: 6 }),
    ]);

    expect(within(row(/Alena/)).getByText('6th grade')).toBeInTheDocument();
  });

  it('keeps them out of a grade the filter asked for', async () => {
    const user = userEvent.setup();
    renderRoster([
      volunteer(),
      makeStudent({ id: 'pco_9', firstName: 'Alena', lastName: 'Ruiz', grade: 6 }),
    ]);

    // Found through its "All grades" option: the student editor sits mounted
    // and closed on this page, and its own grade select answers to the label.
    const filter = screen.getByRole('option', { name: 'All grades' }).closest('select')!;
    await user.selectOptions(filter, '6');

    expect(screen.getByRole('link', { name: /Alena/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alan Wan/ })).not.toBeInTheDocument();
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

/**
 * The export, and the two ways it could quietly hand somebody the wrong file.
 *
 * Both failures are invisible in the artefact: a CSV of the whole roster looks
 * exactly like a CSV of the filtered rows, and a CSV taken while a backend was
 * down looks exactly like a complete one.
 */
describe('StudentsPage export', () => {
  const THREE = [
    makeStudent({ id: 'pco_1', firstName: 'Amara', lastName: 'Okafor', grade: 9 }),
    makeStudent({ id: 'pco_2', firstName: 'Ben', lastName: 'Cole', grade: 8 }),
    makeStudent({ id: 'a32_3', firstName: 'Chidi', lastName: 'Eze', grade: 9 }),
  ];

  function exportButton() {
    return screen.getByRole('button', { name: /Export CSV/ });
  }

  it('exports the rows on screen, not the whole roster', async () => {
    const user = userEvent.setup();
    renderRoster(THREE);

    await user.type(screen.getByRole('searchbox', { name: /Search/i }), 'Amara');
    await user.click(exportButton());

    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());
    const [filename, contents] = downloadCsv.mock.calls.at(-1)!;
    // One header row and one student, and the filename says it was narrowed.
    expect(contents.trimEnd().split('\r\n')).toHaveLength(2);
    expect(contents).toContain('Amara');
    expect(contents).not.toContain('Chidi');
    expect(filename).toMatch(/^tally-roster-\d{4}-\d{2}-\d{2}-filtered\.csv$/);
  });

  it('exports everything, unflagged, when nothing is filtered', async () => {
    const user = userEvent.setup();
    renderRoster(THREE);

    await user.click(exportButton());

    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());
    const [filename, contents] = downloadCsv.mock.calls.at(-1)!;
    expect(contents.trimEnd().split('\r\n')).toHaveLength(4);
    expect(filename).toMatch(/^tally-roster-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('refuses outright when the roster read failed', () => {
    renderRoster(THREE, {}, { rosterError: { message: 'Planning Center is unreachable' } });

    // `students` here is a local copy of unknown age. A screen can carry a
    // banner saying so; a file cannot, because it gets forwarded.
    expect(exportButton()).toBeDisabled();
  });

  it('is disabled until the first read has settled', () => {
    renderRoster([], {}, { rosterLoading: true, rosterSettled: false });
    expect(exportButton()).toBeDisabled();
  });

  it('confirms before exporting a roster one backend could not answer for', async () => {
    const user = userEvent.setup();
    renderRoster(THREE, {}, {
      rosterBackends: [
        {
          backendId: 'pco',
          displayName: 'Planning Center',
          ok: true,
          error: null,
          people: 2,
          unresolved: 0,
          missing: 0,
          cached: false,
          fetchedAt: TODAY.toISOString(),
        },
        {
          backendId: 'a32',
          displayName: 'Attendees',
          ok: false,
          error: 'timed out',
          people: 1,
          unresolved: 2,
          missing: 0,
          cached: true,
          fetchedAt: new Date(2026, 2, 11).toISOString(),
        },
      ],
    });

    await user.click(exportButton());

    // Nothing has been written yet — the confirmation has to come before the
    // file exists, not as a toast after it.
    expect(downloadCsv).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Attendees');
    expect(dialog).toHaveTextContent('timed out');
    // The students who are not rows at all get a sentence, since they cannot
    // get a column.
    expect(dialog).toHaveTextContent(/2 roster entries could not be named/);

    await user.click(within(dialog).getByRole('button', { name: /Export anyway/ }));

    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());
    const [filename, contents] = downloadCsv.mock.calls.at(-1)!;
    expect(filename).toMatch(/-partial\.csv$/);
    // And the fact travels per row, not just in the name.
    expect(contents).toContain('source_read_at');
  });

  it('writes nothing when the confirmation is declined', async () => {
    const user = userEvent.setup();
    renderRoster(THREE, {}, {
      rosterBackends: [
        {
          backendId: 'a32',
          displayName: 'Attendees',
          ok: false,
          error: 'timed out',
          people: 1,
          unresolved: 0,
          missing: 0,
          cached: true,
          fetchedAt: TODAY.toISOString(),
        },
      ],
    });

    await user.click(exportButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Try again/ }));

    expect(downloadCsv).not.toHaveBeenCalled();
  });
});
