import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetJoinToken, rememberJoinToken, rememberedJoinToken } from './joinToken';

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('join token memory', () => {
  it('has nothing before anything is written', () => {
    expect(rememberedJoinToken()).toBeNull();
  });

  it('hands back the token it was given', () => {
    rememberJoinToken('abc123');
    expect(rememberedJoinToken()).toBe('abc123');
  });

  it('keeps the token in the tab only, never in shared storage', () => {
    rememberJoinToken('abc123');
    expect(window.localStorage.getItem('tally:join-token')).toBeNull();
  });

  it('treats a blank token as none', () => {
    rememberJoinToken('   ');
    expect(rememberedJoinToken()).toBeNull();
  });

  it('forgets a spent token', () => {
    rememberJoinToken('abc123');
    forgetJoinToken();
    expect(rememberedJoinToken()).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    expect(() => rememberJoinToken('abc123')).not.toThrow();
    expect(rememberedJoinToken()).toBeNull();
    expect(() => forgetJoinToken()).not.toThrow();
  });
});
