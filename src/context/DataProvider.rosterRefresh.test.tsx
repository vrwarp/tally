/**
 * The roster read, and the machinery around it that nothing was watching.
 *
 * `refreshRoster` is called from four places that know nothing about each
 * other — the mount, a ten-minute timer, coming back to the tab, and a write
 * that could not correct a row in place — so the interesting part is not the
 * read but the queue in front of it. Two reads at once against a paged
 * Planning Center sweep is the thing it exists to prevent, and `force` being
 * sticky is what stops a deliberate refresh being downgraded by an incidental
 * one that happened to arrive alongside it.
 *
 * None of that had a test. The whole in-flight branch was never executed.
 */
import { act, render, waitFor } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '@/context/DataProvider';
import { useData, type DataContextValue } from '@/context/dataContext';
import type { PcoRosterPerson, Student } from '@/types';
import { makeStudent } from '../../tests/factories';
import { ROSTER_DEADLINES_MS, ROSTER_RETRY_GAPS_MS } from '@/lib/rosterLadder';

const fetchRoster = vi.hoisted(() => vi.fn());
const rememberRosterPerson = vi.hoisted(() => vi.fn());
/** What `cachedRoster()` answers, so a test can start the provider warm. */
const cache = vi.hoisted(() => ({ value: null as { students: Student[] } | null }));
const auth = vi.hoisted(() => ({
  profile: { id: 'uid-core' } as { id: string } | null,
  asked: [] as string[],
  can: (role: string) => {
    auth.asked.push(role);
    return role === 'core';
  },
}));

vi.mock('@/services/roster', () => ({
  fetchRoster,
  rememberRosterPerson,
  cachedRoster: () => cache.value,
  mergeRoster: (roster: unknown) => roster,
  fromRosterPerson: (person: PcoRosterPerson) => ({ ...person, fromRoster: true }),
}));

vi.mock('@/services/upstreamEdits', () => ({
  subscribeUpstreamEdits: (next: (value: never[]) => void) => {
    next([]);
    return () => {};
  },
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
    subscribeEvents: (next: (value: never[]) => void) => {
      next([]);
      return () => {};
    },
    subscribeEventSeries: empty,
    subscribeSettings: (next: (value: unknown) => void) => {
      next(DEFAULT_SETTINGS);
      return () => {};
    },
  };
});
vi.mock('@/context/authContext', () => ({ useAuth: () => auth }));
vi.mock('@/services/eventAccess', () => ({
  subscribeEventAccess: (next: (value: Map<string, unknown>) => void) => {
    next(new Map());
    return () => {};
  },
}));

const FETCHED_AT = new Date('2026-02-13T19:30:00.000Z');

function reply(students: Student[] = []) {
  return { students, fetchedAt: FETCHED_AT, offline: false };
}

/** A read the test lands by hand, so a second one can arrive while it is out. */
function held() {
  let land: (value: unknown) => void = () => {};
  const promise = new Promise((resolve) => {
    land = resolve;
  });
  return { promise, land: (value: unknown = reply()) => land(value) };
}

let latest: DataContextValue | null = null;
/** Every value the context has held, so a first render can be inspected. */
let seen: DataContextValue[] = [];

function Probe() {
  latest = useData();
  seen.push(latest);
  return null;
}

function mount() {
  return render(
    <DataProvider>
      <Probe />
    </DataProvider>,
  );
}

const realNow = Date.now.bind(Date);
/*
 * Frozen at the start of each test and moved only by `offset`.
 *
 * Not `realNow() + offset`: the guard these exercise is `< 60_000`, and a few
 * real milliseconds elapsing between the mount and the assertion put the clock
 * a hair past the boundary — so the one comparison the test exists to pin was
 * never actually made at the boundary.
 */
let base = 0;
let offset = 0;

function comeBackToTheTab() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function visibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  offset = 0;
  latest = null;
  seen = [];
  cache.value = null;
  auth.profile = { id: 'uid-core' };
  auth.asked = [];
  visibility('visible');
  fetchRoster.mockReset();
  fetchRoster.mockImplementation(() => Promise.resolve(reply()));
  rememberRosterPerson.mockClear();
  base = realNow();
  vi.spyOn(Date, 'now').mockImplementation(() => base + offset);
});

afterEach(() => {
  vi.restoreAllMocks();
  visibility('visible');
});

