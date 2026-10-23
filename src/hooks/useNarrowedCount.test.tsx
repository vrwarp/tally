/**
 * How many people stand inside a gathering's fence, for the badge that says so.
 *
 * Admin-only and restricted-only: everybody else, and every gathering with no
 * fence, gets `null` so the caller can skip rendering the row altogether.
 */
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@/test/rtl';
import { AuthContext, type AuthContextValue } from '@/context/authContext';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { useNarrowedCount } from '@/hooks/useNarrowedCount';
import { roleAtLeast, type EventAccess, type Role } from '@/types';
import { makeEvent } from '../../tests/factories';

const EVENT = makeEvent({ id: 'friday-night', seriesId: 'friday-series' });

function accessFor(restricted: boolean, members: string[]): EventAccess {
  return {
    id: 'friday-series',
    chainKey: 'friday-series',
    restricted,
    members: new Set(members),
    updatedAt: null,
    updatedBy: 'admin-uid',
  };
}

/** Only the two things the hook reads are real; the rest is never touched. */
function wrapperFor(role: Role, access: Map<string, EventAccess>) {
  const auth = { can: (required: Role) => roleAtLeast(role, required) } as AuthContextValue;
  const data = { access } as DataContextValue;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={auth}>
        <DataContext.Provider value={data}>{children}</DataContext.Provider>
      </AuthContext.Provider>
    );
  };
}

describe('useNarrowedCount', () => {
  it('counts the members of a restricted gathering for an admin', () => {
    const access = new Map([['friday-series', accessFor(true, ['a', 'b', 'c'])]]);
    const { result } = renderHook(() => useNarrowedCount(EVENT), {
      wrapper: wrapperFor('admin', access),
    });
    expect(result.current).toBe(3);
  });

  it('counts an empty fence as zero rather than as no fence', () => {
    const access = new Map([['friday-series', accessFor(true, [])]]);
    const { result } = renderHook(() => useNarrowedCount(EVENT), {
      wrapper: wrapperFor('admin', access),
    });
    expect(result.current).toBe(0);
  });

  it('answers null when the list is kept but no longer restricting', () => {
    const access = new Map([['friday-series', accessFor(false, ['a', 'b'])]]);
    const { result } = renderHook(() => useNarrowedCount(EVENT), {
      wrapper: wrapperFor('admin', access),
    });
    expect(result.current).toBeNull();
  });

  it('answers null when the gathering has no access document at all', () => {
    const { result } = renderHook(() => useNarrowedCount(EVENT), {
      wrapper: wrapperFor('admin', new Map()),
    });
    expect(result.current).toBeNull();
  });

  it('answers null for anybody below admin, whatever the fence says', () => {
    const access = new Map([['friday-series', accessFor(true, ['a', 'b'])]]);
    const { result } = renderHook(() => useNarrowedCount(EVENT), {
      wrapper: wrapperFor('core', access),
    });
    expect(result.current).toBeNull();
  });
});
