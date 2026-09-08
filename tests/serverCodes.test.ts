/**
 * The build gate the server's codes hang on.
 *
 * `functions/` cannot reach `messages/` — it deploys on its own — so nothing
 * about a code is checked where the code is written. A `HttpsError` carrying
 * `notFound.studnet` would fall back to its English message and look almost
 * right, in English, for as long as nobody opened the app in Chinese.
 *
 * So the two halves are compared here, in both directions. A code with no
 * sentence is a screen that says its own key; a sentence with no code is a
 * string somebody is paying a translator for and nothing will ever show.
 */
import { describe, expect, it } from 'vitest';
import { SERVER_CODES } from '@/lib/serverCodes';
import { FIELD_MESSAGES } from '@/lib/registrationFields';
import en from '../messages/en.json';
import { flatten } from '@/lib/translationState';

/** `Errors.backend.unreachable.roster` → `backend.unreachable.roster`. */
function catalogueCodes(): string[] {
  return [...flatten(en.Errors as unknown as Parameters<typeof flatten>[0]).keys()].filter((key) =>
    key.includes('.'),
  );
}

describe('server error codes', () => {
  it('every code the server can send has a sentence', () => {
    const said = new Set(catalogueCodes());
    const mute = SERVER_CODES.filter((code) => !said.has(code));
    expect(mute, 'codes with no Errors.* entry in messages/en.json').toEqual([]);
  });

  it('every nested Errors.* sentence is a code the server can send', () => {
    const known = new Set<string>(SERVER_CODES);
    const orphans = catalogueCodes().filter((code) => !known.has(code));
    expect(orphans, 'Errors.* entries no server code names').toEqual([]);
  });

  /*
   * The flat `Errors.*` keys — `sessionExpired`, `rosterUnreachable` — are the
   * client's own, said about a failure it worked out for itself. Keeping the
   * server's under dotted paths is what lets one namespace hold both without
   * either half having to know about the other.
   */
  it('keeps the client’s own error strings out of the code space', () => {
    for (const code of SERVER_CODES) {
      expect(code, `${code} must be namespaced, so it cannot collide`).toContain('.');
    }
  });
});

/**
 * The one English, in two places that cannot import each other.
 *
 * `registrationFields.ts` is copied into the functions package and cannot reach
 * a catalogue, so it carries the English itself — that is what an
 * `invalid-argument`'s `message` is, and what a client older than the deploy
 * falls back to. Two copies of a sentence is two sentences waiting to disagree,
 * so they are compared rather than trusted.
 */
describe('the shared field rules', () => {
  it('say the same English as the catalogue', () => {
    const said = flatten(en.Errors as unknown as Parameters<typeof flatten>[0]);
    for (const [code, message] of Object.entries(FIELD_MESSAGES)) {
      expect(said.get(code), `Errors.${code}`).toBe(message);
    }
  });

  it('have a code for every message and a message for every code', () => {
    const codes = new Set(Object.keys(FIELD_MESSAGES));
    const declared = SERVER_CODES.filter((code) => code.startsWith('field.'));
    expect([...codes].sort()).toEqual([...declared].sort());
  });
});
