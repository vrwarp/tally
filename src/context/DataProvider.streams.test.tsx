/**
 * The five streams the provider opens at the root, and what a broken one costs.
 *
 * `DataProvider.test.tsx` is about the roster — what coming back to the tab is
 * allowed to cost. This is about everything else it holds: the Firestore
 * listeners, the sentence each one writes when it is refused, the sentence
 * coming down again when a snapshot lands, and the two things that must not
 * wedge behind a failure — `loading`, which every screen waits on, and
 * `canWork`, which decides whether a counselor at a door gets a register.
 *
 * Every listener is mocked at the service boundary and handed back to the test,
 * so a stream can be made to deliver, fail, and deliver again. That is the
 * sequence the whole `streamErrors` design exists for: a banner that outlives
 * its fault teaches people to ignore the next one.
 */
import type { ReactNode } from 'react';
import { act, render, waitFor } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '@/context/DataProvider';
import { useData, type DataContextValue } from '@/context/dataContext';
import { makeEvent, makeSettings, makeStudent } from '../../tests/factories';
import type { AppSettings, EventAccess, EventSeries, Student, TallyEvent } from '@/types';

/** One stream's handlers, held so a test can drive it. */
interface Stream<T> {
  deliver: (value: T) => void;
  fail: (cause: Error) => void;
  /** How many times the provider asked for this listener. */
  opened: number;
  stopped: number;
}

const streams = vi.hoisted(() => ({
  students: { deliver: () => {}, fail: () => {}, opened: 0, stopped: 0 },
  events: { deliver: () => {}, fail: () => {}, opened: 0, stopped: 0 },
  series: { deliver: () => {}, fail: () => {}, opened: 0, stopped: 0 },
  settings: { deliver: () => {}, fail: () => {}, opened: 0, stopped: 0 },
  access: { deliver: () => {}, fail: () => {}, opened: 0, stopped: 0 },
  edits: { deliver: () => {}, fail: () => {}, opened: 0, stopped: 0 },
})) as unknown as {
  students: Stream<Student[]>;
  events: Stream<TallyEvent[]>;
  series: Stream<EventSeries[]>;
  settings: Stream<AppSettings>;
  access: Stream<Map<string, EventAccess>>;
  edits: Stream<never[]>;
};

const eventOptions = vi.hoisted(() => ({ latest: null as unknown }));
const auth = vi.hoisted(
  () =>
    ({
      profile: { id: 'uid-counselor', role: 'counselor' },
      can: (role: string) => role === 'counselor',
    }) as { profile: { id: string } | null; can: (role: string) => boolean },
);

/** Wires one held stream up to whatever the provider passes the service. */
function connect<T>(stream: Stream<T>) {
  return (next: (value: T) => void, onError?: (cause: Error) => void) => {
    stream.opened += 1;
    stream.deliver = next;
    stream.fail = onError ?? (() => {});
    return () => {
      stream.stopped += 1;
    };
  };
}

vi.mock('@/services/students', () => ({ subscribeStudents: connect(streams.students) }));
vi.mock('@/services/eventAccess', () => ({ subscribeEventAccess: connect(streams.access) }));
const pokeUpstreamDrain = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/services/upstreamEdits', () => ({
  subscribeUpstreamEdits: connect(streams.edits),
  pokeUpstreamDrain,
}));
vi.mock('@/services/events', () => ({
  subscribeEvents: (
    next: (value: TallyEvent[]) => void,
    options: unknown,
    onError?: (cause: Error) => void,
  ) => {
    eventOptions.latest = options;
    return connect(streams.events)(next, onError);
  },
  subscribeEventSeries: connect(streams.series),
  subscribeSettings: connect(streams.settings),
}));

vi.mock('@/services/roster', () => ({
  fetchRoster: vi.fn(async () => ({ students: [], fetchedAt: new Date(), offline: false })),
  rememberRosterPerson: vi.fn(),
  cachedRoster: () => null,
  mergeRoster: (roster: Student[], documents: Student[]) => [...roster, ...documents],
}));

vi.mock('@/context/authContext', () => ({ useAuth: () => auth }));

let latest: DataContextValue | null = null;

function Probe() {
  latest = useData();
  return null;
}

function mount(children: ReactNode = <Probe />) {
  return render(<DataProvider>{children}</DataProvider>);
}

/** A restricted gathering's access list, with the bookkeeping filled in. */
function access(overrides: Partial<EventAccess> = {}): EventAccess {
  return {
    id: 'friday-fellowship',
    chainKey: 'friday-fellowship',
    restricted: true,
    members: new Set<string>(),
    updatedAt: null,
    updatedBy: 'uid-miriam',
    ...overrides,
  };
}

