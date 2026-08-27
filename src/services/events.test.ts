/**
 * What a gathering is written as, and what the editor is not allowed to leave
 * behind when somebody changes their mind.
 *
 * `buildEventPayload` is the whole reason this file is long. It is not a
 * spread of the form's state: the mode decides which half of the fields may
 * exist at all, and nulling the other half *here* rather than trusting the
 * caller is what stops a mode switch leaving a weekly rule on a retreat that
 * will never run again, or a borrowed prediction on a gathering that has a
 * history of its own.
 *
 * The two sanitisers are the same argument aimed at the future: the kiosk is
 * the only thing that renders a label template or a theme, it may be running an
 * older deploy than whatever wrote the document, so what lands in Firestore
 * should already be a shape this version agrees is valid.
 *
 * Firestore and the callables are mocked at their boundaries.
 * `firestore-tests` is where the rules these writes satisfy are checked, and
 * the functions package tests what the callables do with them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEvent,
  deleteEvents,
  ensureMaterialized,
  fetchPastEvents,
  previewEventDeletion,
  saveSettings,
  setEventStatus,
  subscribeEvent,
  subscribeEventSeries,
  subscribeEvents,
  subscribeSettings,
  updateEvent,
  type EventDraft,
} from '@/services/events';
import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';
import { makeEvent, makeSettings } from '../../tests/factories';
import type { RecurrenceRule } from '@/types';

const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
const getDocs = vi.hoisted(() => vi.fn());
const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const where = vi.hoisted(() => vi.fn((field: string, op: string, value: unknown) => ({
  where: [field, op, value],
})));
const orderBy = vi.hoisted(() => vi.fn((field: string, direction?: string) => ({
  orderBy: [field, direction],
})));
const limit = vi.hoisted(() => vi.fn((count: number) => ({ limit: count })));
const startAfter = vi.hoisted(() => vi.fn((cursor: unknown) => ({ startAfter: cursor })));
const materializeOccurrence = vi.hoisted(() => vi.fn());
const deleteEventsCallable = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/functions', () => ({
  materializeOccurrence,
  deleteEvents: deleteEventsCallable,
}));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  doc: (_db: unknown, path?: string) =>
    typeof path === 'string' ? { path } : { path: 'events/generated-id', id: 'generated-id' },
  collection: (_db: unknown, path: string) => ({ path }),
  query: (source: { path: string }, ...constraints: unknown[]) => ({
    path: source.path,
    constraints,
  }),
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp: () => 'server-timestamp',
}));

const WEEKLY: RecurrenceRule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [5],
  monthlyMode: 'dayOfMonth',
  until: null,
  count: null,
};

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: '  Friday Fellowship  ',
    mode: 'recurring',
    startAt: new Date(2026, 1, 13, 19, 0),
    endAt: new Date(2026, 1, 13, 21, 0),
    checkInOpensAt: new Date(2026, 1, 13, 18, 0),
    checkInClosesAt: new Date(2026, 1, 13, 21, 30),
    ...overrides,
  };
}

/** A Firestore document snapshot of one gathering, as `toEvent` reads one. */
function eventDoc(id: string) {
  return {
    id,
    exists: () => true,
    data: () => ({ title: id }),
    metadata: { hasPendingWrites: false },
  };
}

/** The payload the last write was handed, whichever call made it. */
function payload(): Record<string, unknown> {
  const fromSet = (setDoc.mock.calls.at(-1) as unknown[] | undefined)?.[1];
  const fromUpdate = (updateDoc.mock.calls.at(-1) as unknown[] | undefined)?.[1];
  return (fromSet ?? fromUpdate) as Record<string, unknown>;
}

beforeEach(() => {
  onSnapshot.mockClear();
  getDocs.mockReset();
  setDoc.mockClear();
  updateDoc.mockClear();
  where.mockClear();
  orderBy.mockClear();
  limit.mockClear();
  startAfter.mockClear();
  materializeOccurrence.mockReset();
  deleteEventsCallable.mockReset();
});

