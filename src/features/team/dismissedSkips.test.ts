import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDismissedSkips, skipId, writeDismissedSkips } from './dismissedSkips';

const KEY = 'tally:team:dismissedSkips';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('skipId', () => {
  it('keeps two chains of one invitation apart', () => {
    expect(skipId('inv1', 'chainA')).not.toBe(skipId('inv1', 'chainB'));
  });

  it('keeps one chain on two invitations apart', () => {
    expect(skipId('inv1', 'chainA')).not.toBe(skipId('inv2', 'chainA'));
  });
});

describe('readDismissedSkips', () => {
  it('is empty when nothing was ever written', () => {
    expect(readDismissedSkips().size).toBe(0);
  });

  it('round-trips what was written', () => {
    const ids = new Set([skipId('inv1', 'a'), skipId('inv2', 'b')]);
    writeDismissedSkips(ids);
    expect(readDismissedSkips()).toEqual(ids);
  });

  it('ignores a value that is not JSON', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(readDismissedSkips().size).toBe(0);
  });

  it('ignores JSON that is not a list', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(readDismissedSkips().size).toBe(0);
  });

  it('keeps only the strings of a mixed list', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['inv1::a', 7, null, 'inv2::b']));
    expect([...readDismissedSkips()]).toEqual(['inv1::a', 'inv2::b']);
  });

  it('is empty when storage refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readDismissedSkips().size).toBe(0);
  });
});

describe('writeDismissedSkips', () => {
  it('does not throw when storage refuses to be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => writeDismissedSkips(new Set(['inv1::a']))).not.toThrow();
  });
});