describe('what the provider holds before anything has answered', () => {
  it('opens empty, loading, and with nothing pretending to be data', () => {
    const outstanding = held();
    fetchRoster.mockImplementationOnce(() => outstanding.promise);

    mount();

    // Every one of these is read by a screen on its first paint. A non-empty
    // initial value is a roster row, a gathering or a series drawn out of
    // nothing, and it would be gone again a frame later.
    const first = seen[0]!;
    expect(first.students).toEqual([]);
    expect(first.events).toEqual([]);
    expect(first.series).toEqual([]);
    expect(first.rosterBackends).toEqual([]);
    expect(first.rosterLoading).toBe(true);
    expect(first.loading).toBe(true);
    // The queue of edits on their way upstream is read on the first paint too,
    // and it has not heard from Firestore yet either.
    expect(first.upstreamEdits).toEqual([]);

    act(() => outstanding.land());
  });

  it('is not offline on a device that has cached nothing', () => {
    mount();

    expect(seen[0]!.rosterOffline).toBe(false);
  });

  it('opens on the cached roster, and says where it came from', async () => {
    // The lobby tablet coming up with no signal: the roster it had last night
    // is far better than an empty screen, and `rosterOffline` is what puts the
    // "showing a saved copy" line over it.
    cache.value = { students: [makeStudent({ id: 'pco_1', pcoPersonId: '1' })] };
    const outstanding = held();
    fetchRoster.mockImplementationOnce(() => outstanding.promise);

    mount();

    expect(seen[0]!.rosterOffline).toBe(true);
    expect(seen[0]!.students.map((student) => student.id)).toEqual(['pco_1']);

    await act(async () => outstanding.land());
    // And once a real read lands, it is not a saved copy any more.
    expect(latest?.rosterOffline).toBe(false);
  });

  it('asks whether this person may read the edit queue, by name', () => {
    mount();

    // Core team only at the rules, so a counselor's listener is never opened.
    expect(auth.asked).toContain('core');
  });
});

describe('the read the provider starts itself', () => {
  it('does not force it, so the server may answer out of its own cache', async () => {
    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    // A forced read is a paged, uncached sweep of every child in the church.
    // Doing that on every mount is what the cache in front of it is for.
    expect(fetchRoster.mock.calls[0]?.[1]).toBe(false);
  });

  it('re-reads on its own every ten minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      await vi.waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      });

      expect(fetchRoster).toHaveBeenCalledTimes(2);
      expect(fetchRoster.mock.calls[1]?.[1]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the timer when the provider goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const view = mount();
      await vi.waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      });

      // A provider that is gone still reading Planning Center every ten
      // minutes is a tab nobody is looking at costing somebody their quota.
      expect(fetchRoster).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a second read asked for while one is out', () => {
  it('waits rather than running two sweeps at once', async () => {
    const outstanding = held();
    fetchRoster.mockImplementationOnce(() => outstanding.promise);

    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    await act(async () => {
      void latest?.refreshRoster();
    });
    expect(fetchRoster).toHaveBeenCalledTimes(1);

    await act(async () => {
      outstanding.land();
    });

    // The queued one runs after, exactly once.
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
  });

  it('runs one follow-up however many arrived while it was out', async () => {
    const outstanding = held();
    fetchRoster.mockImplementationOnce(() => outstanding.promise);

    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    await act(async () => {
      void latest?.refreshRoster();
      void latest?.refreshRoster();
      void latest?.refreshRoster();
    });

    await act(async () => {
      outstanding.land();
    });

    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
    // And then it is quiet, rather than three sweeps deep.
    await act(async () => {});
    expect(fetchRoster).toHaveBeenCalledTimes(2);
  });

  it('keeps a deliberate refresh forced, whatever arrived beside it', async () => {
    const outstanding = held();
    fetchRoster.mockImplementationOnce(() => outstanding.promise);

    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    await act(async () => {
      void latest?.refreshRoster(true);
      // The timer, or a tab coming back — neither of which knows somebody just
      // pressed Refresh, and neither of which may downgrade it.
      void latest?.refreshRoster(false);
    });

    await act(async () => {
      outstanding.land();
    });

    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
    expect(fetchRoster.mock.calls[1]?.[1]).toBe(true);
  });

  it('keeps it forced whichever order the two arrived in', async () => {
    const outstanding = held();
    fetchRoster.mockImplementationOnce(() => outstanding.promise);

    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    await act(async () => {
      void latest?.refreshRoster(false);
      void latest?.refreshRoster(true);
    });

    await act(async () => {
      outstanding.land();
    });

    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
    expect(fetchRoster.mock.calls[1]?.[1]).toBe(true);
  });

  it('does not force a follow-up nobody asked to be forced', async () => {
    const outstanding = held();
    fetchRoster.mockImplementationOnce(() => outstanding.promise);

    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    await act(async () => {
      void latest?.refreshRoster();
    });
    await act(async () => {
      outstanding.land();
    });

    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
    expect(fetchRoster.mock.calls[1]?.[1]).toBe(false);
  });

  it('is quiet again once the queue has drained', async () => {
    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    await act(async () => {
      await latest?.refreshRoster(true);
    });

    // Nothing was queued behind it, so nothing follows it.
    expect(fetchRoster).toHaveBeenCalledTimes(2);
  });
});