describe('subscribeEvents', () => {
  it('reads a year of calendar by default, newest first', () => {
    // The same window `DataProvider` asks for, so a caller that says nothing
    // gets the calendar every screen is already reading.
    subscribeEvents(() => {});

    const [, , since] = where.mock.calls[0] ?? [];
    const days = Math.round((Date.now() - (since as Date).getTime()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(365);
    expect(days).toBeLessThanOrEqual(366);
    expect(orderBy).toHaveBeenCalledWith('startAt', 'desc');
  });

  it('takes a narrower window from a caller that asks for one', () => {
    subscribeEvents(() => {}, { sinceDaysAgo: 30 });

    const [, , since] = where.mock.calls[0] ?? [];
    const days = Math.round((Date.now() - (since as Date).getTime()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(30);
    expect(days).toBeLessThanOrEqual(31);
  });

  it('starts the window at midnight, so a gathering earlier today is in it', () => {
    subscribeEvents(() => {}, { sinceDaysAgo: 0 });

    const [, , since] = where.mock.calls[0] ?? [];
    expect((since as Date).getHours()).toBe(0);
    expect((since as Date).getMinutes()).toBe(0);
    expect((since as Date).getSeconds()).toBe(0);
    expect((since as Date).getMilliseconds()).toBe(0);
  });

  it('filters on the field the calendar is ordered by', () => {
    // `startAt` and `>=` together are the window. Firestore refuses a range
    // filter on one field with an order on another, so getting either wrong is
    // an empty calendar rather than a wrong one.
    subscribeEvents(() => {});

    const [field, op] = where.mock.calls[0] ?? [];
    expect(field).toBe('startAt');
    expect(op).toBe('>=');
  });

  it('hands the caller what the snapshot held', () => {
    const onChange = vi.fn();
    subscribeEvents(onChange);

    const [, next] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: unknown) => void,
    ];
    next({ docs: [eventDoc('friday'), eventDoc('sunday')] });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]![0] as { id: string }[]).map((event) => event.id)).toEqual([
      'friday',
      'sunday',
    ]);
  });

  it('forwards a refused read to the caller', () => {
    const onError = vi.fn();
    subscribeEvents(() => {}, {}, onError);

    const [, , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];
    const refusal = new Error('refused');
    handler(refusal);

    expect(onError).toHaveBeenCalledWith(refusal);
  });

  it('survives a refused read with nobody listening for it', () => {
    subscribeEvents(() => {});

    const [, , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];
    expect(() => handler(new Error('refused'))).not.toThrow();
  });

  it('survives a refused read on each of the other streams with nobody listening', () => {
    // Every screen that reads one of these passes an `onError`; the printer
    // setup screen and the kiosk pairing screen do not. A stream that assumed
    // one takes the whole screen down when the rules refuse it.
    const streams = [
      () => subscribeEvent('event-1', () => {}),
      () => subscribeEventSeries(() => {}),
      () => subscribeSettings(() => {}),
    ];

    for (const open of streams) {
      open();
      const call = onSnapshot.mock.calls.at(-1) as unknown[];
      const handler = call[2] as (cause: Error) => void;
      expect(() => handler(new Error('refused'))).not.toThrow();
    }
  });
});

describe('the other streams', () => {
  it('watches one gathering by id and reports it gone when it is', () => {
    const seen: (unknown | null)[] = [];
    subscribeEvent('event-1', (event) => seen.push(event));

    const [ref, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      { path: string },
      (snap: unknown) => void,
    ];
    expect(ref.path).toBe('events/event-1');

    onNext({ exists: () => false, id: 'event-1', data: () => undefined, metadata: {} });
    expect(seen[0]).toBeNull();
  });

  it('hands the caller the templates the snapshot held', () => {
    const onChange = vi.fn();
    subscribeEventSeries(onChange);

    const [, next] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: unknown) => void,
    ];
    next({
      docs: [
        { id: 'friday', data: () => ({ name: 'Friday Fellowship', order: 0 }) },
        { id: 'sunday', data: () => ({ name: 'Sunday Nursery', order: 1 }) },
      ],
    });

    expect((onChange.mock.calls[0]![0] as { id: string }[]).map((row) => row.id)).toEqual([
      'friday',
      'sunday',
    ]);
  });

  it('hands the caller the settings the snapshot held', () => {
    const onChange = vi.fn();
    subscribeSettings(onChange);

    const [, next] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: unknown) => void,
    ];
    next({ exists: () => true, data: () => ({ predictiveOfLastN: 7 }) });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]![0] as { predictiveOfLastN: number }).predictiveOfLastN).toBe(7);
  });

  it('reads the recurring templates in the order somebody arranged them', () => {
    subscribeEventSeries(() => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [{ path: string }];
    expect(source.path).toBe('eventSeries');
    expect(orderBy).toHaveBeenCalledWith('order');
  });

  it('watches the one settings document', () => {
    subscribeSettings(() => {});

    const [ref] = onSnapshot.mock.calls.at(-1) as unknown as [{ path: string }];
    expect(ref.path).toBe('config/settings');
  });

  it('forwards a refused read on each of them', () => {
    for (const subscribe of [subscribeEvent, subscribeEventSeries, subscribeSettings]) {
      const onError = vi.fn();
      // `subscribeEvent` takes an id first; the other two do not.
      if (subscribe === subscribeEvent) subscribe('event-1', () => {}, onError);
      else (subscribe as typeof subscribeEventSeries)(() => {}, onError);

      const handler = (onSnapshot.mock.calls.at(-1) as unknown[] | undefined)?.at(-1) as (
        cause: Error,
      ) => void;
      handler(new Error('refused'));
      expect(onError).toHaveBeenCalled();
    }
  });
});

