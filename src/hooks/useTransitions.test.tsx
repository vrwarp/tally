/**
 * The aging-out record, as the two screens that read it receive it.
 *
 * The claim worth pinning is the failure, not the success. Every derivation
 * downstream of this hook fails open *jointly*: with no releases, a chain's MIA
 * row stays and the pooled list's shield stays, so the row a release would have
 * resolved is the fallback for the row it would have created and nobody goes
 * silent. That only holds if a refused or broken read publishes *nothing*
 * rather than a partial answer — a listener that kept its last value after an
 * error would leave half a ministry's releases standing against a stream that
 * had stopped.
 *
 * The other half is that the subscription is torn down. This hook is mounted by
 * the dashboard and a student's page rather than by the provider, precisely so
 * a door pays nothing for it; a listener that outlived its screen would undo
 * that.
 */
import { act, render } from '@/test/rtl';
import { describe, expect, it, vi } from 'vitest';
import { useTransitions } from '@/hooks/useTransitions';
import type { Transition } from '@/types';

const subscribeTransitions = vi.hoisted(() => vi.fn());
vi.mock('@/services/transitions', () => ({ subscribeTransitions }));

function transition(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 'sunday-kids__pco_5101',
    chainKey: 'sunday-kids',
    studentId: 'pco_5101',
    reason: 'moved-on',
    note: null,
    releasedBy: 'uid-ruth',
    releasedByName: 'Ruth Adeyemi',
    releasedAt: new Date('2026-09-08T11:15:00'),
    ...overrides,
  };
}

/** Mounts the hook and hands back what it is holding, plus the unmount. */
function mount() {
  let held: { transitions: Transition[]; error: string | null } = {
    transitions: [],
    error: null,
  };

  function Probe() {
    held = useTransitions();
    return null;
  }

  const view = render(<Probe />);
  return {
    get current() {
      return held;
    },
    unmount: view.unmount,
  };
}

/** The two callbacks the hook handed the service. */
function listener() {
  const [onChange, onError] = subscribeTransitions.mock.calls.at(-1) as [
    (next: Transition[]) => void,
    (error: Error) => void,
  ];
  return { onChange, onError };
}

describe('useTransitions', () => {
  it('starts with nothing, which is "still expected" everywhere downstream', () => {
    subscribeTransitions.mockReturnValue(() => {});

    const probe = mount();

    expect(probe.current.transitions).toEqual([]);
    expect(probe.current.error).toBeNull();
  });

  it('publishes what the stream delivers', () => {
    subscribeTransitions.mockReturnValue(() => {});
    const probe = mount();

    const records = [transition(), transition({ id: 'friday__pco_5109', chainKey: 'friday' })];
    act(() => listener().onChange(records));

    expect(probe.current.transitions).toEqual(records);
    expect(probe.current.error).toBeNull();
  });

  it('drops back to nothing when the read fails, rather than holding a stale answer', () => {
    subscribeTransitions.mockReturnValue(() => {});
    const probe = mount();

    act(() => listener().onChange([transition()]));
    expect(probe.current.transitions).toHaveLength(1);

    act(() => listener().onError(new Error('Missing or insufficient permissions.')));

    // Fail open: no releases means every row this reader would have resolved is
    // still on the call list, which is today's app rather than a silence.
    expect(probe.current.transitions).toEqual([]);
    expect(probe.current.error).toBe('Missing or insufficient permissions.');
  });

  it('clears the error once the stream answers again', () => {
    subscribeTransitions.mockReturnValue(() => {});
    const probe = mount();

    act(() => listener().onError(new Error('offline')));
    expect(probe.current.error).toBe('offline');

    act(() => listener().onChange([transition()]));
    expect(probe.current.error).toBeNull();
    expect(probe.current.transitions).toHaveLength(1);
  });

  it('subscribes once, and stops when the screen goes', () => {
    const stop = vi.fn();
    subscribeTransitions.mockReturnValue(stop);

    const probe = mount();
    expect(subscribeTransitions).toHaveBeenCalledTimes(1);

    probe.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
