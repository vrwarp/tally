/**
 * The backend registry's judgement calls: who is connected, who is not and
 * why, and where a new student gets pushed.
 *
 * The Attendees adapter is injected through its registration hook, which is
 * exactly how the production package wires itself in — and what lets these
 * tests exercise two-backend states without the real client.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { PATHS } from '../firestore.js';
import { createRegistry, registerA32Backend } from './registry.js';
import type { PeopleBackend } from './types.js';

function env(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

const PCO_ENV = { PCO_APP_ID: 'app-id', PCO_SECRET: 'secret' };
const A32_ENV = {
  A32_TOKEN: 'token',
  A32_API_BASE_URL: 'http://127.0.0.1:4011',
  A32_DIVISION_ID: '1',
  A32_MEET_SLUG: 'the-rock',
  A32_CHARACTER_SLUG: 'junior-student',
};

/** The registry only reads identity and delegates; a stub is a fine backend. */
function fakeA32(): PeopleBackend {
  return { id: 'a32', prefix: 'a32_', displayName: 'Attendees' } as unknown as PeopleBackend;
}

afterEach(() => {
  vi.unstubAllEnvs();
  registerA32Backend(null);
});

describe('createRegistry', () => {
  it('registers Planning Center alone when only it is configured', async () => {
    env(PCO_ENV);
    const registry = await createRegistry(new FakeFirestore());

    expect(registry.ids()).toEqual(['pco']);
    expect(registry.get('pco')).not.toBeNull();
    expect(registry.configErrorOf('pco')).toBeNull();
    expect(registry.get('a32')).toBeNull();
    expect(registry.configErrorOf('a32')).toContain('A32_TOKEN');
  });

  it('registers both when both are configured, Planning Center first', async () => {
    env({ ...PCO_ENV, ...A32_ENV });
    registerA32Backend(fakeA32);
    const registry = await createRegistry(new FakeFirestore());

    expect(registry.ids()).toEqual(['pco', 'a32']);
    expect(registry.get('a32')?.displayName).toBe('Attendees');
  });

  it('runs Attendees-only when Planning Center has no credentials', async () => {
    env(A32_ENV);
    registerA32Backend(fakeA32);
    const registry = await createRegistry(new FakeFirestore());

    expect(registry.ids()).toEqual(['a32']);
    expect(registry.configErrorOf('pco')).toContain('PCO_APP_ID');
  });

  it('treats the overlay switch as off without erasing the configuration', async () => {
    env({ ...PCO_ENV, ...A32_ENV });
    registerA32Backend(fakeA32);
    const db = new FakeFirestore();
    db.seed(PATHS.a32Config, { enabled: false });
    const registry = await createRegistry(db);

    expect(registry.ids()).toEqual(['pco']);
    expect(registry.configErrorOf('a32')).toContain('switched off');
  });

  it('names every missing Attendees value at once', async () => {
    env({ ...PCO_ENV, A32_TOKEN: 'token' });
    registerA32Backend(fakeA32);
    const registry = await createRegistry(new FakeFirestore());

    const problem = registry.configErrorOf('a32') ?? '';
    expect(problem).toContain('A32_API_BASE_URL');
    expect(problem).toContain('A32_DIVISION_ID');
    expect(problem).toContain('A32_MEET_SLUG');
  });

  describe('defaultPush', () => {
    it('defaults to Planning Center, which keeps existing deployments identical', async () => {
      env({ ...PCO_ENV, ...A32_ENV });
      registerA32Backend(fakeA32);
      const registry = await createRegistry(new FakeFirestore());

      expect(registry.defaultPushBackendId).toBe('pco');
      const target = registry.defaultPush();
      expect('backend' in target && target.backend.id).toBe('pco');
    });

    it('honours the configured choice', async () => {
      env({ ...PCO_ENV, ...A32_ENV });
      registerA32Backend(fakeA32);
      const db = new FakeFirestore();
      db.seed(PATHS.backendsConfig, { defaultPushBackend: 'a32' });
      const registry = await createRegistry(db);

      const target = registry.defaultPush();
      expect('backend' in target && target.backend.id).toBe('a32');
    });

    it('answers with the reason when the chosen backend is not connected', async () => {
      env(PCO_ENV);
      const db = new FakeFirestore();
      db.seed(PATHS.backendsConfig, { defaultPushBackend: 'a32' });
      const registry = await createRegistry(db);

      const target = registry.defaultPush();
      expect('error' in target && target.error).toContain('A32_TOKEN');
    });
  });
});
