/**
 * The events calendar, read from where the leader is standing.
 *
 * The claim is about which band a gathering lands in, and the boundaries are
 * where the bugs are: an event that finished this afternoon is still today's,
 * one that finished yesterday is history, and a retreat four weeks out has to
 * be *somewhere* rather than falling off the end of "next seven days". These
 * assert the bands and their edges; the row and card internals are covered by
 * `ChooseEvent.test.tsx` and the shared `EventHeroCard`.
 *
 * Firestore is mocked at the service boundary. `fetchPastEvents` and
 * `fetchAttendanceByEvent` are the only reads the history band makes; the rest
 * of the screen renders from the `DataContext` these tests supply directly.
 */
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { EventsPage } from '@/features/events/EventsPage';
import { invalidateSnapshotCache } from '@/hooks/useEventSnapshots';
import { makeEvent, makeSettings } from '../../../tests/factories';
import type { EventAccess, TallyEvent, UserProfile } from '@/types';

const fetchPastEvents = vi.fn();
const fetchAttendanceByEvent = vi.fn();
const setEventStatus = vi.fn();

vi.mock('@/services/events', () => ({
  PAST_EVENTS_PAGE_SIZE: 12,
  fetchPastEvents: (...args: unknown[]) => fetchPastEvents(...args),
  setEventStatus: (...args: unknown[]) => setEventStatus(...args),
}));

vi.mock('@/services/attendance', () => ({
  fetchAttendanceByEvent: (...args: unknown[]) => fetchAttendanceByEvent(...args),
}));

// The editor is a modal full of date pickers and its own Firestore writes.
// This screen's job is to open it; what it does then is its own test.
vi.mock('@/features/events/EventEditorModal', () => ({
  EventEditorModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Event editor" /> : null,
}));

// Same reasoning: the Check-Ins import modal calls Cloud Functions through the
// Firebase SDK, which cannot even be imported without a config. Its behaviour
// is covered by ImportCheckInsModal.test.tsx.
vi.mock('@/features/events/ImportCheckInsModal', () => ({
  ImportCheckInsModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Import from Planning Center" /> : null,
}));

// The not-yours notice names who can let you in, which is the only thing on this
// screen that needs the team directory. The access tests below supply their own
// members through `useTeam`'s subscription.
const teamMembers = vi.fn(() => [] as UserProfile[]);
vi.mock('@/services/users', () => ({
  subscribeUsers: (next: (value: UserProfile[]) => void) => {
    next(teamMembers());
    return () => {};
  },
}));

/** Wednesday 29 July 2026, quarter past four in the afternoon. */
const NOW = new Date(2026, 6, 29, 16, 15);

function at(day: number, hour: number, minutes = 0): Date {
  return new Date(2026, 6, day, hour, minutes);
}

