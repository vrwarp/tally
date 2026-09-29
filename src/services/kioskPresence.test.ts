import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { subscribeKioskPresence, toPresence } from '@/services/kioskPresence';

const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  doc: (_db: unknown, path: string) => ({ path }),
  onSnapshot,
}));

describe('toPresence', () => {
  it('names each kiosk set to the chain, and when it was last heard from', () => {
    expect(
      toPresence({
        chainKey: 'sunday-kids',
        devices: {
          'kiosk-nursery-000002': { name: null, lastSeenAt: new Timestamp(1_790_000_300, 0) },
          'kiosk-lobby-00000001': { name: ' Lobby ', lastSeenAt: new Timestamp(1_790_000_000, 0) },
        },
      }),
    ).toEqual([
      { deviceId: 'kiosk-lobby-00000001', name: 'Lobby', lastSeenAt: new Date(1_790_000_000_000) },
      { deviceId: 'kiosk-nursery-000002', name: null, lastSeenAt: new Date(1_790_000_300_000) },
    ]);
  });

  it('reads nothing it cannot trust as nothing', () => {
    expect(toPresence(undefined)).toEqual([]);
    expect(toPresence({ devices: ['a'] })).toEqual([]);
    expect(toPresence({ devices: null })).toEqual([]);
    expect(toPresence({ devices: { 'kiosk-lobby-00000001': 'x' } })).toEqual([
      { deviceId: 'kiosk-lobby-00000001', name: null, lastSeenAt: null },
    ]);
  });
});

describe('subscribeKioskPresence', () => {
  it('reads the chain’s document, and draws nothing when the read is refused', () => {
    const rows = vi.fn();
    subscribeKioskPresence('sunday-kids', rows);
    const [ref, onNext, failed] = onSnapshot.mock.calls.at(-1) as unknown as [
      { path: string },
      (snapshot: { data: () => unknown }) => void,
      () => void,
    ];
    expect(ref.path).toBe('kioskPresence/sunday-kids');

    onNext({ data: () => ({ devices: { 'kiosk-lobby-00000001': { name: 'Lobby', lastSeenAt: null } } }) });
    expect(rows).toHaveBeenLastCalledWith([{ deviceId: 'kiosk-lobby-00000001', name: 'Lobby', lastSeenAt: null }]);

    failed();
    expect(rows).toHaveBeenLastCalledWith([]);
  });
});
