/**
 * The guard on the wire.
 *
 * `tests/serverCodes.test.ts` is the build gate over the *catalogue* — every
 * code has a sentence, every sentence has a code. This is the runtime half:
 * what `isServerText` will and will not accept off a callable's answer, which
 * is untrusted data like anything else that crosses a network.
 */
import { describe, expect, it } from 'vitest';
import { SERVER_CODES, isServerText } from '@/lib/serverCodes';

describe('isServerText', () => {
  it('accepts a code the server actually has', () => {
    expect(isServerText({ code: 'auth.notActive' })).toBe(true);
  });

  it('accepts one carrying arguments', () => {
    expect(isServerText({ code: 'backend.notConnected', args: { backend: 'Attendees' } })).toBe(
      true,
    );
  });

  /*
   * A code this build has never heard of is *not* server text: the client is
   * older than the deploy, and answering true would render its own key at a
   * counselor. `useServerText` falls back to the English the server sent
   * instead, which is the point of refusing here.
   */
  it('refuses a code it does not know', () => {
    expect(isServerText({ code: 'auth.fromTheFuture' })).toBe(false);
    expect(isServerText({ code: '' })).toBe(false);
  });

  it('refuses a code that is not a string', () => {
    expect(isServerText({ code: 7 })).toBe(false);
    expect(isServerText({ code: null })).toBe(false);
    expect(isServerText({ code: ['auth.notActive'] })).toBe(false);
  });

  it('refuses anything that is not an object with a code on it', () => {
    expect(isServerText(null)).toBe(false);
    expect(isServerText(undefined)).toBe(false);
    expect(isServerText('auth.notActive')).toBe(false);
    expect(isServerText(42)).toBe(false);
    expect(isServerText({})).toBe(false);
  });

  it('recognises every code the server can send', () => {
    for (const code of SERVER_CODES) {
      expect(isServerText({ code }), code).toBe(true);
    }
  });
});

describe('the code space', () => {
  it('names each code exactly once', () => {
    expect(new Set(SERVER_CODES).size).toBe(SERVER_CODES.length);
  });

  /*
   * Namespaced, so a code reads as what it is at the throw site and groups in
   * the catalogue: `auth.*`, `notFound.*`, `backend.*`, `field.*`.
   */
  it('namespaces every one of them', () => {
    for (const code of SERVER_CODES) expect(code, code).toContain('.');
  });
});