function event(overrides: Partial<TallyEvent> & { startAt: Date; endAt: Date }): TallyEvent {
  return makeEvent({
    checkInOpensAt: new Date(overrides.startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(overrides.endAt.getTime() + 3_600_000),
    ...overrides,
  });
}

interface ShowOptions {
  series?: DataContextValue['series'];
  access?: DataContextValue['access'];
  /** Which gatherings are this reader's. Everything, unless a test says otherwise. */
  canWork?: DataContextValue['canWork'];
  /** `can('admin')`, which passes the access gate unconditionally. */
  admin?: boolean;
}

function show(events: readonly TallyEvent[], options: ShowOptions = {}) {
  const data: DataContextValue = {
    students: [],
    events: [...events],
    // No series by default: the quick-add card is a separate concern and an
    // empty list keeps these assertions about the bands.
    series: options.series ?? [],
    settings: makeSettings(),
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: null,
    rosterBackends: [],
    // Nothing restricted, which is the state every screen has to keep working in.
    access: options.access ?? new Map(),
    canWork: options.canWork ?? (() => true),
    refreshRoster: async () => {},
    applyRosterPerson: () => {},
  };

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
    can: (role: string) => (role === 'admin' ? options.admin === true : true),
  } as AuthContextValue;

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

/** The `<section>` a heading names, so assertions can be scoped to one band. */
function band(name: RegExp) {
  return screen.getByRole('region', { name });
}

/** Let the first page of history land. See the note in `ChooseEvent.test.tsx`. */
async function settle() {
  await act(async () => {});
}

/** A chain closed to everybody but `members`, as `subscribeEventAccess` hydrates it. */
function restricted(chainKey: string, members: string[] = []): EventAccess {
  return {
    id: chainKey,
    chainKey,
    restricted: true,
    members: new Set(members),
    updatedAt: null,
    updatedBy: '',
  };
}

function profile(id: string, displayName: string, role: UserProfile['role']): UserProfile {
  return {
    id,
    email: `${id}@example.org`,
    displayName,
    role,
    active: true,
  } as UserProfile;
}

beforeEach(() => {
  teamMembers.mockReturnValue([]);
  invalidateSnapshotCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  fetchPastEvents.mockResolvedValue({ events: [], cursor: null, hasMore: false });
  fetchAttendanceByEvent.mockResolvedValue({ byEvent: new Map(), denied: new Set() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('the bands', () => {
  it('leads with today, as a card rather than a row', async () => {
    show([
      event({
        id: 'tonight',
        title: 'Friday Fellowship',
        description: 'Games, a talk and pizza.',
        startAt: at(29, 19),
        endAt: at(29, 21),
      }),
    ]);

    const today = band(/^today$/i);
    expect(within(today).getByText('Friday Fellowship')).toBeInTheDocument();
    // The description only appears on the hero. That is what makes it a hero.
    expect(within(today).getByText('Games, a talk and pizza.')).toBeInTheDocument();
    expect(within(today).getByRole('link', { name: /friday fellowship/i })).toHaveAttribute(
      'href',
      '/events/tonight',
    );

    await settle();
  });

  it('keeps a gathering that finished this afternoon in today', async () => {
    show([event({ title: 'Morning class', startAt: at(29, 9), endAt: at(29, 11) })]);

    expect(within(band(/^today$/i)).getByText('Morning class')).toBeInTheDocument();
    await settle();
  });

  it('puts the coming week in the middle band', async () => {
    show([event({ title: 'Sunday School', startAt: at(31, 9, 30), endAt: at(31, 10, 45) })]);

    expect(within(band(/next seven days/i)).getByText('Sunday School')).toBeInTheDocument();
    await settle();
  });

  it('does not drop a retreat that falls past the week', async () => {
    // The band the redesign did not ask for, and the reason it exists: without
    // it, everything beyond seven days would simply be missing from the events
    // screen.
    show([event({ title: 'Winter Retreat', startAt: at(31 + 21, 17), endAt: at(31 + 23, 15) })]);

    expect(within(band(/^later$/i)).getByText('Winter Retreat')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /next seven days/i })).not.toBeInTheDocument();
    await settle();
  });

  it('claims no band it has nothing to put in', async () => {
    show([event({ startAt: at(29, 19), endAt: at(29, 21) })]);

    expect(screen.queryByRole('region', { name: /next seven days/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^later$/i })).not.toBeInTheDocument();
    await settle();
  });

  it('says so when the calendar ahead is empty', async () => {
    show([]);

    expect(screen.getByText('Nothing scheduled yet')).toBeInTheDocument();
    await settle();
  });
});

/* -------------------------------------------------------------------------- */

describe('the history', () => {
  it('reads back from midnight this morning, so today is never in it twice', async () => {
    show([event({ startAt: at(29, 9), endAt: at(29, 11) })]);

    await settle();
    expect(fetchPastEvents).toHaveBeenCalledWith(new Date(2026, 6, 29), null, 12);
  });

  it('carries a head count per gathering, which is what makes one recognisable', async () => {
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
    fetchAttendanceByEvent.mockResolvedValue({
      byEvent: new Map([
        ['last-friday', { present: new Set(['a', 'b', 'c', 'd']), checkedOut: new Set() }],
      ]),
      denied: new Set(),
    });

    show([]);

    const past = await screen.findByRole('region', { name: /past gatherings/i });
    expect(await within(past).findByText('4')).toBeInTheDocument();
    expect(within(past).getByText('4 students checked in')).toBeInTheDocument();
    expect(within(past).getByRole('heading', { name: /july 2026/i })).toBeInTheDocument();
  });

  it('will not print a bold nought for a gathering that never happened', async () => {
    // Tally reads a finished event with no attendance as one that did not run.
    fetchPastEvents.mockResolvedValue({
      events: [event({ id: 'snowed-off', startAt: at(24, 19), endAt: at(24, 21) })],
      cursor: null,
      hasMore: false,
    });
    fetchAttendanceByEvent.mockResolvedValue({
      byEvent: new Map([['snowed-off', { present: new Set(), checkedOut: new Set() }]]),
      denied: new Set(),
    });

    show([]);

    const past = await screen.findByRole('region', { name: /past gatherings/i });
    expect(await within(past).findByText('Nobody')).toBeInTheDocument();
    expect(within(past).queryByText('0')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The calendar as a core member who has been added to almost nothing sees it.
 *
 * These are the claims the refinement loop in `uxr/rounds/ev-r0*` settled, and
 * every one of them was a defect on the shipping screen: the state was stated
 * once per row instead of once per chain, it named nobody, and the page went on
 * offering writes the rules refuse.
 */
describe('a gathering somebody else owns', () => {
  const FRIDAY = 'friday-fellowship';

  /** Ben is on nothing; Miriam and Dana are on Friday. */
  function locked() {
    teamMembers.mockReturnValue([
      profile('miriam', 'Miriam Achebe', 'admin'),
      profile('dana', 'Dana Whitfield', 'core'),
    ]);
    return {
      access: new Map([[FRIDAY, restricted(FRIDAY, ['miriam', 'dana'])]]),
      canWork: (candidate: { seriesId: string | null }) => candidate.seriesId !== FRIDAY,
    };
  }

  function friday(day: number, id = `friday-${day}`): TallyEvent {
    return event({
      id,
      title: 'Friday Fellowship',
      seriesId: FRIDAY,
      startAt: at(day, 19),
      endAt: at(day, 21),
    });
  }

  it('says once, at the top, what the rows used to say each', async () => {
    show([friday(31), friday(31 + 7, 'friday-next')], locked());

    const notice = screen.getByRole('region', { name: /you are not on/i });
    expect(within(notice).getByText(/you are not on friday fellowship/i)).toBeInTheDocument();
    // The move the reader actually has. `approvers()` ranks admins first.
    expect(within(notice).getByText('Miriam or Dana can add you')).toBeInTheDocument();

    await settle();
  });

  it('names people per chain, because the answer differs per chain', async () => {
    teamMembers.mockReturnValue([
      profile('miriam', 'Miriam Achebe', 'admin'),
      profile('sam', 'Sam Okonjo', 'core'),
    ]);

    show(
      [
        friday(31),
        event({
          id: 'sunday',
          title: 'Sunday School',
          seriesId: 'sunday-school',
          startAt: at(31 + 2, 9),
          endAt: at(31 + 2, 11),
        }),
      ],
      {
        access: new Map([
          [FRIDAY, restricted(FRIDAY, ['miriam'])],
          ['sunday-school', restricted('sunday-school', ['sam'])],
        ]),
        canWork: () => false,
      },
    );

    const notice = screen.getByRole('region', { name: /you are not on/i });
    expect(within(notice).getByText('Miriam can add you')).toBeInTheDocument();
    expect(within(notice).getByText('Sam can add you')).toBeInTheDocument();

    await settle();
  });

  it('keeps every gathering on the screen — demotion, not disappearance', async () => {
    show([friday(31 + 7, 'friday-a'), friday(31 + 14, 'friday-b'), friday(31 + 21, 'friday-c')],
      locked());

    // All three are past the week, so they collapse into one group under Later.
    // The group states the chain once; the nights themselves are still here, one
    // disclosure away, and each is still its own link.
    const later = band(/^later$/i);
    // One head for the chain, naming it once and counting its nights…
    expect(later.querySelectorAll('summary')).toHaveLength(1);
    expect(within(later).getAllByText(/3 gatherings/).length).toBeGreaterThan(0);
    // …and all three nights still reachable underneath it.
    for (const id of ['friday-a', 'friday-b', 'friday-c']) {
      expect(later.querySelector(`a[href="/events/${id}"]`)).not.toBeNull();
    }

    await settle();
  });

  it('does not draw a hero card for a gathering it cannot open', async () => {
    show([friday(29)], locked());

    const today = band(/^today$/i);
    // The row is there; the full-width call to action that led to a wall is not.
    expect(within(today).getByText(/Friday Fellowship/)).toBeInTheDocument();
    expect(within(today).queryByText('Open this gathering')).not.toBeInTheDocument();

    await settle();
  });

  it('will not offer to schedule a series the rules would refuse', async () => {
    // The quick action opens a pre-filled editor and the write is refused at
    // save, which costs a form. The calendar still lists every Friday.
    show([], {
      ...locked(),
      series: [
        {
          id: FRIDAY,
          title: 'Friday Fellowship',
          active: true,
          dayOfWeek: 5,
          startTime: '19:00',
          endTime: '21:00',
        } as never,
      ],
    });

    expect(screen.queryByRole('region', { name: /next in each series/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/schedule next friday fellowship/i)).not.toBeInTheDocument();

    await settle();
  });

  it('says nothing at all when nothing is restricted', async () => {
    show([friday(31)]);

    expect(screen.queryByRole('region', { name: /you are not on/i })).not.toBeInTheDocument();

    await settle();
  });

  it('says nothing to an admin, who passes the gate unconditionally', async () => {
    show([friday(31)], { ...locked(), canWork: () => true, admin: true });

    expect(screen.queryByRole('region', { name: /you are not on/i })).not.toBeInTheDocument();

    await settle();
  });

  it('sends a locked past night to the calendar’s wall, not the check-in screen', async () => {
    fetchPastEvents.mockResolvedValue({
      events: [friday(24, 'last-friday'), friday(17, 'friday-before')],
      cursor: null,
      hasMore: false,
    });

    show([], locked());

    const past = await screen.findByRole('region', { name: /past gatherings/i });
    const links = within(past)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    // `/event/` is the check-in route, whose refusal page offers a way back to
    // the counselor screen. Nobody reading the calendar came from there.
    expect(links.every((href) => href?.startsWith('/events/'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('the week boundary', () => {
  it('counts the seventh day as part of the next seven', async () => {
    // Today is Wednesday 29 July. Wednesday 5 August is seven days out, and a
    // band called "next seven days" that excluded it left a leader reading a
    // complete-looking week with their own gathering missing from it.
    show([event({ title: 'Day seven', startAt: at(29 + 7, 19), endAt: at(29 + 7, 21) })]);

    expect(within(band(/next seven days/i)).getByText('Day seven')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^later$/i })).not.toBeInTheDocument();

    await settle();
  });
});
