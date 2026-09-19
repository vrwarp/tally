/**
 * What a keystroke and a tap are allowed to cost on the check-in screen.
 *
 * Everything else about this page is covered by the tests of the pieces it is
 * made of — `RosterList`, `StudentRow`, `ChooseEvent`, `EventHeader`,
 * `QuickAddVisitorModal`. What none of them can see is the page's own
 * arithmetic: which callbacks it hands down, how often it rebuilds the roster,
 * and what it mounts while nobody has asked for it. Those are the three things
 * that decide whether a counselor with five hundred students on the roster
 * gets a list that filters as they type or one that stutters, and every one of
 * them is invisible in the rendered output. So they are measured here instead.
 *
 * `RosterList` is replaced by a recorder rather than rendered. What the rows
 * do with what they are given is `StudentRow.test.tsx`'s subject — including
 * what its `memo` compares — and what this file needs to know is only what the
 * page *handed* down, so a real list of rows would be five hundred components
 * of noise between the assertion and the thing asserted. `EventHeader` is
 * stubbed for the same reason, and because its own memo is pinned next door.
 *
 * The attendance stream and the chosen gathering are channels rather than
 * fixtures, because both of the things being measured are about *change*: a
 * record landing from the other counselor's phone, and the page being pointed
 * at a different night while the old night's records are still in hand.
 */
import { act, render, screen } from '@/test/rtl';
import { CheckInPage } from '@/features/checkin/CheckInPage';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PredictiveRoster from '@/features/roster/predictiveRoster';
import type { BuildRosterInput } from '@/features/roster/predictiveRoster';
import type { AuthContextValue } from '@/context/authContext';
import type { DataContextValue } from '@/context/dataContext';
import type { ToastContextValue } from '@/context/toastContext';
import type { RosterListProps } from '@/features/checkin/RosterList';
import type { AttendanceRecord, TallyEvent } from '@/types';
import { makeAttendance, makeEvent, makeSettings, makeStudent, NOW } from '../../../tests/factories';

/**
 * The two live things, plus the two ledgers the assertions read.
 *
 * A channel is the shape `useAttendance` really has — a listener that hands
 * down a new array when Firestore says something — and publishing to one is
 * the only honest way to ask "what does the page do when a record lands?".
 * Everything else the mocked hooks return is a module constant, because a
 * fresh `[]` or `{}` per render would rebuild the roster on its own and drown
 * the very counts these tests are taking.
 */
const live = vi.hoisted(() => {
  function channel<T>(initial: T) {
    let held = initial;
    const listeners = new Set<() => void>();
    return {
      read: () => held,
      publish(next: T) {
        held = next;
        for (const listener of listeners) listener();
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }

  return {
    attendance: channel<AttendanceRecord[]>([]),
    event: channel<TallyEvent | null>(null),
    /** Every `buildRoster` call, in order. Its length is the rebuild count. */
    builds: [] as BuildRosterInput[],
    /** Every props object `RosterList` has been handed, in order. */
    handed: [] as RosterListProps[],
    /** Shared empties, so nothing below allocates one per render. */
    nothing: [] as never[],
    noNotes: new Map<string, string>(),
  };
});

const services = vi.hoisted(() => ({
  checkIn: vi.fn(async () => {}),
  ensureMaterialized: vi.fn(async () => {}),
}));

vi.mock('@/hooks/useAttendance', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAttendance: () => ({
      attendance: useSyncExternalStore(live.attendance.subscribe, live.attendance.read),
      loading: false,
      error: null,
    }),
    useRsvps: () => ({ rsvps: live.nothing, loading: false, error: null }),
  };
});

vi.mock('@/hooks/useActiveEvent', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useActiveEvent: () => ({
      event: useSyncExternalStore(live.event.subscribe, live.event.read),
      eventLoading: false,
      fromArchive: false,
      now: NOW,
      selectableEvents: live.nothing,
    }),
    useSeriesHistoryEvents: () => live.nothing,
  };
});

vi.mock('@/hooks/useEventSnapshots', () => ({
  useEventSnapshots: () => ({ snapshots: live.nothing, denied: new Set(), loading: false, error: null }),
  invalidateSnapshotCache: () => {},
}));

vi.mock('@/hooks/useAllergyNotes', () => ({ useAllergyNotes: () => live.noNotes }));

vi.mock('@/context/dataContext', () => ({
  useData: () => data,
}));
vi.mock('@/context/authContext', () => ({ useAuth: () => auth }));
vi.mock('@/context/toastContext', () => ({ useToast: () => toast }));

