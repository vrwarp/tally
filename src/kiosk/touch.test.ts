import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAnswer,
  noteFailure,
  outOfTouchSince,
  reached,
  resetTouchForTests,
  subscribeTouch,
  unreached,
} from './touch';

afterEach(() => resetTouchForTests());

describe('being in touch', () => {
  it('starts in touch, goes out on the first unanswered request, and comes back on any answer', () => {
    expect(outOfTouchSince()).toBeNull();
    unreached(1_000);
    unreached(2_000);
    expect(outOfTouchSince()).toBe(1_000);
    reached();
    expect(outOfTouchSince()).toBeNull();
  });

  it('tells listeners only when it changes', () => {
    const heard = vi.fn();
    subscribeTouch(heard);
    unreached(1_000);
    unreached(2_000);
    reached();
    reached();
    expect(heard.mock.calls).toEqual([[1_000], [null]]);
  });

  it('stops telling a listener that has let go', () => {
    const heard = vi.fn();
    const stop = subscribeTouch(heard);
    stop();
    unreached(1_000);
    expect(heard).not.toHaveBeenCalled();
  });

  it('forgets every listener on a reset, so one test cannot hear the next', () => {
    const heard = vi.fn();
    subscribeTouch(heard);
    resetTouchForTests();
    unreached(1_000);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('isAnswer', () => {
  it('counts a refusal as an answer — the server was reached', () => {
    expect(isAnswer({ code: 'permission-denied' })).toBe(true);
    expect(isAnswer({ code: 'functions/permission-denied' })).toBe(true);
    expect(isAnswer({ code: 'functions/not-found' })).toBe(true);
  });

  it('never counts what a dropped connection also looks like', () => {
    for (const code of ['internal', 'functions/internal', 'unavailable', 'unknown', 'deadline-exceeded']) {
      expect(isAnswer({ code })).toBe(false);
    }
    expect(isAnswer(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAnswer(null)).toBe(false);
  });

  it('notes a failure by what it says about the connection', () => {
    noteFailure({ code: 'unavailable' }, 5_000);
    expect(outOfTouchSince()).toBe(5_000);
    noteFailure({ code: 'permission-denied' });
    expect(outOfTouchSince()).toBeNull();
  });
});