describe('fetchPastEvents', () => {
  function page(count: number) {
    getDocs.mockResolvedValueOnce({
      docs: Array.from({ length: count }, (_, index) => ({
        id: `night-${index}`,
        exists: () => true,
        data: () => ({ title: `night-${index}` }),
        metadata: { hasPendingWrites: false },
      })),
    });
  }

  it('reads strictly earlier than the boundary, newest first', async () => {
    page(0);
    const before = new Date(2026, 1, 13, 19, 0);

    await fetchPastEvents(before);

    expect(where).toHaveBeenCalledWith('startAt', '<', before);
    expect(orderBy).toHaveBeenCalledWith('startAt', 'desc');
  });

  it('asks for the default page size when the caller does not say', async () => {
    page(0);
    await fetchPastEvents(new Date());
    expect(limit).toHaveBeenCalledWith(12);
  });

  it('starts from the top when there is no cursor', async () => {
    page(0);
    await fetchPastEvents(new Date());
    expect(startAfter).not.toHaveBeenCalled();
  });

  it('asks with three constraints and no fourth', async () => {
    page(0);
    await fetchPastEvents(new Date());

    // A constraint the query did not mean to carry is a page of the wrong
    // gatherings, and Firestore will happily serve one.
    const [q] = getDocs.mock.calls.at(-1) as unknown as [{ constraints: unknown[] }];
    expect(q.constraints).toHaveLength(3);
  });

  it('carries the cursor as a fourth constraint and no more', async () => {
    page(0);
    await fetchPastEvents(new Date(), { id: 'night-1' } as never);

    const [q] = getDocs.mock.calls.at(-1) as unknown as [{ constraints: unknown[] }];
    expect(q.constraints).toHaveLength(4);
  });

  it('hands back the last of the page as the cursor, not the second', async () => {
    page(3);

    const result = await fetchPastEvents(new Date(), null, 3);

    // The next page starts *after* this one. Any other document means a page
    // that repeats gatherings the list has already drawn.
    expect((result.cursor as unknown as { id: string }).id).toBe('night-2');
  });

  it('continues from a cursor when there is one', async () => {
    page(0);
    const cursor = { id: 'night-1' } as never;

    await fetchPastEvents(new Date(), cursor);

    expect(startAfter).toHaveBeenCalledWith(cursor);
  });

  it('offers another page when this one was full', async () => {
    page(2);
    const result = await fetchPastEvents(new Date(), null, 2);

    expect(result.hasMore).toBe(true);
    expect(result.cursor).not.toBeNull();
    expect(result.events).toHaveLength(2);
  });

  it('drops the cursor with the last short page', async () => {
    // Holding one would invite a request that can only come back empty.
    page(1);
    const result = await fetchPastEvents(new Date(), null, 2);

    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  it('says there is nothing more when the page was empty', async () => {
    page(0);
    const result = await fetchPastEvents(new Date(), null, 2);

    expect(result.events).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });
});

describe('what a gathering is written as', () => {
  it('trims the text a leader typed', async () => {
    await createEvent(
      draft({ description: '  Games and a talk  ', location: '  Hall  ', notes: '  Bring £2  ' }),
      'uid-miriam',
    );

    expect(payload()).toMatchObject({
      title: 'Friday Fellowship',
      description: 'Games and a talk',
      location: 'Hall',
      notes: 'Bring £2',
    });
  });

  it('stores nothing rather than an empty string for the optional text', async () => {
    await createEvent(
      draft({ description: '   ', location: '', notes: undefined }),
      'uid-miriam',
    );

    expect(payload()).toMatchObject({ description: null, location: null, notes: null });
  });

  it('writes only an icon this build can actually draw', async () => {
    // A stale cached bundle must not put an icon on an event that nothing can
    // render.
    await createEvent(draft({ icon: 'not-a-real-icon' }), 'uid-miriam');
    expect(payload().icon).toBeNull();
  });

  it('keeps an icon it recognises', async () => {
    await createEvent(draft({ icon: 'sports_soccer' }), 'uid-miriam');
    expect(payload().icon).toBe('sports_soccer');
  });

  it('normalises the recurrence rule against the start date', async () => {
    await createEvent(
      draft({ recurrence: { ...WEEKLY, interval: 0, weekdays: [5, 5, 9] } }),
      'uid-miriam',
    );

    expect(payload().recurrence).toMatchObject({ interval: 1, weekdays: [5] });
  });

  it('keeps the chain a repeat belongs to', async () => {
    // Nulled for a one-off, and a mode check that stopped distinguishing would
    // detach every recurring gathering from its own series on the next save.
    await createEvent(
      draft({ mode: 'recurring', seriesId: 'friday-fellowship', recurrenceRootId: 'root-1' }),
      'uid-1',
    );

    expect(payload().seriesId).toBe('friday-fellowship');
    expect(payload().recurrenceRootId).toBe('root-1');
  });

  it('drops the repeat when a gathering becomes a one-off', async () => {
    // A retreat happens once, and nulling it here rather than trusting the
    // caller keeps a mode switch from leaving a weekly rule behind.
    await createEvent(
      draft({
        mode: 'oneoff',
        recurrence: WEEKLY,
        seriesId: 'friday-fellowship',
        recurrenceRootId: 'root-1',
      }),
      'uid-miriam',
    );

    expect(payload()).toMatchObject({
      mode: 'oneoff',
      recurrence: null,
      seriesId: null,
      recurrenceRootId: null,
    });
  });

  it('drops a borrowed prediction when a trip becomes a repeat', async () => {
    // The mirror image: a borrowed prediction belongs to a gathering with no
    // history of its own.
    await createEvent(
      draft({ mode: 'recurring', predictFromChain: 'friday-fellowship' }),
      'uid-miriam',
    );

    expect(payload().predictFromChain).toBeNull();
  });

  it('keeps a borrowed prediction on a trip', async () => {
    await createEvent(
      draft({ mode: 'oneoff', predictFromChain: 'friday-fellowship' }),
      'uid-miriam',
    );

    expect(payload().predictFromChain).toBe('friday-fellowship');
  });

  it('expects an RSVP list on a one-off and not on a repeat', async () => {
    await createEvent(draft({ mode: 'oneoff' }), 'uid-miriam');
    expect(payload().requiresRsvp).toBe(true);

    await createEvent(draft({ mode: 'recurring' }), 'uid-miriam');
    expect(payload().requiresRsvp).toBe(false);
  });

  it('lets a leader say otherwise about the RSVP list', async () => {
    await createEvent(draft({ mode: 'oneoff', requiresRsvp: false }), 'uid-miriam');
    expect(payload().requiresRsvp).toBe(false);
  });

  it('never defaults check-out on from the mode', async () => {
    // Recurring and one-off alike, this is on only when somebody said so.
    await createEvent(draft({ mode: 'oneoff' }), 'uid-miriam');
    expect(payload().requiresCheckOut).toBe(false);

    await createEvent(draft({ requiresCheckOut: true }), 'uid-miriam');
    expect(payload().requiresCheckOut).toBe(true);
  });

  it('sanitises the label template on the way out', async () => {
    await createEvent(
      draft({
        labelTemplate: { ...DEFAULT_LABEL_TEMPLATE, stray: 'key' } as never,
      }),
      'uid-miriam',
    );

    expect(payload().labelTemplate).not.toHaveProperty('stray');
  });

  it('stores no template when there is none', async () => {
    await createEvent(draft({ labelTemplate: null }), 'uid-miriam');
    expect(payload().labelTemplate).toBeNull();
  });

  it('sanitises the kiosk theme on the way out', async () => {
    await createEvent(draft({ kioskTheme: { ground: 'nonsense' } as never }), 'uid-miriam');
    expect(payload().kioskTheme).not.toMatchObject({ ground: 'nonsense' });
  });

  it('keeps a well-formed backdrop pointer and drops any other shape', async () => {
    await createEvent(draft({ kioskBackdropId: 'b0123456789abcdef' }), 'uid-miriam');
    expect(payload().kioskBackdropId).toBe('b0123456789abcdef');

    await createEvent(draft({ kioskBackdropId: 'not/an/id' }), 'uid-miriam');
    expect(payload().kioskBackdropId).toBeNull();

    await createEvent(draft(), 'uid-miriam');
    expect(payload().kioskBackdropId).toBeNull();
  });

  it('is scheduled unless somebody says otherwise', async () => {
    await createEvent(draft(), 'uid-miriam');
    expect(payload().status).toBe('scheduled');

    await createEvent(draft({ status: 'cancelled' }), 'uid-miriam');
    expect(payload().status).toBe('cancelled');
  });

  it('stamps who made it and when, on creation only', async () => {
    await createEvent(draft(), 'uid-miriam');

    expect(payload()).toMatchObject({
      createdAt: 'server-timestamp',
      createdBy: 'uid-miriam',
      updatedAt: 'server-timestamp',
    });
    expect(payload()).not.toHaveProperty('updatedBy');
  });

  it('stamps who edited it, and never re-stamps who made it', async () => {
    await updateEvent('event-1', draft(), 'uid-priya');

    expect(payload()).toMatchObject({
      updatedBy: 'uid-priya',
      updatedAt: 'server-timestamp',
    });
    expect(payload()).not.toHaveProperty('createdAt');
    expect(payload()).not.toHaveProperty('createdBy');
  });

  it('hands back the id of the document it created', async () => {
    await expect(createEvent(draft(), 'uid-miriam')).resolves.toBe('generated-id');
  });

  it('edits the gathering the caller named', async () => {
    await updateEvent('event-1', draft(), 'uid-priya');

    expect((updateDoc.mock.calls.at(-1) as unknown[] | undefined)?.[0]).toEqual({
      path: 'events/event-1',
    });
  });
});

describe('ensureMaterialized', () => {
  it('costs nothing at all for a gathering that already has a document', async () => {
    const stored = makeEvent({ id: 'event-1', materialized: true });

    await expect(ensureMaterialized(stored)).resolves.toBe('event-1');
    expect(materializeOccurrence).not.toHaveBeenCalled();
  });

  it('asks the server to write down a projected gathering', async () => {
    // A callable rather than a Firestore write: rules have no loops, so they
    // cannot check that a date is genuinely an occurrence of a rule.
    const projected = makeEvent({
      id: 'friday-fellowship-2026-02-20',
      seriesId: 'friday-fellowship',
      startAt: new Date(2026, 1, 20, 19, 0),
      materialized: false,
    });
    materializeOccurrence.mockResolvedValue({ data: { id: 'friday-fellowship-2026-02-20' } });

    await expect(ensureMaterialized(projected)).resolves.toBe('friday-fellowship-2026-02-20');
    expect(materializeOccurrence).toHaveBeenCalledWith({
      chain: 'friday-fellowship',
      startAt: projected.startAt.getTime(),
    });
  });
});

describe('setEventStatus', () => {
  it('calls a gathering off without touching anything else', async () => {
    await setEventStatus('event-1', 'cancelled', 'uid-miriam');

    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'events/event-1' },
      { status: 'cancelled', updatedAt: 'server-timestamp', updatedBy: 'uid-miriam' },
    );
  });
});

