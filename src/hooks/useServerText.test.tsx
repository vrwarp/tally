/**
 * The sentence the server named, said in the reader's language.
 *
 * A callable answers in two shapes and both reach a screen: a thrown
 * `HttpsError`, whose `details` carry the code, and a returned
 * `{ status, message }`, which carries it at the top level. The fallbacks are
 * the interesting half — a client older than a deploy meets a code it has never
 * heard of, and what it does then decides whether a counselor sees an English
 * sentence or a blank.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@/test/rtl';
import { useServerText } from '@/hooks/useServerText';

function say(source: unknown, fallback?: string): string {
  const { result } = renderHook(() => useServerText());
  return result.current(source, fallback);
}

describe('useServerText', () => {
  it('says the sentence the code names', () => {
    expect(say({ details: { code: 'auth.notActive' } })).toBe(
      'Your access to Tally is not active.',
    );
  });

  it('reads a code off a returned outcome as well as a thrown error', () => {
    // `{ status, message, code }` — the shape the write paths answer with.
    expect(
      say({ code: 'backend.notConnected', args: { backend: 'Planning Center' }, status: 'error' }),
    ).toBe('Planning Center is not connected.');
  });

  /*
   * The server names which backend it could not reach; the sentence around it
   * is the catalogue's. This is the whole reason `args` exists — and why they
   * are only ever nouns: a verb phrase interpolated into a sentence is a
   * sentence in two halves, and a language that reorders them cannot put it
   * back together. See `src/lib/serverCodes.ts`.
   */
  it('fills in the arguments the server sent with it', () => {
    const said = say({
      details: { code: 'backend.unreachable.roster', args: { backend: 'Attendees' } },
    });
    expect(said).toBe('Could not reach Attendees to load the roster.');
  });

  /*
   * A code this build has never heard of — the client is older than the
   * deploy. One English sentence written for a screen beats a key or a blank,
   * so the server's own words are the fallback rather than a thing to hide.
   */
  it('falls back to the English the server sent when the code is unknown', () => {
    expect(say({ details: { code: 'auth.fromTheFuture' }, message: 'Something new happened.' }))
      .toBe('Something new happened.');
  });

  it('uses the server’s English when there is no code at all', () => {
    expect(say({ message: 'Plain old failure.' })).toBe('Plain old failure.');
  });

  /*
   * The last resort, for a failure that never reached a function: a dropped
   * connection carries no sentence of its own.
   */
  it('takes the caller’s fallback when the server said nothing', () => {
    expect(say({}, 'Check your connection.')).toBe('Check your connection.');
    expect(say(null, 'Check your connection.')).toBe('Check your connection.');
    expect(say(undefined, 'Check your connection.')).toBe('Check your connection.');
  });

  it('answers empty rather than undefined when even that is missing', () => {
    // Rendered into a paragraph, so the empty string is a blank line and
    // `undefined` is the word "undefined" on a screen.
    expect(say(null)).toBe('');
    expect(say({ message: '   ' })).toBe('');
  });

  it('ignores a message that is not a string', () => {
    expect(say({ message: 42 }, 'fallback')).toBe('fallback');
  });

  it('ignores a details bag that is not shaped like one', () => {
    expect(say({ details: 'auth.notActive', message: 'the real one' })).toBe('the real one');
    expect(say({ details: { code: 7 }, message: 'the real one' })).toBe('the real one');
  });
});
