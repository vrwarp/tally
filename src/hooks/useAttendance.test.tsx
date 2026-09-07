/**
 * The stream that makes multi-counselor check-in work.
 *
 * When one counselor taps a student, every other phone in the building updates
 * from this listener without a refresh. What is asserted here is mostly what
 * happens *between* two gatherings: the previous night's check-ins must not
 * flash on screen while the new listener warms up, the old listener must
 * actually be closed, and a screen with no gathering chosen must not sit under
 * a spinner waiting for a listener nobody opened.
 *
 * `useRsvps` is the same hook with one extra switch — a gathering that does not
 * take RSVPs opens no listener at all — so the two are tested side by side.
 */
import { act, renderHook } from '@/test/rtl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAttendance, useRsvps } from '@/hooks/useAttendance';
import { makeAttendance, makeRsvp } from '../../tests/factories';
import type { AttendanceRecord, Rsvp } from '@/types';

/** One listener's handlers, so a test can deliver and fail on demand. */
interface Listener<T> {
  eventId: string | null;
  deliver: (value: T[]) => void;
  fail: (cause: Error) => void;
  stopped: number;
  opened: number;
}

const attendanceStream = vi.hoisted(
  () => ({ eventId: null, deliver: () => {}, fail: () => {}, stopped: 0, opened: 0 }),
) as Listener<AttendanceRecord>;
const rsvpStream = vi.hoisted(
  () => ({ eventId: null, deliver: () => {}, fail: () => {}, stopped: 0, opened: 0 }),
) as Listener<Rsvp>;

function connect<T>(stream: Listener<T>) {
  return (eventId: string, next: (value: T[]) => void, onError: (cause: Error) => void) => {
    stream.eventId = eventId;
    stream.deliver = next;
    stream.fail = onError;
    stream.opened += 1;
    return () => {
      stream.stopped += 1;
    };
  };
}

vi.mock('@/services/attendance', () => ({ subscribeAttendance: connect(attendanceStream) }));
vi.mock('@/services/rsvps', () => ({ subscribeRsvps: connect(rsvpStream) }));

function reset<T>(stream: Listener<T>) {
  stream.eventId = null;
  stream.deliver = () => {};
  stream.fail = () => {};
  stream.stopped = 0;
  stream.opened = 0;
}

beforeEach(() => {
  reset(attendanceStream);
  reset(rsvpStream);
});

