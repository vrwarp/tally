/**
 * "Today" on the day the clocks go back.
 *
 * Its own file because it pins the process's time zone, which `vitest`
 * isolates per file. The chooser slices on the calendar day, and a boundary
 * computed as midnight plus twenty-four hours lands at eleven at night on the
 * one day a year that has twenty-five.
 */
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen } from '@/test/rtl';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ChooseEvent } from '@/features/checkin/ChooseEvent';
import { invalidateSnapshotCache } from '@/hooks/useEventSnapshots';
import { makeEvent } from '../../../tests/factories';
import type { TallyEvent } from '@/types';

const fetchPastEvents = vi.fn();
const fetchAttendanceByEvent = vi.fn();

vi.mock('@/services/events', () => ({
  PAST_EVENTS_PAGE_SIZE: 12,
  fetchPastEvents: (...args: unknown[]) => fetchPastEvents(...args),
}));

vi.mock('@/services/attendance', () => ({
  fetchAttendanceByEvent: (...args: unknown[]) => fetchAttendanceByEvent(...args),
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
  fetchPastEvents.mockResolvedValue({ events: [], cursor: null, hasMore: false });
  fetchAttendanceByEvent.mockResolvedValue({ byEvent: new Map(), denied: new Set() });
});

function wrap(children: ReactNode) {
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
  const data = { access: new Map(), canWork: () => true } as unknown as DataContextValue;
  return (
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>
        <MemoryRouter>{children}</MemoryRouter>
      </DataContext.Provider>
    </AuthContext.Provider>
  );
}

/** A gathering in the last half hour of the day, with the house default window. */
function lateGathering(year: number, month: number, day: number): TallyEvent {
  const startAt = new Date(year, month, day, 23, 30);
  const endAt = new Date(year, month, day + 1, 1, 0);
  return makeEvent({
    id: 'late',
    title: 'Late Lock-In',
    startAt,
    endAt,
    checkInOpensAt: new Date(startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(endAt.getTime() + 3_600_000),
  });
}

describe('the chooser on the day the clocks go back', () => {
  it('is running in a zone that observes daylight saving', () => {
    // 1 Nov 2026 is twenty-five hours long in New York.
    const midnight = new Date(2026, 10, 1, 0, 0);
    const next = new Date(2026, 10, 2, 0, 0);
    expect(next.getTime() - midnight.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('still offers a gathering in the last hour of the day', async () => {
    // Quarter past four on 1 Nov 2026, looking ahead to half past eleven.
    render(wrap(<ChooseEvent events={[lateGathering(2026, 10, 1)]} now={new Date(2026, 10, 1, 16, 15)} />));

    expect(screen.getByRole('link', { name: /late lock-in/i })).toHaveAttribute('href', '/event/late');
    expect(screen.queryByText('Nothing on today')).not.toBeInTheDocument();
    await act(async () => {});
  });
});
