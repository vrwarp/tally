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
import type { RuntimeIdentity } from './runtimeIdentity.js';

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

/** A deployment that knows its own identity, as a real one does. */
function identity(overrides: Partial<RuntimeIdentity> = {}): () => Promise<RuntimeIdentity> {
  return async () => ({
    serviceAccount: '481516234-compute@developer.gserviceaccount.com',
    project: 'tally-76406',
    region: 'us-central1',
    service: 'getKioskStatus',
    ...overrides,
  });
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
    const status = await probeSigning(async () => 'a.signed.token', identity());
    expect(status).toEqual({ state: 'ok', problem: null, remedy: null, command: null });
  });

  it('never returns the token it minted', async () => {
    const status = await probeSigning(async () => 'a.signed.token', identity());
    expect(JSON.stringify(status)).not.toContain('a.signed.token');
  });

  it('does not go looking for an identity it has no use for', async () => {
    const describe_ = vi.fn(identity());
    await probeSigning(async () => 'a.signed.token', describe_);
    // Signing works on almost every call, and the metadata server has no part
    // in saying so.
    expect(describe_).not.toHaveBeenCalled();
  });

  it('signs for a uid no real account can hold', async () => {
    const mint = vi.fn(async () => 'a.signed.token');
    await probeSigning(mint, identity());
    expect(mint).toHaveBeenCalledWith(SIGNING_PROBE_UID);
    // An id that cannot arrive through any sign-in method, so a leaked probe
    // token names nobody.
    expect(SIGNING_PROBE_UID).toContain('.invalid');
  });

  it('reports the missing grant with a remedy, and says what breaks', async () => {
    const status = await probeSigning(async () => {
      throw denialError();
    }, identity());
    expect(status.state).toBe('denied');
    expect(status.problem).toContain('hang');
    expect(status.remedy).toContain('roles/iam.serviceAccountTokenCreator');
  });

  it('names the account to grant it on, rather than describing it', async () => {
    const status = await probeSigning(async () => {
      throw denialError();
    }, identity());
    // The whole question a reader is left with: *which* service account.
    expect(status.remedy).toContain('481516234-compute@developer.gserviceaccount.com');
    expect(status.command).toContain(
      'gcloud iam service-accounts add-iam-policy-binding 481516234-compute@developer.gserviceaccount.com',
    );
    expect(status.command).toContain('--project tally-76406');
    // Granted on the account, as its own member — the part that gets done wrong.
    expect(status.command).toContain(
      '--member="serviceAccount:481516234-compute@developer.gserviceaccount.com"',
    );
  });

  it('reads the account out of the refusal when the runtime cannot say', async () => {
    const error = new Error(
      "Permission 'iam.serviceAccounts.signBlob' denied on resource " +
        'projects/-/serviceAccounts/kiosk-signer@tally-76406.iam.gserviceaccount.com',
    );
    const status = await probeSigning(
      async () => {
        throw error;
      },
      identity({ serviceAccount: null }),
    );
    expect(status.remedy).toContain('kiosk-signer@tally-76406.iam.gserviceaccount.com');
    expect(status.command).toContain('kiosk-signer@tally-76406.iam.gserviceaccount.com');
  });

  it('has the reader look the account up when nothing names it', async () => {
    const status = await probeSigning(
      async () => {
        throw denialError();
      },
      identity({ serviceAccount: null, region: 'europe-west1', service: 'getkioskstatus' }),
    );
    expect(status.state).toBe('denied');
    // Never a guessed account: the command asks Google which one it is.
    expect(status.command).toContain(
      'gcloud functions describe getkioskstatus --gen2',
    );
    expect(status.command).toContain('--region europe-west1');
    expect(status.command).toContain('serviceConfig.serviceAccountEmail');
    expect(status.remedy).toContain('could not read which service account');
  });

  it('still writes a command when even the project is unknown', async () => {
    const status = await probeSigning(
      async () => {
        throw denialError();
      },
      identity({ project: null }),
    );
    // A placeholder is honest; a wrong project id in a pasteable command is not.
    expect(status.command).toContain('--project <project-id>');
  });

  it('stays honest about an outage rather than blaming IAM', async () => {
    const status = await probeSigning(async () => {
      throw new Error('ECONNRESET: socket hang up');
    }, identity());
    expect(status.state).toBe('unknown');
    expect(status.remedy).toBeNull();
    expect(status.command).toBeNull();
    expect(status.problem).toContain('ECONNRESET');
  });

  it('caps how much of an unknown failure it repeats onto the screen', async () => {
    const status = await probeSigning(async () => {
      throw new Error('x'.repeat(5_000));
    }, identity());
    expect(status.state).toBe('unknown');
    expect(status.problem!.length).toBeLessThan(300);
  });
});
