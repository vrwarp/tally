/**
 * The one property that matters about this read: it is allowed to say "I do not
 * know".
 *
 * The list it feeds is students nobody can be reached about, so a failure that
 * came back as `false` for everybody would put the entire ministry on a Tuesday
 * morning call list — and a leader would work it before doubting it.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateParentContact, useParentContact } from '@/hooks/useParentContact';

const getParentContactStatus = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({ getParentContactStatus }));

function answer(reachable: Record<string, boolean>, unresolved: string[] = []) {
  return { data: { reachable, unresolved, cached: false, fetchedAt: '2026-02-13T19:30:00.000Z' } };
}

describe('useParentContact', () => {
  beforeEach(() => {
    invalidateParentContact();
    getParentContactStatus.mockReset();
  });

  it('reports who can and cannot be reached', async () => {
    getParentContactStatus.mockResolvedValue(answer({ pco_1: false, pco_2: true }));

    const { result } = renderHook(() => useParentContact());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.reachable.get('pco_1')).toBe(false);
    expect(result.current.reachable.get('pco_2')).toBe(true);
    // A student nobody asked about is absent, not unreachable.
    expect(result.current.reachable.has('tally-9')).toBe(false);
  });

  it('holds the answer for the session rather than re-sweeping', async () => {
    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));

    const first = renderHook(() => useParentContact());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const second = renderHook(() => useParentContact());
    expect(second.result.current.reachable.get('pco_1')).toBe(true);
    expect(getParentContactStatus).toHaveBeenCalledTimes(1);
  });

  it('says it could not check instead of answering "nobody"', async () => {
    getParentContactStatus.mockRejectedValue(new Error('Planning Center is having a minute'));

    const { result } = renderHook(() => useParentContact());

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.reachable.size).toBe(0);
    expect(result.current.loaded).toBe(false);
  });
});
