/**
 * The bands on the days the clocks change.
 *
 * Its own file because it pins the process's time zone, which `vitest`
 * isolates per file. "Today" and "next seven days" are calendar bands, and a
 * boundary computed as midnight plus a round number of hours is an hour out
 * on the two days a year that are not twenty-four hours long.
 */
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, within } from '@/test/rtl';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { EventsPage } from '@/features/events/EventsPage';
import { invalidateSnapshotCache } from '@/hooks/useEventSnapshots';
import { makeEvent, makeSettings } from '../../../tests/factories';
import type { TallyEvent } from '@/types';

const fetchPastEvents = vi.fn();
const fetchAttendanceByEvent = vi.fn();

vi.mock('@/services/events', () => ({
  PAST_EVENTS_PAGE_SIZE: 12,
  fetchPastEvents: (...args: unknown[]) => fetchPastEvents(...args),
  setEventStatus: vi.fn(),
}));

vi.mock('@/services/attendance', () => ({
  fetchAttendanceByEvent: (...args: unknown[]) => fetchAttendanceByEvent(...args),
}));

vi.mock('@/features/events/EventEditorModal', () => ({
  EventEditorModal: () => null,
}));

vi.mock('@/features/events/ImportCheckInsModal', () => ({
  ImportCheckInsModal: () => null,
}));

vi.mock('@/services/users', () => ({
  subscribeUsers: (next: (value: never[]) => void) => {
    next([]);
    return () => {};
  },
}));

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'America/New_York';
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

beforeEach(() => {
  invalidateSnapshotCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchPastEvents.mockResolvedValue({ events: [], cursor: null, hasMore: false });
  fetchAttendanceByEvent.mockResolvedValue({ byEvent: new Map(), denied: new Set() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** A gathering in the last half hour of a day, with the house default window. */
function lateOn(year: number, month: number, day: number, title: string): TallyEvent {
  const startAt = new Date(year, month, day, 23, 30);
  const endAt = new Date(year, month, day + 1, 1, 0);
  return makeEvent({
    title,
    startAt,
    endAt,
    checkInOpensAt: new Date(startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(endAt.getTime() + 3_600_000),
  });
}

function show(events: readonly TallyEvent[], now: Date) {
  vi.setSystemTime(now);
  const data = {
    students: [],
    events: [...events],
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
    access: new Map(),
    canWork: () => true,
    refreshRoster: async () => {},
    applyRosterPerson: () => {},
    upstreamEdits: [],
  } as unknown as DataContextValue;
  const auth = {
    status: 'ready',
    stage: null,
    user: null,
    profile: null,
    error: null,
    signInWithGoogle: async () => {},
    signOut: async () => {},
    refreshProfile: async () => {},
    clearError: () => {},
    can: () => true,
  } as unknown as AuthContextValue;
  const toast: ToastContextValue = { toasts: [], show: vi.fn(), dismiss: vi.fn() };
  const tree: ReactNode = (
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <ToastContext.Provider value={toast}>
          <MemoryRouter>
            <EventsPage />
          </MemoryRouter>
        </ToastContext.Provider>
      </DataContext.Provider>
    </AuthContext.Provider>
  );
  return render(tree);
}

function band(name: RegExp) {
  return screen.getByRole('region', { name });
}

describe('the bands across a clock change', () => {
  it('is running in a zone that observes daylight saving', () => {
    // 1 Nov 2026 is twenty-five hours long in New York.
    expect(new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime()).toBe(
      25 * 60 * 60 * 1000,
    );
  });

  it('keeps a gathering in the last hour of the day the clocks go back in today', async () => {
    show([lateOn(2026, 10, 1, 'Late Lock-In')], new Date(2026, 10, 1, 16, 15));

    expect(within(band(/^today$/i)).getByText('Late Lock-In')).toBeInTheDocument();
    await act(async () => {});
  });

  it('still counts day seven as part of the coming week across the change', async () => {
    // Viewed on 31 Oct; 7 Nov is the seventh day and the band is inclusive of it.
    show([lateOn(2026, 10, 7, 'Saturday Social')], new Date(2026, 9, 31, 16, 15));

    expect(within(band(/next seven days/i)).getByText('Saturday Social')).toBeInTheDocument();
    await act(async () => {});
  });
});
