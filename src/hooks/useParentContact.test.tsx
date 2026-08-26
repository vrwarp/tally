/**
 * The one property that matters about this read: it is allowed to say "I do not
 * know".
 *
 * The list it feeds is students nobody can be reached about, so a failure that
 * came back as `false` for everybody would put the entire ministry on a Tuesday
 * morning call list — and a leader would work it before doubting it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
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

  it('is loading from the first render, and settled after', async () => {
    // The list this feeds says "still counting" off these two flags, and a
    // list that opens claiming to have counted nobody is the failure the whole
    // hook is shaped around.
    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));
    const seen: { loading: boolean; loaded: boolean }[] = [];

    const { result } = renderHook(() => {
      const state = useParentContact();
      seen.push({ loading: state.loading, loaded: state.loaded });
      return state;
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(seen[0]).toEqual({ loading: false, loaded: false });
    expect(seen.some((frame) => frame.loading)).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('opens already settled when the session holds an answer', async () => {
    // Coming back to the insights screen should not blank the list it is
    // showing while a sweep it does not need runs again.
    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));
    const first = renderHook(() => useParentContact());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const { result } = renderHook(() => useParentContact());

    expect(result.current.loaded).toBe(true);
    expect(result.current.reachable.get('pco_1')).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('lets the server answer from what it holds on the first read', async () => {
    getParentContactStatus.mockResolvedValue(answer({}));

    renderHook(() => useParentContact());

    await waitFor(() => expect(getParentContactStatus).toHaveBeenCalledWith({ force: false }));
  });

  it('insists on a fresh sweep when somebody presses refresh', async () => {
    // The one moment the held answer is certainly wrong: somebody has just
    // gone and filled a number in.
    getParentContactStatus.mockResolvedValue(answer({ pco_1: false }));
    const { result } = renderHook(() => useParentContact());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.reachable.get('pco_1')).toBe(true));
    expect(getParentContactStatus).toHaveBeenLastCalledWith({ force: true });
  });

  it('refreshes again on a second press', async () => {
    getParentContactStatus.mockResolvedValue(answer({}));
    const { result } = renderHook(() => useParentContact());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.refresh());
    await waitFor(() => expect(getParentContactStatus).toHaveBeenCalledTimes(2));
    act(() => result.current.refresh());

    await waitFor(() => expect(getParentContactStatus).toHaveBeenCalledTimes(3));
  });

  it('clears a failure the moment refresh is pressed', async () => {
    getParentContactStatus.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useParentContact());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    let release: (value: unknown) => void = () => {};
    getParentContactStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    act(() => result.current.refresh());

    expect(result.current.error).toBeNull();
    await act(async () => {
      release(answer({}));
    });
  });

  it('names the refusal apart from the outage', async () => {
    // One is a fact about who is looking; the other is a fact about the
    // network, and only the second is worth pressing the button again for.
    getParentContactStatus.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'functions/permission-denied' }),
    );
    const refused = renderHook(() => useParentContact());
    await waitFor(() =>
      expect(refused.result.current.error).toBe(
        'Only the core team can see which profiles are incomplete.',
      ),
    );
    refused.unmount();

    invalidateParentContact();
    getParentContactStatus.mockRejectedValueOnce(new Error('socket hang up'));
    const offline = renderHook(() => useParentContact());
    await waitFor(() =>
      expect(offline.result.current.error).toBe(
        'Could not check which profiles are incomplete — the people system did not answer.',
      ),
    );
  });

  it('survives a rejection that is not an object at all', async () => {
    getParentContactStatus.mockRejectedValueOnce(null);

    const { result } = renderHook(() => useParentContact());

    await waitFor(() => expect(result.current.error).toContain('did not answer'));
  });

  it('never claims an answer for a student the sweep said nothing about', async () => {
    // A quick-add that exists only in Tally, or an entry Planning Center could
    // not resolve. Neither is a student with no parent contact.
    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));

    const { result } = renderHook(() => useParentContact());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.reachable.has('tally_visitor')).toBe(false);
  });

  it('treats a server that reported nothing as an empty answer', async () => {
    getParentContactStatus.mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useParentContact());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.reachable.size).toBe(0);
  });

  it('drops an answer that lands after the screen has gone', async () => {
    let release: (value: unknown) => void = () => {};
    getParentContactStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useParentContact());
    unmount();
    await act(async () => {
      release(answer({ pco_1: true }));
    });

    expect(noisy).not.toHaveBeenCalled();
    noisy.mockRestore();
  });

  it('still remembers an answer that landed after the screen had gone', async () => {
    // The sweep is expensive and the answer is good whoever is left to read
    // it; only the state update is dropped.
    let release: (value: unknown) => void = () => {};
    getParentContactStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { unmount } = renderHook(() => useParentContact());
    unmount();
    await act(async () => {
      release(answer({ pco_1: true }));
    });

    const { result } = renderHook(() => useParentContact());

    expect(result.current.reachable.get('pco_1')).toBe(true);
  });

  it('does not remember an outage as "nobody has a parent"', async () => {
    getParentContactStatus.mockRejectedValueOnce(new Error('offline'));
    const first = renderHook(() => useParentContact());
    await waitFor(() => expect(first.result.current.error).not.toBeNull());
    first.unmount();

    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));
    const { result } = renderHook(() => useParentContact());

    await waitFor(() => expect(result.current.reachable.get('pco_1')).toBe(true));
  });
});
