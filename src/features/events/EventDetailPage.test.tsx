/**
 * The order the cards answer in.
 *
 * This page used to lead with Attendance whatever the night was, and on an
 * event that has not happened Attendance has nothing to say: the count is zero
 * by definition, the tile says "still ahead", and a line under it said nobody
 * had been checked in — three ways of saying nothing, above the RSVP list,
 * which is the only card on the page with names in it. So the assertions here
 * are about *sequence* and about what the empty Attendance card is allowed to
 * say, not about pixels.
 *
 * Everything below the page is mocked at its own boundary; what this drives is
 * the page's own branching.
 */
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { ToastContext, type ToastContextValue } from '@/context/toastContext';
import { EventDetailPage } from '@/features/events/EventDetailPage';
import type { AttendanceRecord, TallyEvent } from '@/types';
import { makeAttendance, makeEvent, makeStudent } from '../../../tests/factories';

/** Frozen well before and well after the gatherings below. */
const NOW = new Date('2026-02-13T12:00:00');

let event: TallyEvent = makeEvent();
let attendance: AttendanceRecord[] = [];

vi.mock('@/hooks/useEvent', () => ({
  useEvent: () => ({ event, loading: false }),
}));

vi.mock('@/hooks/useAttendance', () => ({
  useAttendance: () => ({ attendance, error: null }),
  useRsvps: () => ({ rsvps: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useNow', () => ({ useNow: () => NOW }));

vi.mock('@/services/events', () => ({
  ensureMaterialized: async () => 'event-1',
  setEventStatus: async () => {},
  deleteEvents: async () => {},
  previewEventDeletion: async () => ({ events: 1, attendance: 0, rsvps: 0 }),
  subscribeEvent: () => () => {},
}));

vi.mock('@/services/rsvps', () => ({
  addRsvps: async () => {},
  removeRsvp: async () => {},
  setRsvpStatus: async () => {},
}));

vi.mock('@/services/users', () => ({ subscribeUsers: () => () => {} }));

vi.mock('@/services/eventAccess', () => ({
  restrictChain: async () => {},
  reopenChain: async () => {},
  addChainMembers: async () => {},
  removeChainMember: async () => {},
  recentRegisterTakers: async () => new Set<string>(),
}));

const ada = makeStudent({ id: 'student-ada', firstName: 'Ada', lastName: 'Lovelace' });

function show(target: TallyEvent, records: AttendanceRecord[] = []) {
  event = target;
  attendance = records;

  const data = {
    events: [target],
    series: [],
    students: [ada],
    loading: false,
    canWork: () => true,
    access: new Map(),
    rosterBackends: [],
  } as unknown as DataContextValue;

  const auth = { user: { uid: 'core-1' }, can: () => true } as unknown as AuthContextValue;
  const toast: ToastContextValue = { toasts: [], show: vi.fn(), dismiss: vi.fn() };

  const tree: ReactNode = (
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={data}>
          <ToastContext.Provider value={toast}>
            <EventDetailPage />
          </ToastContext.Provider>
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  );

  return render(tree);
}

/** The retreat, three weeks out, with the guest list as its roster. */
const retreat = makeEvent({
  id: 'winter-retreat',
  title: 'Winter Retreat',
  mode: 'oneoff',
  seriesId: null,
  requiresRsvp: true,
  startAt: new Date('2026-03-06T17:00:00'),
  endAt: new Date('2026-03-08T15:00:00'),
});

/** The same trip, after it happened, with a register behind it. */
const finished = makeEvent({
  id: 'autumn-retreat',
  title: 'Autumn Retreat',
  mode: 'oneoff',
  seriesId: null,
  requiresRsvp: true,
  startAt: new Date('2026-01-09T17:00:00'),
  endAt: new Date('2026-01-11T15:00:00'),
});

function precedes(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe('a gathering that has not happened yet', () => {
  it('puts the RSVP list above Attendance, which has nothing to report', () => {
    show(retreat);

    const rsvps = screen.getByRole('heading', { name: /RSVPs/ });
    const register = screen.getByRole('heading', { name: /Attendance/ });
    expect(precedes(rsvps, register)).toBe(true);
  });

  it('collapses Attendance to the one sentence that is news', () => {
    show(retreat);

    expect(
      screen.getByText('Nothing recorded yet — this event is still ahead.'),
    ).toBeInTheDocument();
    // The tile and the bare "Nobody has been checked in." were the second and
    // third copies of the same nothing.
    expect(screen.queryByText('Checked in')).not.toBeInTheDocument();
    expect(screen.queryByText('Nobody has been checked in.')).not.toBeInTheDocument();
  });
});

describe('a gathering that has happened', () => {
  it('leads with the register, which is now the thing with names in it', () => {
    show(finished, [makeAttendance({ studentId: ada.id, eventId: finished.id })]);

    const rsvps = screen.getByRole('heading', { name: /RSVPs/ });
    const register = screen.getByRole('heading', { name: /Attendance/ });
    expect(precedes(register, rsvps)).toBe(true);
    expect(screen.getByText('Checked in')).toBeInTheDocument();
    // Scoped to the register: the same name is also a candidate in the RSVP
    // card's add-students dialog, which is in the DOM whether it is open or not.
    const card = register.closest('section') as HTMLElement;
    expect(within(card).getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('still says why an empty finished gathering reads as cancelled', () => {
    show(finished);

    expect(screen.getByText(/Tally reads this as a cancelled gathering/)).toBeInTheDocument();
    expect(screen.getByText('Counted as a cancelled gathering.')).toBeInTheDocument();
  });
});
