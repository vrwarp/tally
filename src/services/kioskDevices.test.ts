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
    // arm Retire on a tablet whose last word was three minutes ago.
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
});