beforeEach(() => {
  latest = null;
  eventOptions.latest = null;
  auth.profile = { id: 'uid-counselor' };
  auth.can = (role: string) => role === 'counselor';
  for (const stream of Object.values(streams)) {
    stream.stopped = 0;
    stream.opened = 0;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the loading gate', () => {
  it('holds until every stream has delivered once', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    expect(latest?.loading).toBe(true);

    act(() => streams.students.deliver([]));
    act(() => streams.events.deliver([]));
    act(() => streams.series.deliver([]));
    act(() => streams.settings.deliver(makeSettings()));
    expect(latest?.loading).toBe(true);

    act(() => streams.access.deliver(new Map()));
    expect(latest?.loading).toBe(false);
  });

  it('waits on every one of the five, not on four of them', async () => {
    /*
     * One stream at a time, left out. Every screen under the provider paints a
     * spinner while `loading` is true, so a stream that was never actually
     * waited on is an empty list drawn as data — no roster, no calendar, no
     * settings — in the moment before it lands.
     */
    const deliver = {
      students: () => streams.students.deliver([]),
      events: () => streams.events.deliver([]),
      series: () => streams.series.deliver([]),
      settings: () => streams.settings.deliver(makeSettings()),
      access: () => streams.access.deliver(new Map()),
    };
    const names = Object.keys(deliver) as (keyof typeof deliver)[];

    for (const missing of names) {
      const view = mount();
      await waitFor(() => expect(latest).not.toBeNull());

      act(() => {
        for (const name of names) if (name !== missing) deliver[name]();
      });

      expect(latest?.loading, `still waiting on ${missing}`).toBe(true);
      view.unmount();
    }
  });

  it('lets go for a stream that failed rather than wedging behind it', async () => {
    // A permanently refused listener must not leave the whole app behind a
    // spinner. What that costs is an empty state painted over a hole, which is
    // exactly what `streamErrors` is for.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => {
      streams.students.fail(new Error('refused'));
      streams.events.deliver([]);
      streams.series.deliver([]);
      streams.settings.deliver(makeSettings());
      streams.access.deliver(new Map());
    });

    expect(latest?.loading).toBe(false);
  });

  it('asks the calendar for a year of history', async () => {
    // Less than a year and the loader, rather than the participation rule,
    // becomes the thing deciding who belongs to a fortnightly gathering.
    mount();
    await waitFor(() => expect(eventOptions.latest).toEqual({ sinceDaysAgo: 365 }));
  });

  it('closes every listener when it unmounts', async () => {
    const { unmount } = mount();
    await waitFor(() => expect(latest).not.toBeNull());

    unmount();

    expect(streams.students.stopped).toBe(1);
    expect(streams.events.stopped).toBe(1);
    expect(streams.series.stopped).toBe(1);
    expect(streams.settings.stopped).toBe(1);
    expect(streams.access.stopped).toBe(1);
  });
});