describe('coming back to the tab', () => {
  it('does not read for a tab that came back hidden', async () => {
    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    visibility('hidden');
    offset += 61_000;
    comeBackToTheTab();

    // `visibilitychange` fires on the way out as well as on the way back, and
    // a phone going into a pocket is not a reason to read four hundred people.
    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });

  it('re-reads once the last attempt is a minute old', async () => {
    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    offset += 59_000;
    comeBackToTheTab();
    expect(fetchRoster).toHaveBeenCalledTimes(1);

    // On the minute, not after it: the guard is `< ROSTER_RESYNC_AFTER_MS`.
    offset += 1_000;
    comeBackToTheTab();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
  });

  it('stops listening when the provider goes away', async () => {
    const view = mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    view.unmount();
    offset += 61_000;
    comeBackToTheTab();

    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });
});

describe('a read that answered oddly', () => {
  it('takes a reply with no instant on it', async () => {
    fetchRoster.mockImplementationOnce(async () => ({
      students: [],
      fetchedAt: null,
      offline: false,
    }));

    mount();

    await waitFor(() => expect(latest?.rosterSettled).toBe(true));
    expect(latest?.rosterFetchedAt).toBeNull();
    expect(latest?.rosterError).toBeNull();
  });

  it('has a sentence for something thrown that has no properties at all', async () => {
    // `throw null` and `throw undefined` are both legal, and a details panel
    // that throws while describing a failure is the worst place to throw.
    for (const thrown of [null, undefined]) {
      fetchRoster.mockReset();
      fetchRoster.mockRejectedValueOnce(thrown);
      fetchRoster.mockImplementation(() => Promise.resolve(reply()));

      const view = mount();
      await waitFor(() => expect(latest?.rosterError).toBeTruthy());
      expect(latest?.rosterError?.message).toBe(
        'Could not reach your church directory to load the roster. Check the wifi, then try again.',
      );
      view.unmount();
    }
  });
});

describe('correcting one row from a write', () => {
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
      ...overrides,
    } as PcoRosterPerson;
  }

  it('reads again when the roster on this device is empty', async () => {
    mount();
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(1));

    act(() => latest?.applyRosterPerson(row()));

    // Nobody here answers to them — an empty roster answers to nobody — so
    // there is nothing to correct in place and a read is the only answer.
    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
    expect(fetchRoster.mock.calls[1]?.[1]).toBe(true);
    expect(rememberRosterPerson).not.toHaveBeenCalled();
  });

  it('leaves every other row exactly as it was', async () => {
    fetchRoster.mockImplementation(async () =>
      reply([
        makeStudent({ id: 'pco_1', pcoPersonId: '1' }),
        makeStudent({ id: 'pco_2', pcoPersonId: '2', firstName: 'Noah' }),
      ]),
    );

    mount();
    await waitFor(() => expect(latest?.students).toHaveLength(2));
    const others = latest!.students[1];

    act(() => latest?.applyRosterPerson(row({ firstName: 'Jaime' })));

    await waitFor(() => expect(latest?.students[0]?.firstName).toBe('Jaime'));
    expect(latest?.students[1]).toBe(others);
    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });

  it('reads again when handed nobody at all', async () => {
    fetchRoster.mockImplementation(async () =>
      reply([makeStudent({ id: 'pco_1', pcoPersonId: '1' })]),
    );

    mount();
    await waitFor(() => expect(latest?.students).toHaveLength(1));

    act(() => latest?.applyRosterPerson(null));

    await waitFor(() => expect(fetchRoster).toHaveBeenCalledTimes(2));
  });
});

