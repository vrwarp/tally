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
import { invalidateAdultContact, useAdultContact } from '@/hooks/useAdultContact';

const getParentContactStatus = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({ getParentContactStatus }));

function answer(reachable: Record<string, boolean>, unresolved: string[] = []) {
  return { data: { reachable, unresolved, cached: false, fetchedAt: '2026-02-13T19:30:00.000Z' } };
}

describe('useAdultContact', () => {
  beforeEach(() => {
    invalidateAdultContact();
    getParentContactStatus.mockReset();
  });

  it('reports who can and cannot be reached', async () => {
    getParentContactStatus.mockResolvedValue(answer({ pco_1: false, pco_2: true }));

    const { result } = renderHook(() => useAdultContact());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.reachable.get('pco_1')).toBe(false);
    expect(result.current.reachable.get('pco_2')).toBe(true);
    // A student nobody asked about is absent, not unreachable.
    expect(result.current.reachable.has('tally-9')).toBe(false);
  });

  it('holds the answer for the session rather than re-sweeping', async () => {
    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));

    const first = renderHook(() => useAdultContact());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const second = renderHook(() => useAdultContact());
    expect(second.result.current.reachable.get('pco_1')).toBe(true);
    expect(getParentContactStatus).toHaveBeenCalledTimes(1);
  });

  it('says it could not check instead of answering "nobody"', async () => {
    getParentContactStatus.mockRejectedValue(new Error('Planning Center is having a minute'));

    const { result } = renderHook(() => useAdultContact());

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
      const state = useAdultContact();
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
    const first = renderHook(() => useAdultContact());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const { result } = renderHook(() => useAdultContact());

    expect(result.current.loaded).toBe(true);
    expect(result.current.reachable.get('pco_1')).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('lets the server answer from what it holds on the first read', async () => {
    getParentContactStatus.mockResolvedValue(answer({}));

    renderHook(() => useAdultContact());

    await waitFor(() => expect(getParentContactStatus).toHaveBeenCalledWith({ force: false }));
  });

  it('insists on a fresh sweep when somebody presses refresh', async () => {
    // The one moment the held answer is certainly wrong: somebody has just
    // gone and filled a number in.
    getParentContactStatus.mockResolvedValue(answer({ pco_1: false }));
    const { result } = renderHook(() => useAdultContact());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.reachable.get('pco_1')).toBe(true));
    expect(getParentContactStatus).toHaveBeenLastCalledWith({ force: true });
  });

  it('refreshes again on a second press', async () => {
    getParentContactStatus.mockResolvedValue(answer({}));
    const { result } = renderHook(() => useAdultContact());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.refresh());
    await waitFor(() => expect(getParentContactStatus).toHaveBeenCalledTimes(2));
    act(() => result.current.refresh());

    await waitFor(() => expect(getParentContactStatus).toHaveBeenCalledTimes(3));
  });

  it('clears a failure the moment refresh is pressed', async () => {
    getParentContactStatus.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAdultContact());
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
    const refused = renderHook(() => useAdultContact());
    await waitFor(() =>
      expect(refused.result.current.error).toBe(
        'Only the core team can see which profiles are incomplete.',
      ),
    );
    refused.unmount();

    invalidateAdultContact();
    getParentContactStatus.mockRejectedValueOnce(new Error('socket hang up'));
    const offline = renderHook(() => useAdultContact());
    await waitFor(() =>
      expect(offline.result.current.error).toBe(
        'Could not check which profiles are incomplete — the people system did not answer.',
      ),
    );
  });

  it('survives a rejection that is not an object at all', async () => {
    getParentContactStatus.mockRejectedValueOnce(null);

    const { result } = renderHook(() => useAdultContact());

    await waitFor(() => expect(result.current.error).toContain('did not answer'));
  });

  it('never claims an answer for a student the sweep said nothing about', async () => {
    // A quick-add that exists only in Tally, or an entry Planning Center could
    // not resolve. Neither is a student with no parent contact.
    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));

    const { result } = renderHook(() => useAdultContact());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.reachable.has('tally_visitor')).toBe(false);
  });

  it('treats a server that reported nothing as an empty answer', async () => {
    getParentContactStatus.mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useAdultContact());

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

    const { unmount } = renderHook(() => useAdultContact());
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
    const { unmount } = renderHook(() => useAdultContact());
    unmount();
    await act(async () => {
      release(answer({ pco_1: true }));
    });

    const { result } = renderHook(() => useAdultContact());

    expect(result.current.reachable.get('pco_1')).toBe(true);
  });

  describe('a refresh pressed while the first sweep is still out', () => {
    /**
     * Two sweeps in flight and the fresher one lands first. The stale one is
     * still remembered — the sweep is expensive and the answer is good — but
     * nothing about it reaches the screen.
     */
    function twoSweeps() {
      const gates: Array<(value: unknown) => void> = [];
      getParentContactStatus.mockImplementation(
        () =>
          new Promise((resolve) => {
            gates.push(resolve);
          }),
      );
      return gates;
    }

    it('does not let the stale answer overwrite the fresh one', async () => {
      const gates = twoSweeps();
      const { result } = renderHook(() => useAdultContact());
      await waitFor(() => expect(gates).toHaveLength(1));

      act(() => result.current.refresh());
      await waitFor(() => expect(gates).toHaveLength(2));

      await act(async () => gates[1]!(answer({ pco_1: true })));
      expect(result.current.reachable.get('pco_1')).toBe(true);

      // The first sweep, arriving late with the state of an hour ago.
      await act(async () => gates[0]!(answer({ pco_1: false })));

      expect(result.current.reachable.get('pco_1')).toBe(true);
    });

    it('stays loading while the fresh sweep is still out', async () => {
      const gates = twoSweeps();
      const { result } = renderHook(() => useAdultContact());
      await waitFor(() => expect(gates).toHaveLength(1));

      act(() => result.current.refresh());
      await waitFor(() => expect(gates).toHaveLength(2));

      await act(async () => gates[0]!(answer({ pco_1: false })));

      // The list says "still counting" until the sweep somebody asked for
      // comes back, not until the one they gave up on does.
      expect(result.current.loading).toBe(true);

      await act(async () => gates[1]!(answer({ pco_1: true })));
      expect(result.current.loading).toBe(false);
    });

    it('does not report a failure the reader has already asked past', async () => {
      /*
       * The abandoned sweep failing. Its bad news belongs to a question nobody
       * is asking any more, and putting it on screen would cover a sweep that
       * is still running — on the list somebody pressed refresh on because the
       * last answer looked wrong.
       */
      const gates: ((value: unknown) => void)[] = [];
      const rejects: ((cause: Error) => void)[] = [];
      getParentContactStatus.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            gates.push(resolve);
            rejects.push(reject);
          }),
      );

      const { result } = renderHook(() => useAdultContact());
      await waitFor(() => expect(gates).toHaveLength(1));

      act(() => result.current.refresh());
      await waitFor(() => expect(gates).toHaveLength(2));

      await act(async () => {
        rejects[0]!(new Error('offline'));
        await Promise.resolve();
      });

      expect(result.current.error).toBeNull();
    });

    it('counts as settled once any sweep has answered', async () => {
      const gates = twoSweeps();
      const { result } = renderHook(() => useAdultContact());
      await waitFor(() => expect(gates).toHaveLength(1));

      act(() => result.current.refresh());
      await waitFor(() => expect(gates).toHaveLength(2));

      // The first sweep lands while the second is still out. Its answer is
      // remembered for the session but no state of this screen's was set,
      // because this screen had stopped waiting for it.
      await act(async () => gates[0]!(answer({ pco_1: false })));

      // A second press, which is what a leader does when a list has been
      // saying "counting" for a while. The next render finds an answer already
      // held, and there is no reason to draw a skeleton over it.
      act(() => result.current.refresh());

      expect(result.current.loaded).toBe(true);
      expect(result.current.reachable.get('pco_1')).toBeUndefined();
    });
  });

  it('takes the failure down when a later sweep succeeds', async () => {
    getParentContactStatus.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAdultContact());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    getParentContactStatus.mockResolvedValueOnce(answer({ pco_1: true }));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.reachable.get('pco_1')).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('has not settled on the first frame of a cold session', () => {
    getParentContactStatus.mockReturnValue(new Promise(() => {}));
    const seen: boolean[] = [];

    renderHook(() => {
      seen.push(useAdultContact().loaded);
      return null;
    });

    // Before any effect has run. `loaded` is what the incomplete-profile list
    // branches on, and starting it true draws "nobody is unreachable" over a
    // sweep that has not happened.
    expect(seen[0]).toBe(false);
  });

  it('does not remember an outage as "nobody has a parent"', async () => {
    getParentContactStatus.mockRejectedValueOnce(new Error('offline'));
    const first = renderHook(() => useAdultContact());
    await waitFor(() => expect(first.result.current.error).not.toBeNull());
    first.unmount();

    getParentContactStatus.mockResolvedValue(answer({ pco_1: true }));
    const { result } = renderHook(() => useAdultContact());

    await waitFor(() => expect(result.current.reachable.get('pco_1')).toBe(true));
  });
});