describe('a stream that fails', () => {
  it('names itself and what it said', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.events.fail(new Error('Missing or insufficient permissions.')));

    expect(latest?.streamErrors?.events).toBe(
      'Could not load events: Missing or insufficient permissions.',
    );
    expect(latest?.error).toBe('Could not load events: Missing or insufficient permissions.');
  });

  it('joins several failures rather than letting the newest replace the rest', async () => {
    // A rules change that shuts a role out shuts it out of three collections at
    // once, and the other two failures were being thrown away.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => {
      streams.settings.fail(new Error('no'));
      streams.students.fail(new Error('nope'));
    });

    // In the fixed order the streams are declared in, not the order the
    // network happened to answer in.
    expect(latest?.error).toBe('Could not load students: nope · Could not load settings: no');
  });

  it('comes down again when a snapshot lands', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.series.fail(new Error('gone')));
    expect(latest?.streamErrors?.series).toBeDefined();

    act(() => streams.series.deliver([]));

    expect(latest?.streamErrors?.series).toBeUndefined();
    expect(latest?.error).toBeNull();
  });

  it('leaves the other streams alone when one recovers', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => {
      streams.series.fail(new Error('gone'));
      streams.students.fail(new Error('still gone'));
    });
    act(() => streams.series.deliver([]));

    expect(latest?.streamErrors).toEqual({ students: 'Could not load students: still gone' });
  });

  it('does not republish for the same sentence twice', async () => {
    let renders = 0;
    function Counter() {
      latest = useData();
      renders += 1;
      return null;
    }

    mount(<Counter />);
    await waitFor(() => expect(latest).not.toBeNull());
    act(() => streams.access.fail(new Error('same')));
    const after = renders;

    act(() => streams.access.fail(new Error('same')));

    expect(renders).toBe(after);
  });

  it('names the access stream when that is the one refused', async () => {
    // Every label is written out by hand at its own call site, so each one is
    // its own chance to name the wrong collection in a banner.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.access.fail(new Error('Missing or insufficient permissions.')));

    expect(latest?.streamErrors?.access).toBe(
      'Could not load access: Missing or insufficient permissions.',
    );
  });

  it('names each of the other three when they are the one refused', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => {
      streams.students.fail(new Error('refused'));
      streams.series.fail(new Error('refused'));
      streams.settings.fail(new Error('refused'));
    });

    expect(latest?.streamErrors?.students).toBe('Could not load students: refused');
    expect(latest?.streamErrors?.series).toBe('Could not load series: refused');
    expect(latest?.streamErrors?.settings).toBe('Could not load settings: refused');
  });

  it('holds the same errors object when a quiet stream delivers again', async () => {
    // `streamErrors` is in the context value, so rebuilding it for a snapshot
    // that cleared nothing re-renders every screen reading `useData`.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    act(() => streams.events.deliver([]));
    const first = latest?.streamErrors;

    act(() => streams.events.deliver([makeEvent({ id: 'friday' })]));

    expect(latest?.streamErrors).toBe(first);
  });

  it('says nothing at all while every stream is quiet', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    expect(latest?.error).toBeNull();
    expect(latest?.streamErrors).toEqual({});
  });
});

describe('what the streams put in the context', () => {
  it('publishes the settings the stream delivered', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.settings.deliver(makeSettings({ predictiveOfLastN: 9 })));

    expect(latest?.settings.predictiveOfLastN).toBe(9);
  });

  it('publishes the series the stream delivered', async () => {
    const friday = { id: 'friday-fellowship', title: 'Friday' } as EventSeries;
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.series.deliver([friday]));

    expect(latest?.series).toEqual([friday]);
  });

  it('merges the student documents into the roster', async () => {
    const document = makeStudent({ id: 'tally_1', firstName: 'Visitor' });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.students.deliver([document]));

    expect(latest?.students.map((student) => student.id)).toContain('tally_1');
  });

  it('publishes the calendar the events stream delivered', async () => {
    const night = makeEvent({ id: 'friday', mode: 'oneoff', seriesId: null, recurrence: null });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.events.deliver([night]));

    expect(latest?.events.map((event) => event.id)).toEqual(['friday']);
  });

  it('hands back the very same calendar when nothing about it moved', async () => {
    // The projection is recomputed on every tick of a minute clock, and a new
    // array for the same gatherings re-renders every screen in the app.
    const night = makeEvent({ id: 'friday', mode: 'oneoff', seriesId: null, recurrence: null });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.events.deliver([night]));
    const first = latest?.events;

    // The same night in a new array, exactly as a re-delivered snapshot would.
    act(() => streams.events.deliver([{ ...night }]));

    expect(latest?.events).toBe(first);
  });

  it('publishes a new calendar when a gathering actually changes', async () => {
    const night = makeEvent({ id: 'friday', mode: 'oneoff', seriesId: null, recurrence: null });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    act(() => streams.events.deliver([night]));
    const first = latest?.events;

    act(() => streams.events.deliver([{ ...night, status: 'cancelled' }]));

    expect(latest?.events).not.toBe(first);
    expect(latest?.events[0]?.status).toBe('cancelled');
  });
});