vi.mock('@/features/checkin/EventHeader', () => ({ EventHeader: () => null }));

/**
 * The list, as a recorder.
 *
 * It renders nothing and keeps every props object it is given, which is what
 * lets a test compare the callbacks of one render against the next — the
 * question `memo` asks of this component on the real page, asked here directly.
 */
vi.mock('@/features/checkin/RosterList', () => ({
  RosterList: (props: RosterListProps) => {
    live.handed.push(props);
    return null;
  },
}));

vi.mock('@/features/roster/predictiveRoster', async (importOriginal) => {
  const actual = await importOriginal<typeof PredictiveRoster>();
  return {
    ...actual,
    buildRoster: (input: BuildRosterInput) => {
      live.builds.push(input);
      return actual.buildRoster(input);
    },
  };
});

vi.mock('@/services/attendance', () => ({
  checkIn: services.checkIn,
  checkOut: vi.fn(async () => {}),
  swapCheckIn: vi.fn(async () => {}),
  undoCheckIn: vi.fn(async () => {}),
  undoCheckOut: vi.fn(async () => {}),
  quickAddAndCheckIn: vi.fn(async () => 'student-new'),
}));
vi.mock('@/services/events', () => ({ ensureMaterialized: services.ensureMaterialized }));
vi.mock('@/services/skippedNights', () => ({ clearSkippedNight: vi.fn(async () => {}) }));
vi.mock('@/services/functions', () => ({ recordVisitorParent: vi.fn(async () => ({ data: null })) }));

/*
 * Reached through `LockedGathering`, which this page imports for a branch none
 * of these tests take. Mocked rather than rendered: an unmocked import loads
 * Firebase and throws on the config, which is how every other component test
 * in this directory handles the same modules.
 */
vi.mock('@/services/users', () => ({
  subscribeUsers: (onChange: (members: never[]) => void) => {
    onChange(live.nothing);
    return () => {};
  },
}));
vi.mock('@/services/accessRequests', () => ({
  subscribeChainRequests: () => () => {},
  askToBeAdded: vi.fn(async () => {}),
  clearAccessRequest: vi.fn(async () => {}),
  isOutstanding: () => true,
  ACCESS_REQUEST_LIFE_MS: 7 * 86_400_000,
}));

const FRIDAY = makeEvent({ id: 'friday-2026-02-13', seriesId: 'friday-fellowship' });
/** A different night, for the one render that holds the new id and the old records. */
const SATURDAY = makeEvent({
  id: 'saturday-2026-02-14',
  title: 'Saturday Serve',
  seriesId: 'saturday-serve',
  startAt: new Date('2026-02-14T09:00:00'),
  endAt: new Date('2026-02-14T12:00:00'),
});

const ADA = makeStudent({ id: 'ada', firstName: 'Ada', lastName: 'Byron' });
const GRACE = makeStudent({ id: 'grace', firstName: 'Grace', lastName: 'Hopper' });
const STUDENTS = [ADA, GRACE];
const SETTINGS = makeSettings();

const data = {
  students: STUDENTS,
  settings: SETTINGS,
  loading: false,
  rosterError: null,
  rosterBackends: live.nothing,
  rosterLoading: false,
  refreshRoster: () => {},
  canWork: () => true,
} as unknown as DataContextValue;

const auth = { user: { uid: 'counselor-1' }, can: () => true } as unknown as AuthContextValue;

const toast = {
  toasts: live.nothing,
  show: () => {},
  dismiss: () => {},
} as unknown as ToastContextValue;

/** The props `RosterList` was handed most recently. */
function handed(): RosterListProps {
  const last = live.handed.at(-1);
  if (!last) throw new Error('the roster never rendered');
  return last;
}

function open(event: TallyEvent = FRIDAY, attendance: AttendanceRecord[] = []) {
  live.event.publish(event);
  live.attendance.publish(attendance);
  live.handed.length = 0;
  live.builds.length = 0;
  render(
    <MemoryRouter>
      <CheckInPage />
    </MemoryRouter>,
  );
}

/** The search field, which is the whole of the keystroke path on this page. */
const searchBox = () => screen.getByLabelText('Search students by name');

beforeEach(() => {
  live.event.publish(null);
  live.attendance.publish([]);
  live.handed.length = 0;
  live.builds.length = 0;
  services.checkIn.mockImplementation(async () => {});
  services.ensureMaterialized.mockImplementation(async () => {});
});

