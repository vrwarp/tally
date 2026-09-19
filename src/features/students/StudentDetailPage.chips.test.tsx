/**
 * What a year of attendance costs the profile every time the clock moves.
 *
 * The page holds a `useNow(60_000)` — it has to, because the header is about
 * how long it has been since anybody saw this student — and a year of history
 * across three gatherings is around a hundred and fifty `NightChip`s. Before
 * the memo, every one of those re-rendered on every tick to produce a title it
 * had already produced: `eventSpoken` is an ICU interpolation per chip, over a
 * night that finished weeks ago and cannot change its mind. On the phones this
 * ministry actually uses, that is a minute-by-minute stall on a screen somebody
 * is reading.
 *
 * Counting chips is done by counting `useTimeFormats` calls, which is a hook
 * every chip calls exactly once, because React gives no honest way to ask "how
 * many times did that component render?" from the outside. Four calls belong to
 * the rest of the page — the page itself and one per gathering's release strip
 * — so the assertion is a small ceiling rather than a count of chips: the
 * property being pinned down is that the number does not scale with the history.
 *
 * The order assertion is here because the memo does not touch it and a reader
 * of this file should not have to take that on trust. The chips read oldest to
 * newest, which is what makes a run of misses read as a run, while
 * `group.entries` stays newest-first for `openRelease` — it takes the student's
 * most recent presence from the head of that list.
 */
import type { ReactNode } from 'react';
import type * as TimeFormatsModule from '@/hooks/useTimeFormats';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, render, screen, within } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { StudentDetailPage } from '@/features/students/StudentDetailPage';
import { formatShortDate, type TimeStrings } from '@/lib/time';
import type { EventAttendanceSnapshot, PcoPersonDetails, Student } from '@/types';
import { makeEvent, makeSettings, makeStudent } from '../../../tests/factories';

/**
 * One call per component that formats a date, and every chip formats three.
 *
 * The real hook is kept underneath rather than stubbed: a fake would change
 * what the chips render and the order assertion below reads their dates.
 */
const timeFormats = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/hooks/useTimeFormats', async (importOriginal) => {
  const actual = await importOriginal<typeof TimeFormatsModule>();
  return {
    ...actual,
    useTimeFormats: () => {
      timeFormats.calls += 1;
      return actual.useTimeFormats();
    },
  };
});

/*
 * The service boundary, exactly as `StudentDetailPage.test.tsx` draws it: these
 * modules call `initializeApp` at import, and nothing in this file presses
 * anything that would talk to Firestore.
 */
vi.mock('@/services/upstreamEdits', () => ({
  enqueueUpstreamEdit: vi.fn(),
  cancelUpstreamEdit: async () => {},
  retryUpstreamEdit: async () => {},
  dismissUpstreamEdit: async () => {},
  subscribeUpstreamEdits: () => () => {},
}));
vi.mock('@/services/functions', () => ({
  updateStudentProfile: vi.fn(),
  addRosterMember: vi.fn(),
  removeRosterMember: vi.fn(),
  pushStudentToPlanningCenter: vi.fn(),
  recreatePlanningCenterPerson: vi.fn(),
  setParentContact: vi.fn(),
  addParent: vi.fn(),
}));
vi.mock('@/services/students', () => ({ setStudentStatus: vi.fn(), updateStudent: vi.fn() }));
vi.mock('@/services/transitions', () => ({
  subscribeTransitions: (onChange: (transitions: never[]) => void) => {
    onChange([]);
    return () => {};
  },
  releaseStudent: vi.fn(),
  undoRelease: vi.fn(),
}));
vi.mock('@/features/students/EarlierAttendance', () => ({ EarlierAttendance: () => null }));
vi.mock('@/hooks/usePersonDetails', () => ({
  invalidatePersonDetails: vi.fn(),
  usePersonDetails: () => ({
    details: null as PcoPersonDetails | null,
    loading: false,
    error: null,
    loaded: true,
    unavailable: false,
    retry: vi.fn(),
    refresh: vi.fn(),
  }),
}));

/** Sat 14 March 2026 — the day the whole history is counted back from. */
const NOW = new Date(2026, 2, 14, 10, 0);

const STUDENT_ID = 'pco_4200003';
const WEEK_MS = 7 * 86_400_000;