describe('useAttendance', () => {
  it('opens a listener for the gathering it was given', () => {
    const { result } = renderHook(() => useAttendance('event-1'));

    expect(attendanceStream.eventId).toBe('event-1');
    expect(result.current.loading).toBe(true);
    expect(result.current.attendance).toEqual([]);
  });

  it('publishes the register and settles', () => {
    const record = makeAttendance({ id: 'pco_1' });
    const { result } = renderHook(() => useAttendance('event-1'));

    act(() => attendanceStream.deliver([record]));

    expect(result.current.attendance).toEqual([record]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('opens nothing at all when no gathering is chosen', () => {
    // The chooser is a real screen, and it must not sit under a spinner.
    const { result } = renderHook(() => useAttendance(null));

    expect(attendanceStream.opened).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.attendance).toEqual([]);
  });

  it('empties the register when the gathering is taken away', () => {
    const { result, rerender } = renderHook(({ id }) => useAttendance(id), {
      initialProps: { id: 'event-1' as string | null },
    });
    act(() => attendanceStream.deliver([makeAttendance({ id: 'pco_1' })]));

    rerender({ id: null });

    expect(result.current.attendance).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(attendanceStream.stopped).toBe(1);
  });

  it('clears the last gathering before the next one answers', () => {
    // Otherwise last Friday's ticks are on screen against tonight's names for
    // as long as the new listener takes to warm up.
    const { result, rerender } = renderHook(({ id }) => useAttendance(id), {
      initialProps: { id: 'event-1' },
    });
    act(() => attendanceStream.deliver([makeAttendance({ id: 'pco_1' })]));

    rerender({ id: 'event-2' });

    expect(result.current.attendance).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(attendanceStream.eventId).toBe('event-2');
  });

  it('closes the old listener when the gathering changes', () => {
    const { rerender } = renderHook(({ id }) => useAttendance(id), {
      initialProps: { id: 'event-1' },
    });

    rerender({ id: 'event-2' });

    expect(attendanceStream.stopped).toBe(1);
    expect(attendanceStream.opened).toBe(2);
  });

  it('does not reopen the listener for the same gathering', () => {
    const { rerender } = renderHook(({ id }) => useAttendance(id), {
      initialProps: { id: 'event-1' },
    });

    rerender({ id: 'event-1' });

    expect(attendanceStream.opened).toBe(1);
  });

  it('closes the listener on unmount', () => {
    const { unmount } = renderHook(() => useAttendance('event-1'));
    unmount();
    expect(attendanceStream.stopped).toBe(1);
  });

  it('reports what a refused listener said and stops loading', () => {
    const { result } = renderHook(() => useAttendance('event-1'));

    act(() => attendanceStream.fail(new Error('Missing or insufficient permissions.')));

    expect(result.current.error).toBe('Missing or insufficient permissions.');
    expect(result.current.loading).toBe(false);
  });

  it('takes the failure down once the stream recovers', () => {
    const { result } = renderHook(() => useAttendance('event-1'));
    act(() => attendanceStream.fail(new Error('offline')));

    act(() => attendanceStream.deliver([]));

    expect(result.current.error).toBeNull();
  });
});

describe('useRsvps', () => {
  it('opens a listener for the gathering it was given', () => {
    const { result } = renderHook(() => useRsvps('event-1'));

    expect(rsvpStream.eventId).toBe('event-1');
    expect(result.current.loading).toBe(true);
  });

  it('publishes the list and settles', () => {
    const rsvp = makeRsvp({ id: 'pco_1' });
    const { result } = renderHook(() => useRsvps('event-1'));

    act(() => rsvpStream.deliver([rsvp]));

    expect(result.current.rsvps).toEqual([rsvp]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('opens nothing for a gathering that does not take RSVPs', () => {
    // A recurring Friday never has an RSVP list, and paying for a listener on
    // an empty subcollection on every phone is waste.
    const { result } = renderHook(() => useRsvps('event-1', false));

    expect(rsvpStream.opened).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.rsvps).toEqual([]);
  });

  it('opens nothing when no gathering is chosen', () => {
    const { result } = renderHook(() => useRsvps(null));

    expect(rsvpStream.opened).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('empties the list when RSVPs are switched off', () => {
    const { result, rerender } = renderHook(({ on }) => useRsvps('event-1', on), {
      initialProps: { on: true },
    });
    act(() => rsvpStream.deliver([makeRsvp({ id: 'pco_1' })]));

    rerender({ on: false });

    expect(result.current.rsvps).toEqual([]);
    expect(rsvpStream.stopped).toBe(1);
  });

  it('clears the last gathering before the next one answers', () => {
    const { result, rerender } = renderHook(({ id }) => useRsvps(id), {
      initialProps: { id: 'event-1' },
    });
    act(() => rsvpStream.deliver([makeRsvp({ id: 'pco_1' })]));

    rerender({ id: 'event-2' });

    expect(result.current.rsvps).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it('closes the listener on unmount', () => {
    const { unmount } = renderHook(() => useRsvps('event-1'));
    unmount();
    expect(rsvpStream.stopped).toBe(1);
  });

  it('reports what a refused listener said and stops loading', () => {
    const { result } = renderHook(() => useRsvps('event-1'));

    act(() => rsvpStream.fail(new Error('refused')));

    expect(result.current.error).toBe('refused');
    expect(result.current.loading).toBe(false);
  });

  it('takes the failure down once the stream recovers', () => {
    const { result } = renderHook(() => useRsvps('event-1'));
    act(() => rsvpStream.fail(new Error('offline')));

    act(() => rsvpStream.deliver([]));

    expect(result.current.error).toBeNull();
  });

  it('is enabled unless a caller says otherwise', () => {
    renderHook(() => useRsvps('event-1'));
    expect(rsvpStream.opened).toBe(1);
  });
});

describe('the first frame, before any listener has answered', () => {
  /**
   * Every one of these is read by the check-in screen on its first paint, and
   * an effect cannot correct them until after it. A wrong initial value is a
   * roster row, or a spinner, drawn out of nothing and gone again a frame
   * later.
   */
  function firstFrame<T>(use: () => T): T {
    const seen: T[] = [];
    renderHook(() => {
      seen.push(use());
      return null;
    });
    return seen[0]!;
  }

  it('has nobody checked in and nobody RSVP-d', () => {
    expect(firstFrame(() => useAttendance('friday')).attendance).toEqual([]);
    expect(firstFrame(() => useRsvps('friday')).rsvps).toEqual([]);
  });

  it('is loading for a gathering it is about to open a listener for', () => {
    expect(firstFrame(() => useAttendance('friday')).loading).toBe(true);
    expect(firstFrame(() => useRsvps('friday')).loading).toBe(true);
  });

  it('is not loading with no gathering chosen', () => {
    // A screen with nothing selected must not sit under a spinner waiting for
    // a listener nobody is going to open.
    expect(firstFrame(() => useAttendance(null)).loading).toBe(false);
    expect(firstFrame(() => useRsvps(null)).loading).toBe(false);
  });

  it('is not loading for a gathering that does not take RSVPs', () => {
    // Both halves have to be true before there is anything to wait for.
    expect(firstFrame(() => useRsvps('friday', false)).loading).toBe(false);
    expect(firstFrame(() => useRsvps(null, false)).loading).toBe(false);
  });
});
