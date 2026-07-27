/**
 * The screen most of the week is spent on.
 *
 * The redesign is a claim about ordering: today first and in full, the week
 * ahead as rows under it, and the ministry's whole history below that. These
 * assert the claim rather than the markup — what a counselor reads, and in what
 * order they read it — because the point of the three sections is that a
 * gathering lands in exactly one of them and the boundaries are where the bugs
 * live (an event that finished this afternoon is still today's; one that
 * finished yesterday is history).
 *
 * Firestore is mocked at the service boundary: `fetchPastEvents` and
 * `fetchAttendanceByEvent` are the only two calls anything here makes.
 */
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { NoActiveEvent } from '@/features/checkin/NoActiveEvent';
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

/** Wednesday 29 July 2026, quarter past four in the afternoon. */
const NOW = new Date(2026, 6, 29, 16, 15);

function at(day: number, hour: number, minutes = 0): Date {
  return new Date(2026, 6, day, hour, minutes);
}

/** An event with its check-in window an hour either side, like the house default. */
function event(overrides: Partial<TallyEvent> & { startAt: Date; endAt: Date }): TallyEvent {
  return makeEvent({
    checkInOpensAt: new Date(overrides.startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(overrides.endAt.getTime() + 3_600_000),
    ...overrides,
  });
}

function auth(role: 'counselor' | 'core' = 'core'): AuthContextValue {
  return {
    status: 'ready',
    stage: null,
    user: null,
    profile: null,
    error: null,
    signInWithGoogle: async () => {},
    signOut: async () => {},
    refreshProfile: async () => {},
    clearError: () => {},
    can: (required) => required === 'counselor' || role === 'core',
  } as AuthContextValue;
}

function wrap(children: ReactNode, role: 'counselor' | 'core' = 'core') {
  return (
    <AuthContext.Provider value={auth(role)}>
      <MemoryRouter>{children}</MemoryRouter>
    </AuthContext.Provider>
  );
}

function show(events: readonly TallyEvent[], role: 'counselor' | 'core' = 'core') {
  return render(wrap(<NoActiveEvent events={events} now={NOW} />, role));
}

/**
 * Let the first page of history land.
 *
 * The list below the fold reads Firestore on mount, and a test that asserts on
 * the sections above it would otherwise finish with that read still in flight —
 * which React reports as an update outside `act` rather than as a failure, and
 * so hides in the noise.
 */
async function settle() {
  await act(async () => {});
}

/** The `<section>` a heading names, so assertions can be scoped to one band. */
function band(name: RegExp) {
  return screen.getByRole('region', { name });
}

beforeEach(() => {
  invalidateSnapshotCache();
  fetchPastEvents.mockResolvedValue({ events: [], cursor: null, hasMore: false });
  fetchAttendanceByEvent.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Today                                                                       */
/* -------------------------------------------------------------------------- */

describe('the hero', () => {
  it('leads with the gathering that is on today, icon and description and all', async () => {
    show([
      event({
        id: 'tonight',
        title: 'Friday Fellowship',
        description: 'Games, a talk and pizza.',
        icon: 'groups',
        startAt: at(29, 19),
        endAt: at(29, 21),
      }),
    ]);

    const today = band(/today/i);
    expect(within(today).getByText('Friday Fellowship')).toBeInTheDocument();
    expect(within(today).getByText('Games, a talk and pizza.')).toBeInTheDocument();
    expect(within(today).getByRole('link', { name: /take attendance/i })).toHaveAttribute(
      'href',
      '/event/tonight',
    );

    await settle();
  });

  it('says when check-in opens, so nobody has to work it out against a clock', async () => {
    show([event({ startAt: at(29, 19), endAt: at(29, 21) })]);

    expect(within(band(/today/i)).getByText(/check-in opens at 6:00 PM/i)).toBeInTheDocument();
    await settle();
  });

  it('invites a counselor straight in once the window is open', async () => {
    show([event({ startAt: at(29, 16), endAt: at(29, 18) })]);

    const today = band(/today/i);
    expect(within(today).getByText('Check-in open')).toBeInTheDocument();
    expect(within(today).getByRole('link', { name: /start check-in/i })).toBeInTheDocument();
    await settle();
  });

  it('keeps a gathering that finished this afternoon at the top, with its head count', async () => {
    // The boundary that matters: "today" is a day, not an instant. A counselor
    // catching up at teatime should not have to scroll into the history for the
    // event they were at three hours ago.
    fetchAttendanceByEvent.mockResolvedValue(new Map([['earlier', new Set(['a', 'b', 'c'])]]));

    show([event({ id: 'earlier', startAt: at(29, 9), endAt: at(29, 11) })]);

    expect(await within(band(/today/i)).findByText(/finished · 3 checked in/i)).toBeInTheDocument();
  });

  it('says so plainly when nothing is on', async () => {
    show([]);

    expect(screen.getByText('Nothing on today')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /today/i })).not.toBeInTheDocument();
    await settle();
  });
});

/* -------------------------------------------------------------------------- */
/* The week ahead                                                              */
/* -------------------------------------------------------------------------- */

describe('the week ahead', () => {
  it('holds the next seven days and nothing beyond them', async () => {
    show([
      event({ title: 'Sunday School', startAt: at(31, 9, 30), endAt: at(31, 10, 45) }),
      event({ title: 'Winter Retreat', startAt: at(31 + 21, 17), endAt: at(31 + 23, 15) }),
    ]);

    const week = band(/next seven days/i);
    expect(within(week).getByText('Sunday School')).toBeInTheDocument();
    expect(within(week).queryByText('Winter Retreat')).not.toBeInTheDocument();

    await settle();
  });

  it('does not claim a section it has nothing to put in', async () => {
    show([event({ startAt: at(29, 19), endAt: at(29, 21) })]);

    expect(screen.queryByRole('region', { name: /next seven days/i })).not.toBeInTheDocument();
    await settle();
  });
});

/* -------------------------------------------------------------------------- */
/* The history                                                                 */
/* -------------------------------------------------------------------------- */

describe('the history', () => {
  it('reads back from midnight this morning, so today is never in it twice', async () => {
    show([event({ startAt: at(29, 9), endAt: at(29, 11) })]);

    await settle();
    expect(fetchPastEvents).toHaveBeenCalledWith(new Date(2026, 6, 29), null, 12);
  });

  it('shows how many students were checked in', async () => {
    fetchPastEvents.mockResolvedValue({
      events: [
        event({ id: 'last-friday', title: 'Friday Fellowship', startAt: at(24, 19), endAt: at(24, 21) }),
      ],
      cursor: null,
      hasMore: false,
    });
    fetchAttendanceByEvent.mockResolvedValue(
      new Map([['last-friday', new Set(['a', 'b', 'c', 'd'])]]),
    );

    show([]);

    const past = await screen.findByRole('region', { name: /past gatherings/i });
    expect(await within(past).findByText('4')).toBeInTheDocument();
    expect(within(past).getByText('4 students checked in')).toBeInTheDocument();
  });

  it('will not print a bold nought for a gathering that never happened', async () => {
    // Tally reads a finished event with no attendance as one that did not run —
    // it is excluded from prediction and from the trend. A `0` beside it would
    // assert a turnout the rest of the app does not believe in.
    fetchPastEvents.mockResolvedValue({
      events: [event({ id: 'snowed-off', startAt: at(24, 19), endAt: at(24, 21) })],
      cursor: null,
      hasMore: false,
    });
    fetchAttendanceByEvent.mockResolvedValue(new Map([['snowed-off', new Set()]]));

    show([]);

    const past = await screen.findByRole('region', { name: /past gatherings/i });
    expect(await within(past).findByText('Nobody')).toBeInTheDocument();
    expect(within(past).queryByText('0')).not.toBeInTheDocument();
  });

  it('groups the list by month, because every Friday looks like every Friday', async () => {
    fetchPastEvents.mockResolvedValue({
      events: [
        event({ id: 'jul', startAt: at(24, 19), endAt: at(24, 21) }),
        event({ id: 'jun', startAt: new Date(2026, 5, 26, 19), endAt: new Date(2026, 5, 26, 21) }),
      ],
      cursor: null,
      hasMore: false,
    });

    show([]);

    const past = await screen.findByRole('region', { name: /past gatherings/i });
    expect(await within(past).findByRole('heading', { name: /july 2026/i })).toBeInTheDocument();
    expect(within(past).getByRole('heading', { name: /june 2026/i })).toBeInTheDocument();
  });

  it('offers a way back when a page will not load', async () => {
    fetchPastEvents.mockRejectedValue(new Error('offline'));

    show([]);

    expect(await screen.findByText(/could not load older gatherings/i)).toBeInTheDocument();

    fetchPastEvents.mockResolvedValue({
      events: [event({ id: 'recovered', title: 'Sunday School', startAt: at(26, 9), endAt: at(26, 11) })],
      cursor: null,
      hasMore: false,
    });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Sunday School')).toBeInTheDocument();
  });

  it('stays out of the way entirely when there is no history', async () => {
    show([]);

    await settle();
    expect(screen.queryByRole('region', { name: /past gatherings/i })).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('the way out', () => {
  it('puts the events link above the history, where it can still be reached', async () => {
    show([]);
    await settle();

    expect(screen.getByRole('link', { name: /manage events/i })).toHaveAttribute('href', '/events');
  });

  it('tells a counselor who to ask instead', async () => {
    show([], 'counselor');
    await settle();

    expect(screen.queryByRole('link', { name: /manage events/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ask the core team/i)).toBeInTheDocument();
  });
});
