/**
 * Reading the runtime's own identity.
 *
 * Two things matter here, and they pull in opposite directions: the answer has
 * to be right when there *is* a metadata server (a wrong account in a pasteable
 * IAM command is worse than no account), and asking must be harmless when there
 * is not — an emulator, a laptop, this test file. Everything below is one or
 * the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectId, readRuntimeIdentity } from './runtimeIdentity.js';

const EMAIL_PATH = 'instance/service-accounts/default/email';

/** A metadata server that answers the paths it knows and 404s the rest. */
function metadataServer(answers: Record<string, string>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    // The header is what makes it a metadata request; without it the real
    // server refuses, so sending it is part of being correct here.
    expect((init?.headers as Record<string, string>)['Metadata-Flavor']).toBe('Google');
    const path = Object.keys(answers).find((key) => url.endsWith(key));
    return path
      ? new Response(`${answers[path]}\n`)
      : new Response('not found', { status: 404 });
  });
}

const ENV_KEYS = ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_CONFIG', 'K_SERVICE',
  'FUNCTION_IDENTITY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

describe('projectId', () => {
  it('prefers the plain environment variable', () => {
    process.env.GCLOUD_PROJECT = 'tally-76406';
    expect(projectId()).toBe('tally-76406');
  });

  it('falls back to the Firebase config blob the runtime injects', () => {
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'tally-76406' });
    expect(projectId()).toBe('tally-76406');
  });

  it('says nothing rather than something wrong when it cannot tell', () => {
    process.env.FIREBASE_CONFIG = 'not json';
    expect(projectId()).toBeNull();
  });
});

describe('readRuntimeIdentity', () => {
  it('reads the account and region a deploy actually runs with', async () => {
    process.env.GCLOUD_PROJECT = 'tally-76406';
    process.env.K_SERVICE = 'getkioskstatus';
    vi.stubGlobal(
      'fetch',
      metadataServer({
        [EMAIL_PATH]: '481516234-compute@developer.gserviceaccount.com',
        'instance/region': 'projects/481516234/regions/europe-west1',
      }),
    );

    expect(await readRuntimeIdentity()).toEqual({
      serviceAccount: '481516234-compute@developer.gserviceaccount.com',
      project: 'tally-76406',
      region: 'europe-west1',
      service: 'getkioskstatus',
    });
  });

  it('takes 1st-gen’s environment variable when there is no metadata server', async () => {
    process.env.FUNCTION_IDENTITY = 'kiosk-signer@tally-76406.iam.gserviceaccount.com';
    vi.stubGlobal('fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND metadata.google.internal');
    });

    const identity = await readRuntimeIdentity();
    expect(identity.serviceAccount).toBe('kiosk-signer@tally-76406.iam.gserviceaccount.com');
  });

  it('answers without an account rather than failing, off a real deploy', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND metadata.google.internal');
    });

    const identity = await readRuntimeIdentity();
    expect(identity.serviceAccount).toBeNull();
    // The pieces that do not need the metadata server still have to be usable:
    // they are what the fallback command is written from.
    expect(identity.region).toBe('us-central1');
    expect(identity.service).toBe('getKioskStatus');
  });
});