const CHAINS = [
  { seriesId: 'friday', title: 'Friday Fellowship' },
  { seriesId: 'sunday-school', title: 'Sunday School' },
  { seriesId: 'wednesday', title: 'Midweek' },
];

/**
 * A year of three gatherings, built once at module scope.
 *
 * Identity matters more than the numbers here. The real `useProfileHistory`
 * hands back the previous array whenever the answer has not changed, precisely
 * so a ticking clock does not rebuild the page's groups — so a mock that minted
 * a fresh array per render would be testing a page nobody runs, and would defeat
 * the memo for a reason that has nothing to do with the memo.
 */
const SNAPSHOTS: EventAttendanceSnapshot[] = CHAINS.flatMap((chain) =>
  Array.from({ length: 52 }, (_, week) => {
    const startAt = new Date(NOW.getTime() - (week + 1) * WEEK_MS);
    const present = week % 3 === 0;
    return {
      event: makeEvent({
        id: `${chain.seriesId}-${week}`,
        title: chain.title,
        seriesId: chain.seriesId,
        startAt,
        endAt: new Date(startAt.getTime() + 2 * 60 * 60_000),
      }),
      presentStudentIds: new Set(present ? [STUDENT_ID] : []),
      checkedOutStudentIds: new Set<string>(),
      held: true,
    };
  }),
);

/** 156, and the assertions below are about this number not being paid twice. */
const CHIP_COUNT = SNAPSHOTS.length;

vi.mock('@/features/students/useProfileHistory', () => ({
  useProfileHistory: () => ({
    snapshots: SNAPSHOTS,
    withheld: new Set<string>(),
    loading: false,
    error: null,
  }),
}));

function openProfile(student: Student) {
  const data = {
    students: [student],
    events: [],
    series: CHAINS.map((chain) => ({ id: chain.seriesId, title: chain.title })),
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: null,
    refreshRoster: vi.fn(async () => {}),
    applyRosterPerson: vi.fn(),
    upstreamEdits: [],
  } as unknown as DataContextValue;

  const auth = { user: { uid: 'core-1' }, can: () => true } as unknown as AuthContextValue;
  const toast: ToastContextValue = { show: vi.fn(), dismiss: vi.fn(), toasts: [] };

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

function subject(): Student {
  return makeStudent({
    id: STUDENT_ID,
    firstName: 'Sofia',
    lastName: 'Delgado',
    pcoPersonId: '4200003',
  });
}

beforeEach(() => {
  /*
   * Scoped rather than wholesale. The page's minute clock is a `setInterval`
   * and the tick has to be driven by hand, but everything else on the page —
   * the person-details read, React's own scheduling — is ordinary async that a
   * fully faked timer table would hang.
   */
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  timeFormats.calls = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a profile's night chips", () => {
  it('does not re-render every chip when the minute clock ticks', async () => {
    openProfile(subject());

    // The history is on screen, all of it, before anything is counted.
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(CHIP_COUNT);

    timeFormats.calls = 0;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    /*
     * Four are the page's own: the profile, and one release strip per
     * gathering. A hundred and sixty is what this read before the memo — the
     * four, plus one for every chip — and the ceiling is deliberately a little
     * above four rather than exactly four, because what must not happen is the
     * count scaling with the history, not the page holding still forever.
     */
    expect(timeFormats.calls).toBeLessThanOrEqual(5);
    expect(timeFormats.calls).toBeLessThan(CHIP_COUNT);
  });

  it('still reads oldest to newest inside a gathering', () => {
    openProfile(subject());

    const heading = screen.getByRole('heading', { name: 'Friday Fellowship' });
    const section = heading.closest('section') as HTMLElement;
    const chips = within(section).getAllByRole('listitem');

    // The sr-only line is "Mar 7: They were here", and the date on it is the
    // only place the chip says which night it is in words.
    const spoken = chips.map((chip) => (chip.textContent ?? '').split(':')[0]);

    const strings = { locale: 'en' } as TimeStrings;
    const expected = SNAPSHOTS.filter((snapshot) => snapshot.event.seriesId === 'friday')
      .map((snapshot) => snapshot.event.startAt)
      .sort((a, b) => a.getTime() - b.getTime())
      .map((date) => formatShortDate(strings, date));

    expect(spoken).toEqual(expected);
  });
});
