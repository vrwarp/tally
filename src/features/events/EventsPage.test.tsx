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
import type { TallyEvent } from '@/types';

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

function show(events: readonly TallyEvent[]) {
  const data: DataContextValue = {
    students: [],
    events: [...events],
    // No series: the quick-add card is a separate concern and an empty list
    // keeps these assertions about the bands.
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
    // Nothing restricted, which is the state every screen has to keep working in.
    access: new Map(),
    canWork: () => true,
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
    can: () => true,
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

beforeEach(() => {
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
