/**
 * What coming back to the tab is allowed to cost.
 *
 * The insights screen waits on the roster, so anything that makes a read look
 * like it is starting takes that screen away and hands it back — which is what
 * a counselor glancing at their texts and returning actually saw: every tile a
 * dash, every list gone, for the length of a Planning Center round-trip nobody
 * had asked for.
 *
 * Three things stop it, and they are all here: not re-reading a roster that was
 * read moments ago, not announcing an unchanged one as new, and not un-settling
 * a screen that has already landed.
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider, EVENT_WINDOW_DAYS } from '@/context/DataProvider';
import { useData, type DataContextValue } from '@/context/dataContext';
import { PARTICIPATION_MAX_AGE_DAYS } from '@/features/roster/predictiveRoster';
import type { PcoRosterPerson } from '@/types';
import { makeStudent } from '../../tests/factories';

const fetchRoster = vi.hoisted(() => vi.fn());

const rememberRosterPerson = vi.hoisted(() => vi.fn());

vi.mock('@/services/roster', () => ({
  fetchRoster,
  rememberRosterPerson,
  cachedRoster: () => null,
  // The merge has its own tests; here it only has to preserve identity, so that
  // what these assert about `roster` is what a screen would see in `students`.
  mergeRoster: (roster: unknown) => roster,
}));

vi.mock('@/services/students', () => ({
  subscribeStudents: (next: (value: never[]) => void) => {
    next([]);
    return () => {};
  },
}));

vi.mock('@/services/events', async () => {
  const { DEFAULT_SETTINGS } = await import('@/types');
  const empty = (next: (value: never[]) => void) => {
    next([]);
    return () => {};
  };
  return {
    subscribeEvents: empty,
    subscribeEventSeries: empty,
    subscribeSettings: (next: (value: unknown) => void) => {
      next(DEFAULT_SETTINGS);
      return () => {};
    },
  };
});

/** The instant Planning Center reports, deliberately the same for every read. */
const FETCHED_AT = '2026-02-13T19:30:00.000Z';

/**
 * A reply built fresh per call, exactly as `fetchRoster` builds one: the same
 * people at the same instant, in new objects every time. Sharing one between
 * reads would let the identity assertions below pass for the wrong reason.
 */
function reply() {
  return {
    students: [makeStudent({ id: 'pco_1', pcoPersonId: '1', birthday: null })],
    fetchedAt: new Date(FETCHED_AT),
    offline: false,
  };
}

let latest: DataContextValue | null = null;

function Probe() {
  latest = useData();
  return null;
}

function mount() {
  return render(
    <DataProvider>
      <Probe />
    </DataProvider>,
  );
}

/** Whatever the browser does on the way back, the app hears this. */
function comeBackToTheTab() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const realNow = Date.now.bind(Date);
/** Travel, without stopping the clock the test framework is also reading. */
let offset = 0;

beforeEach(() => {
  offset = 0;
  latest = null;
  fetchRoster.mockReset();
  fetchRoster.mockImplementation(() => Promise.resolve(reply()));
  rememberRosterPerson.mockClear();
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DataProvider, on the first read', () => {
  it('is unsettled until one lands, so a screen can still hold its skeleton', async () => {
    let land: (value: unknown) => void = () => {};
    fetchRoster.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );

    mount();

    await waitFor(() => expect(latest?.rosterLoading).toBe(true));
    // The half of the original guard that must survive: nothing has come back
    // from Planning Center, so there is no roster worth publishing numbers from.
    expect(latest?.rosterSettled).toBe(false);

    await act(async () => {
      land(reply());
    });
    expect(latest?.rosterSettled).toBe(true);
  });

  it('settles even when Planning Center refuses, rather than waiting forever', async () => {
    fetchRoster.mockRejectedValueOnce(new Error('Planning Center is having a minute'));

    mount();

    // Otherwise an outage leaves the insights screen behind a skeleton with no
    // way out. The stale roster and the banner over it are the better answer.
    await waitFor(() => expect(latest?.rosterSettled).toBe(true));
    expect(latest?.rosterError).toBeTruthy();
  });
});

/**
 * The other side of dropping an unchanged roster: a changed one has to get
 * through. `birthday` was missing from the comparison, so saving one from the
 * roster badge wrote it upstream, re-read the roster, and then kept the array it
 * already had — the row behind the panel still said "no birthday" until the page
 * was reloaded.
 */
describe('DataProvider, when a read comes back different', () => {
  const readAgainWith = async (students: unknown[]) => {
    fetchRoster.mockImplementationOnce(() =>
      Promise.resolve({ students, fetchedAt: new Date(FETCHED_AT), offline: false }),
    );
    offset += 61_000;
    comeBackToTheTab();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
  };

  it('publishes a roster whose only change is a birthday', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterLoading).toBe(false));
    const before = latest?.students;

    await readAgainWith([makeStudent({ id: 'pco_1', birthday: '12-14' })]);

    await waitFor(() => expect(latest?.students).not.toBe(before));
    expect(latest?.students[0]?.birthday).toBe('12-14');
  });

  it('publishes a roster whose only change is whether the grade is real', async () => {
    // The same trap as the birthday, one field along. `grade` alone cannot see
    // this: somebody whose grade upstream is filled in *as* the number the
    // clamp had already parked them on changes only the flag — and the row
    // would go on saying "No grade" over a grade the church office just typed.
    mount();
    await waitFor(() => expect(latest?.rosterLoading).toBe(false));
    const before = latest?.students;

    await readAgainWith([makeStudent({ id: 'pco_1', grade: 8, gradeOnFile: false })]);

    await waitFor(() => expect(latest?.students).not.toBe(before));
    expect(latest?.students[0]?.gradeOnFile).toBe(false);
  });

  it('still drops one that changed nothing at all', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterLoading).toBe(false));
    const before = latest?.students;

    await readAgainWith(reply().students);

    // Same people, new objects: replacing the array here re-sorts the list under
    // a thumb already moving toward a row.
    expect(latest?.students).toBe(before);
  });
});

