/**
 * What a single check-in is allowed to do to the other four hundred and ninety
 * nine rows.
 *
 * Tapping a name writes that student's document. Firestore then echoes the
 * whole students collection back, in new objects, and `mergeRoster` spreads
 * `{ ...target, ... }` over every row that has a document of its own — which,
 * in a ministry that has been running Tally for a year, is very nearly the
 * whole roster. So the check-in list was handed five hundred brand new
 * `Student` objects, `StudentRow`'s `sameEntry` guard failed its first and
 * cheapest clause (`a.student === b.student`) on every one of them, and one tap
 * re-rendered the list. Measured over five hundred rows: 8.69 ms when the
 * student objects came back identical, 82.76 ms when they did not.
 *
 * These mount the provider over the *real* merge rather than a stub of it,
 * because the thing being asserted is an interaction between the merge and the
 * pass that follows it, and a merge that preserved identity by accident would
 * make every one of these pass for the wrong reason.
 */
import { act, render, waitFor } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '@/context/DataProvider';
import { useData, type DataContextValue } from '@/context/dataContext';
import { makeStudent } from '../../tests/factories';
import type { Student } from '@/types';

const fetchRoster = vi.hoisted(() => vi.fn());

/** The students listener's own handler, held so a snapshot can be delivered. */
const documents = vi.hoisted(() => ({ deliver: (() => {}) as (value: Student[]) => void }));

const quiet = vi.hoisted(() => (next: (value: never[]) => void) => {
  next([]);
  return () => {};
});

vi.mock('@/services/students', () => ({
  subscribeStudents: (next: (value: Student[]) => void) => {
    documents.deliver = next;
    next([]);
    return () => {};
  },
}));
vi.mock('@/services/upstreamEdits', () => ({ subscribeUpstreamEdits: quiet }));
vi.mock('@/services/eventAccess', () => ({
  subscribeEventAccess: (next: (value: Map<string, never>) => void) => {
    next(new Map<string, never>());
    return () => {};
  },
}));
vi.mock('@/services/events', async () => {
  const { DEFAULT_SETTINGS } = await import('@/types');
  return {
    subscribeEvents: (next: (value: never[]) => void) => {
      next([]);
      return () => {};
    },
    subscribeEventSeries: quiet,
    subscribeSettings: (next: (value: unknown) => void) => {
      next(DEFAULT_SETTINGS);
      return () => {};
    },
  };
});

/*
 * The real merge, reached without `@/services/roster` — which these cannot
 * import, because it pulls in `@/lib/firebase` and that throws at import time
 * on a machine with no project configured. The fetching half is stubbed; the
 * joining half is the half under test.
 */
vi.mock('@/services/roster', async () => {
  const { mergeRoster } = await import('@/features/roster/mergeRoster');
  return { fetchRoster, rememberRosterPerson: vi.fn(), cachedRoster: () => null, mergeRoster };
});

vi.mock('@/context/authContext', () => ({
  useAuth: () => ({ profile: { id: 'uid-core' }, can: () => false }),
}));

/** Three people from the backend, in new objects on every read, as a real one. */
function people(): Student[] {
  return [
    makeStudent({ id: 'pco_1', pcoPersonId: '1', firstName: 'Ana', lastName: 'Diaz' }),
    makeStudent({ id: 'pco_2', pcoPersonId: '2', firstName: 'Jamie', lastName: 'Rivera' }),
    makeStudent({ id: 'pco_3', pcoPersonId: '3', firstName: 'Noor', lastName: 'Khan' }),
  ];
}

/**
 * Tally's own document for each of them.
 *
 * Every student who has ever been checked in has one, which is why the merge's
 * spread is the common case rather than the rare one.
 */
function annotations(overrides: Record<string, Partial<Student>> = {}): Student[] {
  return ['pco_1', 'pco_2', 'pco_3'].map((id) =>
    makeStudent({
      id,
      lastAttendedAt: new Date('2026-02-06T19:00:00.000Z'),
      ...overrides[id],
    }),
  );
}

let latest: DataContextValue | null = null;

function Probe() {
  latest = useData();
  return null;
}

beforeEach(() => {
  latest = null;
  fetchRoster.mockReset();
  fetchRoster.mockImplementation(() =>
    Promise.resolve({ students: people(), fetchedAt: new Date('2026-02-13T19:30:00.000Z'), offline: false }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mounted, read, and with one document per student already delivered. */
async function settled() {
  render(
    <DataProvider>
      <Probe />
    </DataProvider>,
  );
  await waitFor(() => expect(latest?.rosterSettled).toBe(true));
  act(() => documents.deliver(annotations()));
  await waitFor(() => expect(latest?.students).toHaveLength(3));
  return latest?.students ?? [];
}

describe('the roster, when the students collection speaks again', () => {
  it('leaves every row that did not change as the object it already was', async () => {
    const before = await settled();

    // One tap at the door: one document's attendance moved, and Firestore
    // restated the other two in new objects saying the same thing.
    act(() =>
      documents.deliver(
        annotations({ pco_2: { lastAttendedAt: new Date('2026-02-13T19:00:00.000Z') } }),
      ),
    );

    await waitFor(() => expect(latest?.students[1]).not.toBe(before[1]));
    // The two rows nobody touched, which is the 82.76 ms this is about.
    expect(latest?.students[0]).toBe(before[0]);
    expect(latest?.students[2]).toBe(before[2]);
    expect(latest?.students[1]?.lastAttendedAt).toEqual(new Date('2026-02-13T19:00:00.000Z'));
  });

  it('hands back the same list when the snapshot changed nothing at all', async () => {
    // Firestore re-delivers on its own — a metadata change, a write from
    // another device that landed on a row this one already had — and a new
    // array republishes the context to every screen in the app.
    const before = await settled();

    act(() => documents.deliver(annotations()));

    await waitFor(() => expect(latest?.students).toHaveLength(3));
    expect(latest?.students).toBe(before);
  });

  it('still publishes a row a document really changed', async () => {
    /*
     * The other half, and the one that is silent when it breaks: reuse is only
     * safe while every field a row draws is compared. A missed one would leave
     * a counselor's note on the check-in screen showing whatever it said
     * before, with no way to clear it short of a reload.
     */
    const before = await settled();

    act(() => documents.deliver(annotations({ pco_3: { notes: 'goes home with the Diaz family' } })));

    await waitFor(() => expect(latest?.students[2]?.notes).toBe('goes home with the Diaz family'));
    expect(latest?.students).not.toBe(before);
    expect(latest?.students[0]).toBe(before[0]);
    expect(latest?.students[1]).toBe(before[1]);
  });

  it('keeps the rows around somebody a quick-add just put on the list', async () => {
    const before = await settled();

    act(() =>
      documents.deliver([
        ...annotations(),
        makeStudent({ id: 'tally-new', firstName: 'Bea', lastName: 'Okafor', isVisitor: true }),
      ]),
    );

    await waitFor(() => expect(latest?.students).toHaveLength(4));
    // Sorted into the middle of the list rather than appended to it, so the
    // reuse cannot be matching rows up by where they sit — and the three that
    // were already there are still the objects the list is drawing.
    expect(latest?.students.map((student) => student.id)).toEqual([
      'pco_1',
      'tally-new',
      'pco_2',
      'pco_3',
    ]);
    expect(latest?.students[0]).toBe(before[0]);
    expect(latest?.students[2]).toBe(before[1]);
    expect(latest?.students[3]).toBe(before[2]);
  });
});