/**
 * The ladder: what happens after a roster read fails.
 *
 * Before this existed, the answer was "nothing, for up to ten minutes" — the
 * failure set the banner and the next automatic attempt was whenever the
 * ten-minute interval next came round. A check-in desk on the first production
 * Sunday spent that ten minutes looking at a red banner over an empty roster
 * because of a blip that was over in seconds.
 *
 * Fake timers rather than the file's `offset` clock: these tests are about
 * `setTimeout`, and the gaps between rungs are the thing being asserted.
 */
describe('after a read fails', () => {
  beforeEach(() => {
    // Replaces the `Date.now` spy installed above, which is what we want —
    // advancing the fake clock must move both the timers and the clock the
    // visibility floor reads.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lets the ladder run its course, gaps and all. */
  async function runLadder() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROSTER_RETRY_GAPS_MS[0] + ROSTER_RETRY_GAPS_MS[1] + 10);
    });
  }

  function deadlinesAsked() {
    return fetchRoster.mock.calls.map((call: unknown[]) => call[2]);
  }

  function forcesAsked() {
    return fetchRoster.mock.calls.map((call: unknown[]) => call[1]);
  }

  it('tries again twice, on a longer deadline each time', async () => {
    fetchRoster.mockRejectedValue(new Error('nope'));

    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The first attempt has failed and the banner is already up: the ladder
    // runs underneath it rather than delaying it.
    expect(fetchRoster).toHaveBeenCalledTimes(1);
    expect(latest?.rosterError).not.toBeNull();

    await runLadder();

    expect(fetchRoster).toHaveBeenCalledTimes(3);
    expect(deadlinesAsked()).toEqual([...ROSTER_DEADLINES_MS]);
  });

  it('stops at the end of the ladder rather than hammering', async () => {
    fetchRoster.mockRejectedValue(new Error('nope'));

    mount();
    await runLadder();
    expect(fetchRoster).toHaveBeenCalledTimes(3);

    // A full minute past the last rung, and nothing further: the ten-minute
    // interval owns what happens next.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchRoster).toHaveBeenCalledTimes(3);
  });

  it('takes the banner down by itself when a rung lands', async () => {
    fetchRoster.mockRejectedValueOnce(new Error('nope')).mockResolvedValue(reply());

    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(latest?.rosterError).not.toBeNull();

    await runLadder();

    // Two attempts, not three: the ladder ended when it succeeded.
    expect(fetchRoster).toHaveBeenCalledTimes(2);
    expect(latest?.rosterError).toBeNull();
    expect(latest?.rosterOffline).toBe(false);
  });

  /*
   * The one that must not regress silently. `force` skips the server's held
   * answer *and* refuses to join a read already in flight, which is right for
   * somebody pressing Try again and ruinous for a ladder: the attempt this one
   * follows very likely left a read running server-side, and joining it is why
   * the next rung is nearly free. A forcing ladder would start three fresh full
   * reads against a backend already having a bad minute.
   */
  it('never forces a retry, even when the attempt that failed was forced', async () => {
    fetchRoster.mockRejectedValue(new Error('nope'));

    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fetchRoster.mockClear();

    // A leader presses Try again, and it fails too.
    await act(async () => {
      await latest?.refreshRoster(true);
    });
    await runLadder();

    expect(forcesAsked()).toEqual([true, false, false]);
  });

  it('starts a fresh ladder when the network comes back', async () => {
    fetchRoster.mockRejectedValue(new Error('nope'));

    mount();
    await runLadder();
    expect(fetchRoster).toHaveBeenCalledTimes(3);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Immediately, and from the top of the ladder — no floor, because `online`
    // fires on a transition rather than on a glance.
    expect(fetchRoster).toHaveBeenCalledTimes(4);
    expect(deadlinesAsked()[3]).toBe(ROSTER_DEADLINES_MS[0]);
  });

  /*
   * `lastAttemptAt` is stamped once per ladder rather than once per attempt. A
   * ladder is most of a minute long, so per-attempt stamping would put the
   * sixty-second visibility floor in front of somebody who picked their phone
   * up *because* the roster looked wrong.
   */
  it('lets somebody coming back to the tab mid-ladder trigger a read', async () => {
    fetchRoster.mockRejectedValue(new Error('nope'));

    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROSTER_RETRY_GAPS_MS[0] + 10);
    });
    const midLadder = fetchRoster.mock.calls.length;

    comeBackToTheTab();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchRoster.mock.calls.length).toBeGreaterThan(midLadder);
  });

  it('does not leave a rung running after the provider is gone', async () => {
    fetchRoster.mockRejectedValue(new Error('nope'));

    const view = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchRoster).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });
});
