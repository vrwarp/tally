/**
 * What the roster is allowed to say about itself while a search is catching up.
 *
 * The list is rendered from a deferred copy of the search box (see
 * `deferredQuery` in `StudentsPage`), which buys back the keystroke on a
 * five-hundred-name roster and costs one commit where the box and the rows
 * disagree: the letter is already on screen, the filtered rows are not. That
 * commit is real and a leader sees it, so everything the page derives from the
 * roster has to be derived from the *same* copy of the query — or the screen
 * spends a frame describing a list it is not showing.
 *
 * The one that bites is the empty state. Clear a search that matched nobody and
 * the intermediate commit has an empty box and still-empty rows: read from the
 * live query, the card decides nothing is filtered, and a ministry with five
 * hundred students on the roster is told it has none and offered a button to
 * import them. This file pins that commit down by recording what `EmptyState`
 * was handed on every render, rather than by looking at the DOM after the dust
 * has settled — after the deferred render lands there is nothing left to see,
 * which is exactly why the bug survived being typed at by hand.
 */
import { createElement } from 'react';
import type * as FeedbackModule from '@/components/ui/Feedback';
import { render, screen } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/context/ToastProvider';
import { StudentsPage } from '@/features/students/StudentsPage';
import { makeSettings, makeStudent } from '../../../tests/factories';
import type { Student } from '@/types';

const useData = vi.hoisted(() => vi.fn());
const useAuth = vi.hoisted(() => vi.fn());
const useAdultContact = vi.hoisted(() => vi.fn());

/** Every title `EmptyState` was rendered with, in commit order. See below. */
const shown = vi.hoisted(() => ({ emptyTitles: [] as string[] }));

/*
 * The probe. `@/components/ui` re-exports `EmptyState` from here, so mocking
 * this module alone is enough to see what the page rendered on every commit —
 * including the one the deferred render immediately replaces, which no query of
 * the settled DOM can reach.
 */
vi.mock('@/components/ui/Feedback', async (importOriginal) => {
  const actual = await importOriginal<typeof FeedbackModule>();
  return {
    ...actual,
    EmptyState: (props: Parameters<typeof actual.EmptyState>[0]) => {
      shown.emptyTitles.push(props.title);
      return createElement(actual.EmptyState, props);
    },
  };
});

vi.mock('@/context/dataContext', () => ({ useData }));
vi.mock('@/context/authContext', () => ({ useAuth }));
vi.mock('@/hooks/useAdultContact', () => ({
  useAdultContact,
  invalidateAdultContact: vi.fn(),
}));

/*
 * The same boundary `StudentsPage.test.tsx` stubs, and for the same reason: two
 * modals sit on this page permanently, both closed, and importing them reaches
 * the service layer, which calls `initializeApp` at module scope.
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
  getPersonDetails: vi.fn(),
}));
vi.mock('@/services/students', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateStudent: vi.fn(async () => {}),
  setStudentStatus: vi.fn(async () => {}),
}));

/** Sat 14 March 2026, so nothing here depends on the day it is run. */
const TODAY = new Date(2026, 2, 14, 10, 0);

function renderRoster(students: Student[]) {
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
  });
  useAuth.mockReturnValue({ user: { uid: 'counselor-1' } });
  useAdultContact.mockReturnValue({
    reachable: new Map(),
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

beforeEach(() => {
  shown.emptyTitles = [];
});

describe('the roster while the deferred search catches up', () => {
  const roster = [
    makeStudent({ id: 's1', firstName: 'Marcus', lastName: 'Bell' }),
    makeStudent({ id: 's2', firstName: 'Sofia', lastName: 'Delgado' }),
    makeStudent({ id: 's3', firstName: 'Priya', lastName: 'Raman' }),
  ];

  it('never offers to import a roster it is already holding', async () => {
    const user = userEvent.setup();
    renderRoster(roster);

    const search = screen.getByRole('searchbox', { name: /search/i });
    await user.type(search, 'zzz');
    expect(screen.getByText('Nobody matches those filters.')).toBeInTheDocument();

    // Only the clearing matters: up to here the box and the rows agree about
    // there being a search, whichever copy of the query the card reads.
    shown.emptyTitles = [];
    await user.click(screen.getByRole('button', { name: /clear search/i }));

    // The commit the deferred render replaces: an empty box over the rows the
    // old query left behind — which is to say none of them. If the card took
    // `isFiltered` from the live query it decided the roster itself was empty
    // here, and said so over three students.
    expect(shown.emptyTitles.length).toBeGreaterThan(0);
    expect(shown.emptyTitles).not.toContain('No students on the roster yet.');
    expect(new Set(shown.emptyTitles)).toEqual(new Set(['Nobody matches those filters.']));

    // And the settled screen is the roster again, with no empty state at all.
    expect(screen.getByRole('link', { name: /Marcus Bell/ })).toBeInTheDocument();
    expect(screen.queryByText('Nobody matches those filters.')).not.toBeInTheDocument();
  });
});
