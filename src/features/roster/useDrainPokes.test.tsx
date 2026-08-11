/**
 * The timer that makes a five-minute sweep honest.
 *
 * A rate limit answered with "come back in fifteen seconds" must not leave a
 * leader on "Waiting on Planning Center" for five minutes, under a sentence
 * promising it resumes on its own. While a tab is open, the tab owns that
 * retry — so these pin the two things that would make it either useless or
 * harmful: that it fires at the due time rather than immediately, and that it
 * stops when the screen goes away.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrainPokes } from '@/features/roster/useDrainPokes';
import type { UpstreamEdit, UpstreamEditState } from '@/types';

const pokeUpstreamDrain = vi.hoisted(() => vi.fn());
vi.mock('@/services/upstreamEdits', () => ({ pokeUpstreamDrain }));

const NOW = new Date('2026-03-14T09:00:00Z');

function job(state: UpstreamEditState, dueInMs: number | null): UpstreamEdit {
  return {
    id: `edit-${state}-${dueInMs ?? 'none'}`,
    studentId: 'pco_101',
    patch: { lastName: 'Chen-Ito' },
    baseline: { lastName: 'Chen' },
    state,
    attempts: 1,
    nextAttemptAt: dueInMs === null ? null : new Date(NOW.getTime() + dueInMs),
    leaseUntil: null,
    failure: null,
    message: null,
    field: null,
    observed: null,
    survivorPersonId: null,
    survivorName: null,
    createdAt: NOW,
    createdBy: 'dana',
    createdByName: 'Dana Ruiz',
    updatedAt: NOW,
    startedAt: null,
    settledAt: null,
    pendingOnDevice: false,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  pokeUpstreamDrain.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the retry a tab owns while it is open', () => {
  it('asks when the backoff expires, and not before', () => {
    renderHook(() => useDrainPokes([job('waiting', 15_000)]));

    vi.advanceTimersByTime(14_000);
    expect(pokeUpstreamDrain).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    expect(pokeUpstreamDrain).toHaveBeenCalledWith('pco_101');
  });

  it('asks at once for a retry that is already overdue', () => {
    // A tab opened during an outage: the job's moment passed while nobody was
    // looking, and the sweep may be minutes away.
    renderHook(() => useDrainPokes([job('waiting', -60_000)]));

    vi.advanceTimersByTime(1_000);
    expect(pokeUpstreamDrain).toHaveBeenCalledWith('pco_101');
  });

  /**
   * Only `waiting`. A queued job was poked when it was written, a sending one
   * is being run right now, and a settled one is nobody's retry — a timer on
   * any of them is a request to talk to the church's database for no reason.
   */
  it.each(['queued', 'sending', 'landed', 'failed', 'differs'] as const)(
    'sets no timer for a %s job',
    (state) => {
      renderHook(() => useDrainPokes([job(state, -60_000)]));

      vi.advanceTimersByTime(60_000);
      expect(pokeUpstreamDrain).not.toHaveBeenCalled();
    },
  );

  it('stops asking once the screen is gone', () => {
    const { unmount } = renderHook(() => useDrainPokes([job('waiting', 15_000)]));

    unmount();
    vi.advanceTimersByTime(60_000);

    expect(pokeUpstreamDrain).not.toHaveBeenCalled();
  });

  /**
   * The roster's snapshot changes whenever any job anywhere does, and the
   * array's identity changes with it. Re-arming every timer on every snapshot
   * would push a due retry further away each time somebody else saved
   * something — the retry would never fire on a busy queue.
   */
  it('does not re-arm a pending timer when an unrelated job changes', () => {
    const waiting = job('waiting', 15_000);
    const { rerender } = renderHook(({ edits }) => useDrainPokes(edits), {
      initialProps: { edits: [waiting, job('queued', null)] as UpstreamEdit[] },
    });

    vi.advanceTimersByTime(10_000);
    rerender({ edits: [waiting, job('landed', null)] });
    vi.advanceTimersByTime(6_000);

    expect(pokeUpstreamDrain).toHaveBeenCalledTimes(1);
  });
});
