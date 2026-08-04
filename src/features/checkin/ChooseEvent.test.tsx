/**
 * "Which gathering are you at?"
 *
 * The claim under test is that Tally no longer answers this itself. It used to
 * pick from the clock and open straight into a roster, and the failure that
 * bought — forty students filed against the wrong night, silently — is worse
 * than the tap it saved. So these assert what a counselor is offered: today's
 * gatherings and nothing else, the live one first, and a short catch-up tail
 * that is the only route a counselor has to a Friday nobody took the register
 * for (the Events tab is core-team only).
 *
 * Firestore is mocked at the service boundary: `fetchPastEvents` and
 * `fetchAttendanceByEvent` are the only two calls anything here makes.
 */
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
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

function auth(role: 'counselor' | 'core'): AuthContextValue {
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

function wrap(children: ReactNode, role: 'counselor' | 'core') {
  return (
    <AuthContext.Provider value={auth(role)}>
      <MemoryRouter>{children}</MemoryRouter>
    </AuthContext.Provider>
  );
}

function show(events: readonly TallyEvent[], role: 'counselor' | 'core' = 'core') {
  return render(wrap(<ChooseEvent events={events} now={NOW} />, role));
}

/** The same, at an hour of the caller's choosing — for the night that runs late. */
function showAt(events: readonly TallyEvent[], now: Date, role: 'counselor' | 'core' = 'core') {
  return render(wrap(<ChooseEvent events={events} now={now} />, role));
}

/**
 * Let the catch-up read land.
 *
 * The tail at the bottom reads Firestore on mount, and a test that asserts only
 * on the cards above it would otherwise finish with that read in flight — which
 * React reports as an update outside `act` rather than as a failure, and so
 * hides in the noise.
 */
async function settle() {
  await act(async () => {});
}

/** The hero cards, in the order they are painted. */
function cardLinks() {
  return screen
    .getAllByRole('link')
    .filter((node) => /check-in|attendance/i.test(node.textContent ?? ''));
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
/* The choice                                                                  */
/* -------------------------------------------------------------------------- */

describe('choosing a gathering', () => {
  it('offers today’s gathering as a card, icon and description and all', async () => {
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

    expect(screen.getByText('Friday Fellowship')).toBeInTheDocument();
    expect(screen.getByText('Games, a talk and pizza.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /friday fellowship/i })).toHaveAttribute(
      'href',
      '/event/tonight',
    );

    await settle();
  });

  it('opens nothing on its own — a live gathering is offered, not entered', async () => {
    // The whole point of the screen. A gathering whose window is open used to
    // be selected silently; now it is a card somebody has to tap.
    show([event({ id: 'live', startAt: at(29, 16), endAt: at(29, 18) })]);

    expect(screen.getByText('Check-in open')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start check-in/i })).toHaveAttribute(
      'href',
      '/event/live',
    );

    await settle();
  });

  it('says when check-in opens, so nobody has to work it out against a clock', async () => {
    show([event({ startAt: at(29, 19), endAt: at(29, 21) })]);

    expect(screen.getByText(/check-in opens at 6:00 PM/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /take attendance/i })).toBeInTheDocument();
    await settle();
  });

  it('puts the gathering that is actually happening first', async () => {
    show([
      event({ id: 'evening', title: 'Evening prayer', startAt: at(29, 19), endAt: at(29, 20) }),
      event({ id: 'now', title: 'Afternoon club', startAt: at(29, 16), endAt: at(29, 18) }),
    ]);

    expect(cardLinks()[0]).toHaveTextContent('Afternoon club');
    await settle();
  });

  it('phrases the heading as a question only when there is a choice to make', async () => {
    const { unmount } = show([event({ startAt: at(29, 19), endAt: at(29, 21) })]);
    expect(screen.getByRole('heading', { name: 'On today' })).toBeInTheDocument();
    await settle();
    unmount();

    show([
      event({ title: 'Morning class', startAt: at(29, 9), endAt: at(29, 11) }),
      event({ title: 'Evening prayer', startAt: at(29, 19), endAt: at(29, 20) }),
    ]);
    expect(screen.getByRole('heading', { name: 'Which gathering?' })).toBeInTheDocument();
    await settle();
  });

  it('keeps a gathering that finished this afternoon on the list', async () => {
    // "Today" is a day, not an instant. A counselor catching up at teatime
    // should find the event they were at three hours ago right here.
    show([event({ id: 'earlier', title: 'Morning class', startAt: at(29, 9), endAt: at(29, 11) })]);

    expect(screen.getByRole('link', { name: /morning class/i })).toHaveAttribute(
      'href',
      '/event/earlier',
    );
    await settle();
  });

  it('keeps a gathering that started before midnight and is still open', async () => {
    /*
     * The lock-in at half eleven, twenty past midnight.
     *
     * By the calendar it began yesterday, so a screen that slices on the day a
     * gathering starts drops it — and the counselor on the door, checking
     * people in right now, gets "Nothing on today" instead of the thing they
     * are standing at. This is also what took CI down: the seed's synthetic
     * live gathering starts half an hour ago, which before half past midnight
     * is yesterday, so every end-to-end run in that window found no card.
     */
    showAt(
      [
        event({
          id: 'lock-in',
          title: 'Fall Lock-In',
          startAt: new Date(2026, 6, 28, 23, 30),
          endAt: new Date(2026, 6, 29, 8, 0),
        }),
      ],
      new Date(2026, 6, 29, 0, 20),
    );

    expect(screen.getByRole('link', { name: /start check-in/i })).toHaveAttribute(
      'href',
      '/event/lock-in',
    );
    expect(screen.queryByText('Nothing on today')).not.toBeInTheDocument();
    await settle();
  });

  it('still drops a gathering that started yesterday and has closed', async () => {
    // The rule is "open", not "recent" — last night's finished Friday belongs
    // in the catch-up tail, not at the top of the screen.
    showAt(
      [
        event({
          id: 'last-night',
          title: 'Friday Fellowship',
          startAt: new Date(2026, 6, 28, 19, 0),
          endAt: new Date(2026, 6, 28, 21, 0),
        }),
      ],
      new Date(2026, 6, 29, 0, 20),
    );

    expect(screen.getByText('Nothing on today')).toBeInTheDocument();
    await settle();
  });

  it('shows nothing from tomorrow, or from next month', async () => {
    show([
      event({ title: 'Sunday School', startAt: at(31, 9, 30), endAt: at(31, 10, 45) }),
      event({ title: 'Winter Retreat', startAt: at(31 + 21, 17), endAt: at(31 + 23, 15) }),
    ]);

    expect(screen.queryByText('Sunday School')).not.toBeInTheDocument();
    expect(screen.queryByText('Winter Retreat')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing on today')).toBeInTheDocument();
    await settle();
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing on                                                                  */
/* -------------------------------------------------------------------------- */

describe('when nothing is on', () => {
  it('points the core team at the calendar', async () => {
    show([], 'core');

    expect(screen.getByText('Nothing on today')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to events/i })).toHaveAttribute('href', '/events');
    await settle();
  });

  it('tells a counselor who to ask, since they have no events tab', async () => {
    show([], 'counselor');

    expect(screen.getByText(/ask the core team/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /go to events/i })).not.toBeInTheDocument();
    await settle();
  });
});

/* -------------------------------------------------------------------------- */
/* Catching up                                                                 */
/* -------------------------------------------------------------------------- */

describe('the catch-up tail', () => {
  it('reads back from midnight, so today is never offered twice', async () => {
    show([event({ startAt: at(29, 9), endAt: at(29, 11) })]);

    await settle();
    expect(fetchPastEvents).toHaveBeenCalledWith(new Date(2026, 6, 29), null, 5);
  });

  it('does not repeat last night’s gathering while it is still open', async () => {
    /*
     * The tail reads back from midnight, so a gathering that began before it is
     * in *both* lists the moment the one above stops slicing by calendar day.
     * Catching up is for gatherings nobody can still be standing at.
     */
    const lockIn = event({
      id: 'lock-in',
      title: 'Fall Lock-In',
      startAt: new Date(2026, 6, 28, 23, 30),
      endAt: new Date(2026, 6, 29, 8, 0),
    });
    fetchPastEvents.mockResolvedValue({ events: [lockIn], cursor: null, hasMore: false });

    showAt([lockIn], new Date(2026, 6, 29, 0, 20));
    await settle();

    expect(screen.getByRole('link', { name: /start check-in/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /catch up/i })).not.toBeInTheDocument();
  });

  it('offers a short tail with head counts, not the whole history', async () => {
    fetchPastEvents.mockResolvedValue({
      events: [
        event({
          id: 'last-friday',
          title: 'Friday Fellowship',
          startAt: at(24, 19),
          endAt: at(24, 21),
        }),
      ],
      cursor: null,
      hasMore: false,
    });
    fetchAttendanceByEvent.mockResolvedValue(
      new Map([
        ['last-friday', { present: new Set(['a', 'b', 'c', 'd']), checkedOut: new Set() }],
      ]),
    );

    show([]);

    const tail = await screen.findByRole('region', { name: /catch up/i });
    expect(await within(tail).findByText('4')).toBeInTheDocument();
    expect(within(tail).getByText('4 students checked in')).toBeInTheDocument();
    // No paging controls: the full history is the Events tab's job.
    expect(screen.queryByRole('button', { name: /load older/i })).not.toBeInTheDocument();
  });

  it('stays out of the way entirely when there is no history', async () => {
    show([event({ startAt: at(29, 19), endAt: at(29, 21) })]);

    await settle();
    expect(screen.queryByRole('region', { name: /catch up/i })).not.toBeInTheDocument();
  });
});
