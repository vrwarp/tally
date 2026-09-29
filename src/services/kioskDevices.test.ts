/**
 * What a browser may do to a lobby screen's row, and what it must never do.
 *
 * The row is a custody record: `checkedInBy` on every register that kiosk took
 * is the kiosk's own uid, and this document is the only thing that turns that
 * uid back into a tablet somebody paired in a lobby on a date. So retiring
 * marks two fields and nothing deletes, and the liveness the person page arms
 * its Retire on is computed here rather than guessed at a call site.
 *
 * Firestore is mocked at the SDK boundary; `firestore-tests` is where the rules
 * these writes have to satisfy are checked.
 */
import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  KIOSK_LIVE_WITHIN_MS,
  isKioskLive,
  kioskMayHoldRecords,
  kioskOutOfTouchSince,
  renameKioskDevice,
  retireKioskDevice,
  subscribeKioskDevices,
} from '@/services/kioskDevices';
import type { KioskDevice } from '@/types';

const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  // `toDateOrNull` narrows on this before reaching for a `toDate()`, so the
  // mock needs a constructor for it to fail against.
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  doc: (_db: unknown, path: string) => ({ path }),
  collection: (_db: unknown, path: string) => ({ path }),
  serverTimestamp: () => 'server-timestamp',
  onSnapshot,
  updateDoc,
}));

function device(overrides: Partial<KioskDevice> = {}): KioskDevice {
  return {
    id: 'lobby-tablet',
    name: null,
    approvedBy: 'uid-miriam',
    approvedByName: 'Miriam Achebe',
    pairedAt: new Date('2026-09-01T09:00:00Z'),
    lastSeenAt: new Date('2026-09-06T09:20:00Z'),
    boundTo: 'Sunday School',
    boundChain: 'sunday-school',
    retiredAt: null,
    retiredBy: null,
    ...overrides,
  };
}

describe('retireKioskDevice', () => {
  it('marks the row in the retirer’s own name, and touches nothing else', async () => {
    await retireKioskDevice('lobby-tablet', 'uid-dana');

    const [ref, patch] = updateDoc.mock.calls.at(-1) as unknown as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(ref.path).toBe('kioskDevices/lobby-tablet');
    // Exactly the two fields the rules admit. `approvedBy` and the name it was
    // approved under are the custody record and are not this write's business.
    expect(patch).toEqual({ retiredAt: 'server-timestamp', retiredBy: 'uid-dana' });
  });
});

describe('renameKioskDevice', () => {
  it('writes the one field the rules admit, tidied as the pairing tidies it', async () => {
    await renameKioskDevice('lobby-tablet', '  Nursery   door ');
    const [ref, patch] = updateDoc.mock.calls.at(-1) as unknown as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(ref.path).toBe('kioskDevices/lobby-tablet');
    expect(patch).toEqual({ name: 'Nursery door' });
  });

  it('takes the name away when what was typed says nothing', async () => {
    await renameKioskDevice('lobby-tablet', '   ');
    const [, patch] = updateDoc.mock.calls.at(-1) as unknown as [unknown, Record<string, unknown>];
    expect(patch).toEqual({ name: null });
  });
});