describe('deleting', () => {
  it('previews without removing anything', async () => {
    deleteEventsCallable.mockResolvedValue({ data: { events: 3, attendance: 40 } });

    await expect(previewEventDeletion({ scope: 'chain', chain: 'friday' })).resolves.toEqual({
      events: 3,
      attendance: 40,
    });
    expect(deleteEventsCallable).toHaveBeenCalledWith({
      scope: 'chain',
      chain: 'friday',
      preview: true,
    });
  });

  it('deletes without the preview flag', async () => {
    deleteEventsCallable.mockResolvedValue({ data: { events: 1, attendance: 12 } });

    await deleteEvents({ scope: 'event', eventId: 'event-1' });

    expect(deleteEventsCallable).toHaveBeenCalledWith({ scope: 'event', eventId: 'event-1' });
  });
});

describe('saveSettings', () => {
  it('merges, so the thresholds screen does not blank what it cannot see', async () => {
    const settings = makeSettings({ predictiveOfLastN: 4 });

    await saveSettings(
      {
        predictiveMinAttended: settings.predictiveMinAttended,
        predictiveOfLastN: 4,
        miaConsecutiveMisses: settings.miaConsecutiveMisses,
        newVisitorWindowDays: settings.newVisitorWindowDays,
      },
      'uid-miriam',
    );

    const call = setDoc.mock.calls.at(-1) as unknown[] | undefined;
  const ref = call?.[0];
  const data = call?.[1];
  const options = call?.[2];
    expect(ref).toEqual({ path: 'config/settings' });
    expect(data).toMatchObject({
      predictiveOfLastN: 4,
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
    expect(options).toEqual({ merge: true });
  });
});
