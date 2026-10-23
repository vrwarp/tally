/**
 * The team directory, read only where somebody is asking who is on it.
 *
 * The claims: a disabled hook opens no listener, an enabled one reports
 * `loading` until the first snapshot, a failed read is `failed` rather than an
 * empty team, and turning the hook off never leaves it claiming to be loading.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTeam } from '@/features/events/useTeam';
import type { UserProfile } from '@/types';
import { makeUser } from '../../../tests/factories';

const subscribeUsers = vi.hoisted(() => vi.fn());
vi.mock('@/services/users', () => ({ subscribeUsers }));

let emit: (users: UserProfile[]) => void;
let fail: (error: Error) => void;
const unsubscribe = vi.fn();

beforeEach(() => {
  unsubscribe.mockClear();
  subscribeUsers.mockReset();
  subscribeUsers.mockImplementation(
    (onChange: (users: UserProfile[]) => void, onError: (error: Error) => void) => {
      emit = onChange;
      fail = onError;
      return unsubscribe;
    },
  );
});

describe('useTeam', () => {
  it('opens no listener while disabled', () => {
    const { result } = renderHook(() => useTeam(false));
    expect(subscribeUsers).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.members).toEqual([]);
  });

  it('is loading until the first snapshot, then indexes members by uid', () => {
    const miriam = makeUser({ id: 'u1', email: 'miriam@example.org' });
    const { result } = renderHook(() => useTeam(true));
    expect(result.current.loading).toBe(true);

    act(() => emit([miriam]));
    expect(result.current.loading).toBe(false);
    expect(result.current.members).toEqual([miriam]);
    expect(result.current.byUid.get('u1')).toBe(miriam);
  });

  it('reports a failed read as failed, not as an empty team that loaded', () => {
    const { result } = renderHook(() => useTeam(true));
    act(() => fail(new Error('permission-denied')));
    expect(result.current.failed).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('closes the listener when turned off, and stops claiming to be loading', () => {
    const { result, rerender } = renderHook(({ on }) => useTeam(on), {
      initialProps: { on: true },
    });
    expect(result.current.loading).toBe(true);

    rerender({ on: false });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });
});