/**
 * Both rows and list are wrapped in `memo`, and `memo` compares callback
 * identity before it compares anything else — so a handler rebuilt for a
 * reason that has nothing to do with a row repaints every row on the screen.
 * Five hundred of them, to turn one green, or to narrow a list by one letter.
 */
describe('the callbacks the roster is handed', () => {
  it('survive a keystroke', async () => {
    const user = userEvent.setup();
    open();
    const before = handed();

    await user.type(searchBox(), 'a');

    const after = handed();
    // The page really did work: a new render, and a roster narrowed to the
    // query. Without this the identity assertions below would be vacuous.
    expect(after).not.toBe(before);
    expect(after.entries).not.toBe(before.entries);

    expect(after.onPress).toBe(before.onPress);
    expect(after.onUndo).toBe(before.onUndo);
    expect(after.onCheckOut).toBe(before.onCheckOut);
    expect(after.onUndoCheckOut).toBe(before.onUndoCheckOut);
    // All six, not only the four a tap goes through. `onSwap` is forwarded to
    // every row, so a future edit that made it depend on the query — "only
    // offer Wrong person when the list is not filtered" is the plausible one —
    // would reinstate exactly the repaint these tests exist to prevent.
    expect(after.onSwap).toBe(before.onSwap);
    expect(after.onLeave).toBe(before.onLeave);
  });

  it('survive a record landing on the attendance stream', () => {
    open();
    const before = handed();

    // The other counselor's phone, or the echo of this one's own tap: either
    // way the register grows underneath a screen that must not rebuild its
    // handlers for it.
    act(() => {
      live.attendance.publish([makeAttendance({ studentId: 'ada', eventId: FRIDAY.id })]);
    });

    const after = handed();
    expect(after.entries).not.toBe(before.entries);

    expect(after.onPress).toBe(before.onPress);
    expect(after.onUndo).toBe(before.onUndo);
    expect(after.onCheckOut).toBe(before.onCheckOut);
    expect(after.onUndoCheckOut).toBe(before.onUndoCheckOut);
    expect(after.onSwap).toBe(before.onSwap);
    expect(after.onLeave).toBe(before.onLeave);
  });
});

describe('the roster', () => {
  it('is rebuilt once for a check-in, not twice', async () => {
    open();
    const entry = handed().entries.find((row) => row.student.id === 'ada');
    expect(entry).toBeDefined();

    // The write echoes back through the listener, which is what a real tap
    // looks like from this page's side of Firestore.
    services.checkIn.mockImplementation(async () => {
      live.attendance.publish([makeAttendance({ studentId: 'ada', eventId: FRIDAY.id })]);
    });

    const built = live.builds.length;
    await act(async () => {
      handed().onPress(entry!);
    });

    /*
     * One. The pinned ids are derived during the render the record arrives in,
     * so the tap costs a single pass over the roster. Held in state behind an
     * effect they cost two — the stream lands and the list is built, then the
     * effect sets the pinned set and the whole thing is built again — which on
     * five hundred students is the difference between a row turning green and
     * a screen that hitches.
     */
    expect(live.builds.length).toBe(built + 1);
  });

  it('does not carry one night\'s pinned students onto the next', () => {
    open(FRIDAY, [makeAttendance({ studentId: 'ada', eventId: FRIDAY.id })]);
    expect(live.builds.at(-1)?.pinned).toContain('ada');

    /*
     * The one render this is about. `event` and `attendance` do not change in
     * the same commit — the new night is in hand a beat before its listener
     * has said anything — so for exactly one pass the page holds Saturday and
     * Friday's records. The first roster of the new night must not be built
     * with the last night's pinned set.
     */
    const beforeTheSwitch = live.builds.length;
    act(() => {
      live.event.publish(SATURDAY);
    });

    /*
     * Every pass, not merely the last one. Cleared in an effect instead, the
     * old set survives exactly one render — and that render is the one that
     * builds the new night's first roster, which is the one a counselor sees.
     */
    const afterTheSwitch = live.builds.slice(beforeTheSwitch);
    expect(afterTheSwitch.length).toBeGreaterThan(0);
    for (const build of afterTheSwitch) {
      expect([...build.pinned!]).toEqual([]);
    }
  });
});

describe('quick add', () => {
  it('is not in the document until somebody asks for it', async () => {
    const user = userEvent.setup();
    open();

    // Mounted shut, this dialog was a reconciliation of the whole visitor form
    // on every keystroke — it and the search box share a parent.
    expect(document.querySelector('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Quick add a visitor' }));

    expect(document.querySelector('dialog')).not.toBeNull();
    expect(screen.getByLabelText(/^first name/i)).toBeInTheDocument();
  });
});