describe('canWork', () => {
  const night = makeEvent({ id: 'friday-2026-02-13', seriesId: 'friday-fellowship' });

  it('admits everybody to a gathering nobody has restricted', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    act(() => streams.access.deliver(new Map()));

    expect(latest?.canWork(night)).toBe(true);
  });

  it('refuses somebody who is not on a restricted gathering', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    act(() =>
      streams.access.deliver(
        new Map([
          ['friday-fellowship', access({ members: new Set(['uid-other']) })],
        ]),
      ),
    );

    expect(latest?.canWork(night)).toBe(false);
  });

  it('keys the answer on the chain, not on the night', async () => {
    // Most nights on the calendar are projected and have no document of their
    // own, so the access document can only ever be keyed by chain.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    act(() =>
      streams.access.deliver(
        new Map([
          ['friday-fellowship', access({ members: new Set(['uid-counselor']) })],
        ]),
      ),
    );

    const anotherNight = makeEvent({ id: 'friday-2026-02-20', seriesId: 'friday-fellowship' });
    expect(latest?.canWork(anotherNight)).toBe(true);
  });

  it('lets an admin through a gathering they are not on', async () => {
    // An admin and nothing else: `can` is asked about one role here, and a
    // stub that says yes to every question cannot tell which one was asked.
    auth.can = (role: string) => role === 'admin';
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    act(() =>
      streams.access.deliver(
        new Map([
          ['friday-fellowship', access({ members: new Set(['uid-other']) })],
        ]),
      ),
    );

    expect(latest?.canWork(night)).toBe(true);
  });

  it('fails open when the access stream is broken', async () => {
    // Hiding every gathering gives a counselor at a door an empty screen, which
    // is the failure this whole feature is shaped to avoid. The rules refuse
    // the writes either way.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    act(() => streams.access.fail(new Error('refused')));

    expect(latest?.canWork(night)).toBe(true);
  });

  it('refuses a restricted gathering when nobody is signed in', async () => {
    auth.profile = null;
    auth.can = () => false;
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    act(() =>
      streams.access.deliver(
        new Map([
          ['friday-fellowship', access({ members: new Set(['uid-other']) })],
        ]),
      ),
    );

    expect(latest?.canWork(night)).toBe(false);
  });
});

describe('the upstream edit queue', () => {
  it('is never opened for a counselor', async () => {
    // The rules refuse it, and a listener that is never opened is the
    // difference between a screen that does not ask and one that is refused.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    expect(streams.edits.opened).toBe(0);
    expect(latest?.upstreamEdits).toEqual([]);
  });

  it('is opened for the core team, and what it says gets through', async () => {
    auth.can = (role: string) => role === 'core';
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    expect(streams.edits.opened).toBe(1);

    const queued = [{ id: 'edit-1', studentId: 'pco_1', state: 'queued' }];
    act(() => streams.edits.deliver(queued as never));

    // A job queued on a phone in a corridor lands from a server, and the
    // laptop watching the same student has to stop saying "sending".
    expect(latest?.upstreamEdits).toBe(queued);
  });

  it('empties the queue when the person watching stops being core team', async () => {
    auth.can = (role: string) => role === 'core';
    const view = mount();
    await waitFor(() => expect(latest).not.toBeNull());
    act(() => streams.edits.deliver([{ id: 'edit-1' }] as never));
    expect(latest?.upstreamEdits).toHaveLength(1);

    // An admin demoting somebody mid-event: the listener closes and what it
    // had already said goes with it.
    auth.can = (role: string) => role === 'counselor';
    view.rerender(
      <DataProvider>
        <Probe />
      </DataProvider>,
    );

    await waitFor(() => expect(latest?.upstreamEdits).toEqual([]));
    expect(streams.edits.stopped).toBe(1);
  });

  it('owns the retry of a job it is watching, rather than leaving it to the sweep', async () => {
    /*
     * The queue's sweep runs every five minutes, which is a fair answer for a
     * job nobody is watching and a poor one for a job somebody is: a rate limit
     * answered with "come back in fifteen seconds" would leave a leader reading
     * "Waiting on Planning Center" for five minutes, on a screen that promises
     * it resumes on its own. The provider is where the open tab and the queue
     * meet, so it is where that wiring has to hold.
     */
    vi.useFakeTimers();
    try {
      auth.can = (role: string) => role === 'core';
      pokeUpstreamDrain.mockClear();
      mount();
      await vi.waitFor(() => expect(latest).not.toBeNull());

      act(() =>
        streams.edits.deliver([
          {
            id: 'edit-1',
            studentId: 'pco_101',
            state: 'waiting',
            nextAttemptAt: new Date(Date.now() + 15_000),
          },
        ] as never),
      );

      expect(pokeUpstreamDrain).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(16_000));
      expect(pokeUpstreamDrain).toHaveBeenCalledWith('pco_101');
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes quiet rather than banner-ing when its listener is refused', async () => {
    // The queue is an aid to somebody already editing; a refused listener must
    // not put an error in front of a leader who was doing something else.
    auth.can = (role: string) => role === 'core';
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    // Something arrived before the listener was refused — a first page, then a
    // rule change — and it has to go with it: a queue nobody is watching any
    // more goes on saying "sending" beside a student whose edit landed.
    act(() => streams.edits.deliver([{ id: 'edit-1' }] as never));
    expect(latest?.upstreamEdits).toHaveLength(1);

    act(() => streams.edits.fail(new Error('refused')));

    expect(latest?.upstreamEdits).toEqual([]);
    expect(latest?.error).toBeNull();
  });
});