describe('subscribeKioskDevices', () => {
  it('reads the whole collection, retired rows included', () => {
    // A hidden retired row is indistinguishable from a tablet nobody ever
    // paired, and the row is the provenance of the mornings it recorded.
    subscribeKioskDevices(() => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [{ path: string }];
    expect(source.path).toBe('kioskDevices');
  });

  it('reads a full row back whole', () => {
    /*
     * The other half of the defensive read below. With only the empty-document
     * case asserted, an implementation that ignored every stored value and
     * answered its own defaults would pass — and that is a custody record
     * reading as a tablet nobody paired.
     */
    let held: KioskDevice[] = [];
    subscribeKioskDevices((next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [
        {
          id: 'lobby-tablet',
          data: () => ({
            name: 'Lobby',
            approvedBy: 'uid-miriam',
            approvedByName: 'Miriam Achebe',
            pairedAt: new Timestamp(1_767_607_200, 0),
            lastSeenAt: new Timestamp(1_767_610_800, 0),
            boundTo: 'Sunday School',
            boundChain: 'sunday-school',
            retiredAt: new Timestamp(1_767_614_400, 0),
            retiredBy: 'uid-dana',
          }),
        },
      ],
    });

    expect(held[0]).toEqual({
      id: 'lobby-tablet',
      name: 'Lobby',
      approvedBy: 'uid-miriam',
      approvedByName: 'Miriam Achebe',
      pairedAt: new Date(1_767_607_200_000),
      lastSeenAt: new Date(1_767_610_800_000),
      boundTo: 'Sunday School',
      boundChain: 'sunday-school',
      retiredAt: new Date(1_767_614_400_000),
      retiredBy: 'uid-dana',
    });
  });

  it('carries the charge through when the tablet reported one', () => {
    let held: KioskDevice[] = [];
    subscribeKioskDevices((next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [
        {
          id: 'lobby-tablet',
          data: () => ({
            approvedBy: 'uid-miriam',
            lastSeenAt: new Timestamp(1_767_610_800, 0),
            batteryLevel: 0.37,
            charging: false,
          }),
        },
      ],
    });

    expect(held[0]).toMatchObject({ batteryLevel: 0.37, charging: false });
  });

  it('carries a flat battery and a charging one, which are both readings', () => {
    // 0 and `true` are the two values a falsy test would drop on the floor, and
    // 0% is the single most worth-saying thing this field can carry.
    let held: KioskDevice[] = [];
    subscribeKioskDevices((next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [
        {
          id: 'lobby-tablet',
          data: () => ({ approvedBy: 'uid-miriam', batteryLevel: 0, charging: true }),
        },
      ],
    });

    expect(held[0]).toMatchObject({ batteryLevel: 0, charging: true });
  });

  it('leaves the charge off entirely when the tablet does not report one', () => {
    /*
     * The distinction the whole field rests on. Every engine that dropped the
     * Battery Status API reports nothing, and so does every row written before
     * the kiosk started sending it — "does not say" has to stay different from
     * "flat", because the team screen draws a warning for one and silence for
     * the other.
     */
    let held: KioskDevice[] = [];
    subscribeKioskDevices((next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [{ id: 'lobby-tablet', data: () => ({ approvedBy: 'uid-miriam' }) }],
    });

    expect(held[0]).not.toHaveProperty('batteryLevel');
    expect(held[0]).not.toHaveProperty('charging');
  });

  it('drops a charge stored as the wrong type rather than passing it on', () => {
    // A string percentage would reach `Math.round(level * 100)` on the team
    // screen and put NaN% under somebody's name.
    let held: KioskDevice[] = [];
    subscribeKioskDevices((next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [
        {
          id: 'lobby-tablet',
          data: () => ({ approvedBy: 'uid-miriam', batteryLevel: '37%', charging: 'no' }),
        },
      ],
    });

    expect(held[0]).not.toHaveProperty('batteryLevel');
    expect(held[0]).not.toHaveProperty('charging');
  });

  /** One stored row, read back through the listener. */
  function readBack(data: Record<string, unknown>): KioskDevice {
    let held: KioskDevice[] = [];
    subscribeKioskDevices((next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];
    onNext({ docs: [{ id: 'lobby-tablet', data: () => data }] });
    return held[0];
  }

  it('carries what the tablet last said it was still holding', () => {
    // What arms Retire on a kiosk set to nothing with a pickup still waiting —
    // `landKioskRecords` writes all three on every call.
    const holding = readBack({
      approvedBy: 'uid-miriam',
      waitingCount: 3,
      waitingSinceAt: new Timestamp(1_767_610_800, 0),
      allInAt: null,
    });
    expect(holding).toHaveProperty('waitingCount', 3);
    expect(holding).toHaveProperty('waitingSinceAt', new Date(1_767_610_800_000));
    expect(holding).toHaveProperty('allInAt', null);

    // Nothing waiting is a reading too, and 0 is the value a falsy test drops.
    const allIn = readBack({
      approvedBy: 'uid-miriam',
      waitingCount: 0,
      waitingSinceAt: null,
      allInAt: new Timestamp(1_767_614_400, 0),
    });
    expect(allIn).toHaveProperty('waitingCount', 0);
    expect(allIn).toHaveProperty('waitingSinceAt', null);
    expect(allIn).toHaveProperty('allInAt', new Date(1_767_614_400_000));
  });

  it('reads a name that is not one as no name', () => {
    expect(readBack({ approvedBy: 'uid-miriam', name: '   ' }).name).toBeNull();
    expect(readBack({ approvedBy: 'uid-miriam', name: 7 }).name).toBeNull();
    expect(readBack({ approvedBy: 'uid-miriam', name: ' Lobby ' }).name).toBe('Lobby');
  });

  it('leaves the waiting fields off a kiosk that never sent, or sent the wrong type', () => {
    const neverSent = readBack({ approvedBy: 'uid-miriam' });
    expect(neverSent).not.toHaveProperty('waitingCount');
    expect(neverSent).not.toHaveProperty('waitingSinceAt');
    expect(neverSent).not.toHaveProperty('allInAt');

    expect(readBack({ approvedBy: 'uid-miriam', waitingCount: '3' })).not.toHaveProperty(
      'waitingCount',
    );
  });

  it('answers the defaults for a field stored as the wrong type', () => {
    let held: KioskDevice[] = [];
    subscribeKioskDevices((next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [
        {
          id: 'lobby-tablet',
          data: () => ({
            approvedBy: 7,
            approvedByName: 7,
            boundTo: 7,
            boundChain: 7,
            retiredBy: 7,
          }),
        },
      ],
    });

    expect(held[0]).toMatchObject({
      approvedBy: '',
      approvedByName: null,
      boundTo: null,
      boundChain: null,
      retiredBy: null,
    });
  });

  it('hands a refusal to the caller, and survives not having one to hand it to', () => {
    // The person page opens this listener; a counselor's session is refused the
    // collection, and the screen has to go on drawing the rest of the panel.
    const onError = vi.fn();
    subscribeKioskDevices(() => {}, onError);
    const [, , failed] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (error: Error) => void,
    ];
    const refusal = new Error('permission-denied');
    failed(refusal);
    expect(onError).toHaveBeenCalledWith(refusal);

    subscribeKioskDevices(() => {});
    const [, , failedAgain] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (error: Error) => void,
    ];
    expect(() => failedAgain(refusal)).not.toThrow();
  });

  it('reads a stored row defensively', () => {
    let held: KioskDevice[] = [];
    subscribeKioskDevices((next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({ docs: [{ id: 'lobby-tablet', data: () => ({}) }] });

    expect(held[0]).toEqual({
      id: 'lobby-tablet',
      name: null,
      approvedBy: '',
      approvedByName: null,
      pairedAt: null,
      lastSeenAt: null,
      boundTo: null,
      boundChain: null,
      retiredAt: null,
      retiredBy: null,
    });
  });
});

describe('isKioskLive', () => {
  const nowMs = new Date('2026-09-06T09:21:00Z').getTime();

  it('is true only for a bound kiosk that is still reporting', () => {
    expect(isKioskLive(device(), nowMs)).toBe(true);
  });

  it('is false for a kiosk standing idle between gatherings', () => {
    // Reporting, but bound to nothing: nobody is checking a child in on it, so
    // retiring it takes nothing away.
    expect(isKioskLive(device({ boundTo: null, boundChain: null }), nowMs)).toBe(false);
  });

  it('is false once the reports stop', () => {
    const stale = new Date(nowMs - KIOSK_LIVE_WITHIN_MS - 1);
    expect(isKioskLive(device({ lastSeenAt: stale }), nowMs)).toBe(false);
  });

  it('is false exactly at the window, and true a millisecond inside it', () => {
    // The boundary is the whole of what the constant means, and `<=` here would
    // call a kiosk live on the very report that says it is not.
    expect(isKioskLive(device({ lastSeenAt: new Date(nowMs - KIOSK_LIVE_WITHIN_MS) }), nowMs))
      .toBe(false);
    expect(isKioskLive(device({ lastSeenAt: new Date(nowMs - KIOSK_LIVE_WITHIN_MS + 1) }), nowMs))
      .toBe(true);
  });

  it('is false for a row somebody has already retired, whatever it last said', () => {
    expect(
      isKioskLive(device({ retiredAt: new Date('2026-09-06T09:20:30Z') }), nowMs),
    ).toBe(false);
  });

  it('is false for a row that has never reported', () => {
    expect(isKioskLive(device({ lastSeenAt: null }), nowMs)).toBe(false);
  });

  it('holds a healthy kiosk live between its five-minute reports, and past one missed', () => {
    // The window used to be three minutes against a five-minute report, so a
    // kiosk in perfect health read "not recording" two minutes in every five.
    expect(isKioskLive(device({ lastSeenAt: new Date(nowMs - 4 * 60_000) }), nowMs)).toBe(true);
    expect(isKioskLive(device({ lastSeenAt: new Date(nowMs - 9 * 60_000) }), nowMs)).toBe(true);
  });
});

describe('kioskOutOfTouchSince and kioskMayHoldRecords', () => {
  const nowMs = new Date('2026-09-06T11:00:00Z').getTime();
  const nineFortyOne = new Date('2026-09-06T09:41:00Z');

  it('says when a kiosk went quiet while set to a gathering', () => {
    const quiet = device({ lastSeenAt: nineFortyOne });
    expect(kioskOutOfTouchSince(quiet, nowMs)).toEqual(nineFortyOne);
    // It may be holding that gathering's check-ins, so Retire asks first.
    expect(kioskMayHoldRecords(quiet, nowMs)).toBe(true);
  });

  it('says nothing of a live kiosk, though retiring it would still take something away', () => {
    expect(kioskOutOfTouchSince(device({ lastSeenAt: new Date(nowMs - 60_000) }), nowMs)).toBeNull();
    expect(kioskMayHoldRecords(device({ lastSeenAt: new Date(nowMs - 60_000) }), nowMs)).toBe(true);
  });

  it('asks before retiring a kiosk set to nothing that told Tally it still holds records', () => {
    // Online, idle — and a pickup waiting a day for another device's arrival.
    const holding = device({
      boundTo: null,
      boundChain: null,
      lastSeenAt: new Date(nowMs - 60_000),
      waitingCount: 1,
    });
    expect(kioskOutOfTouchSince(holding, nowMs)).toBeNull();
    expect(kioskMayHoldRecords(holding, nowMs)).toBe(true);
  });

  it('asks nothing of a kiosk last set to nothing, or already retired', () => {
    const idle = device({ boundTo: null, boundChain: null, lastSeenAt: nineFortyOne });
    expect(kioskOutOfTouchSince(idle, nowMs)).toBeNull();
    expect(kioskMayHoldRecords(idle, nowMs)).toBe(false);

    const retired = device({ lastSeenAt: nineFortyOne, retiredAt: new Date(nowMs - 1_000) });
    expect(kioskMayHoldRecords(retired, nowMs)).toBe(false);
  });
});