describe('DataProvider, on coming back to the tab', () => {
  it('leaves a roster read moments ago alone', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterLoading).toBe(false));
    expect(fetchRoster).toHaveBeenCalledTimes(1);

    comeBackToTheTab();

    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });

  it('re-reads one that has had time to go stale', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterLoading).toBe(false));

    offset += 61_000;
    comeBackToTheTab();

    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
  });

  it('does not republish a timestamp the read did not move', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterLoading).toBe(false));
    const first = latest?.rosterFetchedAt;
    expect(first).toBeInstanceOf(Date);

    offset += 61_000;
    comeBackToTheTab();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));

    // The same instant, so it must be the same object: a new one publishes a new
    // context value and re-renders every screen reading `useData`, for a roster
    // nobody changed.
    expect(latest?.rosterFetchedAt).toBe(first);
  });

  it('keeps the roster settled while a re-read is in flight', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterLoading).toBe(false));

    let land: (value: unknown) => void = () => {};
    fetchRoster.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );

    offset += 61_000;
    comeBackToTheTab();
    await waitFor(() => expect(latest?.rosterLoading).toBe(true));

    // The whole point. A read being in flight is true of the first one and of
    // this one; only the first means there is nothing worth showing yet.
    expect(latest?.rosterSettled).toBe(true);

    await act(async () => {
      land(reply());
    });
  });
});

/**
 * Correcting one row from a write's own answer, rather than re-reading four
 * hundred to find out what one of them now says.
 *
 * This is the whole reason saving a birthday stopped taking as long as it did:
 * `refreshRoster(true)` is a forced, uncached, paged sweep of every child in
 * the church, and a leader stood in front of a spinner through it to see the
 * date they had just typed appear.
 */
describe('applying one row a write handed back', () => {
  /** The shape `getRoster` returns, and the shape a write now returns too. */
  function row(overrides: Partial<PcoRosterPerson> = {}): PcoRosterPerson {
    return {
      id: 'pco_1',
      pcoPersonId: '1',
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: 8,
      status: 'active',
      searchName: 'jamie rivera',
      profileComplete: null,
      hasAllergies: false,
      birthday: '03-16',
      gradeOnFile: true,
      ...overrides,
    };
  }

  it('puts it into the roster without asking Planning Center again', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterSettled).toBe(true));
    expect(latest?.students[0]?.birthday).toBeNull();
    const reads = fetchRoster.mock.calls.length;

    act(() => latest?.applyRosterPerson(row()));

    await waitFor(() => expect(latest?.students[0]?.birthday).toBe('03-16'));
    expect(fetchRoster.mock.calls.length).toBe(reads);
    // And on this device, or a reload would paint the row as it was.
    expect(rememberRosterPerson).toHaveBeenCalledWith(row());
  });

  /**
   * A write that answered without a row — an older server — or one about
   * somebody this roster does not hold, which is what a person merged upstream
   * mid-edit looks like: the row comes back under the surviving id and there is
   * nothing here to match it to. Correctness falls back to a read; the point is
   * only that the caller does not wait on it.
   */
  it('falls back to a read when there is nobody here to correct', async () => {
    mount();
    await waitFor(() => expect(latest?.rosterSettled).toBe(true));
    const reads = fetchRoster.mock.calls.length;

    act(() => latest?.applyRosterPerson(undefined));
    await waitFor(() => expect(fetchRoster.mock.calls.length).toBe(reads + 1));
    expect(fetchRoster).toHaveBeenLastCalledWith(expect.any(Date), true);

    act(() => latest?.applyRosterPerson(row({ pcoPersonId: '99' })));
    await waitFor(() => expect(fetchRoster.mock.calls.length).toBe(reads + 2));
    expect(rememberRosterPerson).not.toHaveBeenCalled();
  });
});

/**
 * The loader must not be tighter than the rule it feeds.
 *
 * `PARTICIPATION_MAX_AGE_DAYS` decides how far back attendance counts as
 * belonging to a gathering, but it can only ever see the events the provider
 * holds. When the window was four months the rule was quietly truncated to four
 * months as well — and worse for anything not meeting weekly, because "has been
 * here before" reads a fixed *number* of past instances out of this list, so a
 * fortnightly chain lost half of its twelve and a monthly one lost most of them.
 *
 * Nothing about that failure is visible: the roster just returns fewer names,
 * confidently. This pins the ordering so a future trim of the window has to be a
 * decision about the rule too.
 */
describe('the calendar window', () => {
  it('reaches at least as far back as participation counts', () => {
    expect(EVENT_WINDOW_DAYS).toBeGreaterThanOrEqual(PARTICIPATION_MAX_AGE_DAYS);
  });
});
