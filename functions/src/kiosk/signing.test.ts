/**
 * The signing probe, which exists to make one invisible IAM grant visible.
 *
 * The cases that matter are the two ways of being wrong: calling a real refusal
 * something else (the grant stays missing and pairing keeps hanging), and
 * calling an unrelated outage a missing grant (someone is sent to edit IAM over
 * a network blip). Everything here is about keeping those apart.
 */
import { describe, expect, it, vi } from 'vitest';
import { isSigningDenial, probeSigning, SIGNING_PROBE_UID } from './signing.js';

/** What the Admin SDK actually throws when the grant is missing. */
function denialError(): Error {
  const error = new Error(
    'error:0909006C:PEM routines:get_name:no start line; Failed to sign custom token: ' +
      'Permission \'iam.serviceAccounts.signBlob\' denied on resource ' +
      '(or it may not exist).',
  );
  (error as { code?: string }).code = 'auth/internal-error';
  return error;
}

describe('isSigningDenial', () => {
  it('recognises the signBlob refusal', () => {
    expect(isSigningDenial(denialError())).toBe(true);
  });

  it('recognises a refusal that names only the role', () => {
    expect(
      isSigningDenial(new Error('caller lacks roles/iam.serviceAccountTokenCreator')),
    ).toBe(true);
  });

  it('recognises a refusal carried on the error code alone', () => {
    const error = new Error('An internal error occurred.');
    (error as { code?: string }).code = 'auth/insufficient-permission';
    expect(isSigningDenial(error)).toBe(true);
  });

  it('reads the wrapped cause, where the SDK often puts the IAM detail', () => {
    const error = new Error('Failed to determine service account.', {
      cause: new Error("Permission 'iam.serviceAccounts.signBlob' denied"),
    });
    expect(isSigningDenial(error)).toBe(true);
  });

  it('does not mistake an ordinary outage for a missing grant', () => {
    expect(isSigningDenial(new Error('ECONNRESET: socket hang up'))).toBe(false);
    expect(isSigningDenial(new Error('Deadline exceeded'))).toBe(false);
  });
});

describe('probeSigning', () => {
  it('reports ok when a token can be signed', async () => {
    const status = await probeSigning(async () => 'a.signed.token');
    expect(status).toEqual({ state: 'ok', problem: null, remedy: null });
  });

  it('never returns the token it minted', async () => {
    const status = await probeSigning(async () => 'a.signed.token');
    expect(JSON.stringify(status)).not.toContain('a.signed.token');
  });

  it('signs for a uid no real account can hold', async () => {
    const mint = vi.fn(async () => 'a.signed.token');
    await probeSigning(mint);
    expect(mint).toHaveBeenCalledWith(SIGNING_PROBE_UID);
    // An id that cannot arrive through any sign-in method, so a leaked probe
    // token names nobody.
    expect(SIGNING_PROBE_UID).toContain('.invalid');
  });

  it('reports the missing grant with a remedy, and says what breaks', async () => {
    const status = await probeSigning(async () => {
      throw denialError();
    });
    expect(status.state).toBe('denied');
    expect(status.problem).toContain('hang');
    expect(status.remedy).toContain('roles/iam.serviceAccountTokenCreator');
  });

  it('stays honest about an outage rather than blaming IAM', async () => {
    const status = await probeSigning(async () => {
      throw new Error('ECONNRESET: socket hang up');
    });
    expect(status.state).toBe('unknown');
    expect(status.remedy).toBeNull();
    expect(status.problem).toContain('ECONNRESET');
  });

  it('caps how much of an unknown failure it repeats onto the screen', async () => {
    const status = await probeSigning(async () => {
      throw new Error('x'.repeat(5_000));
    });
    expect(status.state).toBe('unknown');
    expect(status.problem!.length).toBeLessThan(300);
  });
});
