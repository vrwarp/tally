/**
 * The number beside Review: one per decision the kiosk left, asked for only by
 * somebody who may see the records, and quietly nothing when the read fails.
 */
import { act, renderHook } from '@/test/rtl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KioskParkedRecord } from '@/services/kioskParkedRecords';

const subscribe = vi.hoisted(() => vi.fn());
const unsubscribe = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/kioskParkedRecords', async () => {
  const real = (await vi.importActual('@/services/kioskParkedRecords')) as Record<string, unknown>;
  return { ...real, subscribeUnsettledParkedRecords: subscribe };
});

const { useKioskParkedCount } = await import('@/hooks/useKioskParkedCount');

const EVENT = 'sunday-kids-2026-09-27';

function record(kind: 'check-in' | 'check-out', studentId: string): KioskParkedRecord {
  return {
    id: `${kind}:${EVENT}:${studentId}`,
    kind,
    eventId: EVENT,
    studentId,
    reason: kind === 'check-in' ? 'frozen' : 'arrival-parked',
    tappedAt: new Date(2026, 8, 27, 9, 43),
    student: null,
    gathering: 'Sunday Kids',
    deviceId: 'kiosk-lobby-00000001',
    parkedAt: new Date(2026, 8, 27, 10, 52),
  };
}

let onRows: (rows: KioskParkedRecord[]) => void = () => {};
let onError: (error: Error) => void = () => {};

beforeEach(() => {
  subscribe.mockReset();
  unsubscribe.mockReset();
  subscribe.mockImplementation((rows: typeof onRows, error: typeof onError) => {
    onRows = rows;
    onError = error;
    return unsubscribe;
  });
});

describe('useKioskParkedCount', () => {
  it('counts decisions, not records: an arrival and the pickup parked with it are one', () => {
    const { result } = renderHook(() => useKioskParkedCount(true));
    expect(result.current).toBe(0);

    act(() => onRows([record('check-in', 'noah'), record('check-out', 'noah'), record('check-in', 'ava')]));
    expect(result.current).toBe(2);
  });

  it('asks nothing for somebody who may not see the records', () => {
    const { result } = renderHook(() => useKioskParkedCount(false));
    expect(subscribe).not.toHaveBeenCalled();
    expect(result.current).toBe(0);
  });

  it('says nothing when the read fails', () => {
    const { result } = renderHook(() => useKioskParkedCount(true));
    act(() => onRows([record('check-in', 'noah')]));
    expect(result.current).toBe(1);

    act(() => onError(new Error('permission-denied')));
    expect(result.current).toBe(0);
  });

  it('stops listening, and forgets the count, when the role goes', () => {
    const { result, rerender } = renderHook(({ enabled }) => useKioskParkedCount(enabled), {
      initialProps: { enabled: true },
    });
    act(() => onRows([record('check-in', 'noah')]));
    expect(result.current).toBe(1);

    rerender({ enabled: false });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(0);
  });
});
