/**
 * Configuration reading.
 *
 * `loadConfig()` must never throw. A missing or malformed value is a state the
 * Settings screen has to be able to explain, not a crash that kills the
 * container on every request and leaves the core team staring at an
 * empty sync card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, resolveConfig } from './config.js';
import { FakeFirestore } from './testing/fakeFirestore.js';
import { PATHS } from './firestore.js';
import { PCO_BASE_URL } from './pco/types.js';

/** Params fall back to `process.env`, which is what the emulator populates. */
function env(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

const CREDENTIALS = { PCO_APP_ID: 'app-id', PCO_SECRET: 'secret' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadConfig', () => {
  describe('API base URL', () => {
    it('defaults to the real Planning Center and reports no override', () => {
      env(CREDENTIALS);
      const config = loadConfig();

      expect(config.baseUrl).toBe(PCO_BASE_URL);
      expect(config.baseUrlOverridden).toBe(false);
      expect(config.configError).toBeNull();
    });

    it('accepts an override and flags it', () => {
      env({ ...CREDENTIALS, PCO_API_BASE_URL: 'http://127.0.0.1:4010/people/v2' });
      const config = loadConfig();

      expect(config.baseUrl).toBe('http://127.0.0.1:4010/people/v2');
      // The flag is what stops a test rig being mistaken for production.
      expect(config.baseUrlOverridden).toBe(true);
      expect(config.configError).toBeNull();
    });

    it('strips trailing slashes so paths do not double up', () => {
      env({ ...CREDENTIALS, PCO_API_BASE_URL: 'https://proxy.example.org/people/v2///' });
      expect(loadConfig().baseUrl).toBe('https://proxy.example.org/people/v2');
    });

    it('rejects a value that is not a URL and says so', () => {
      env({ ...CREDENTIALS, PCO_API_BASE_URL: 'not a url' });
      const config = loadConfig();

      // Falling back to the real API rather than half-configuring one: a
      // relative path would fail much later with an opaque `Invalid URL`.
      expect(config.baseUrl).toBe(PCO_BASE_URL);
      expect(config.baseUrlOverridden).toBe(false);
      expect(config.configError).toContain('PCO_API_BASE_URL');
    });

    it('rejects a non-http scheme', () => {
      env({ ...CREDENTIALS, PCO_API_BASE_URL: 'ftp://files.example.org/people' });
      const config = loadConfig();

      expect(config.baseUrl).toBe(PCO_BASE_URL);
      expect(config.configError).toMatch(/http or https/i);
    });
  });

  describe('credentials', () => {
    it('names both missing values instead of failing on the first', () => {
      env({ PCO_APP_ID: '', PCO_SECRET: '' });
      const config = loadConfig();

      expect(config.configError).toContain('PCO_APP_ID');
      expect(config.configError).toContain('PCO_SECRET');
    });

    it('never throws, whatever the environment holds', () => {
      env({ PCO_MIN_GRADE: 'banana', PCO_MAX_GRADE: '', PCO_WRITE_BACK: 'sideways' });
      expect(() => loadConfig()).not.toThrow();
    });

    it('trims surrounding whitespace off a pasted token', () => {
      env({ PCO_APP_ID: '  app-id  ', PCO_SECRET: '\tsecret\n' });
      const config = loadConfig();

      expect(config.appId).toBe('app-id');
      expect(config.secret).toBe('secret');
      expect(config.configError).toBeNull();
    });
  });

  describe('grade band', () => {
    it('clamps a band wider than the ministry into 6-12', () => {
      env({ ...CREDENTIALS, PCO_MIN_GRADE: '1', PCO_MAX_GRADE: '99' });
      const config = loadConfig();

      expect(config.minGrade).toBe(6);
      expect(config.maxGrade).toBe(12);
    });

    it('never lets the maximum fall below the minimum', () => {
      env({ ...CREDENTIALS, PCO_MIN_GRADE: '9', PCO_MAX_GRADE: '7' });
      const config = loadConfig();

      expect(config.minGrade).toBe(9);
      expect(config.maxGrade).toBeGreaterThanOrEqual(config.minGrade);
    });

    it('falls back to the full band on unparseable input', () => {
      env({ ...CREDENTIALS, PCO_MIN_GRADE: 'six' });
      expect(loadConfig().minGrade).toBe(6);
    });
  });

  describe('roster source', () => {
    it('defaults to grade mode', () => {
      env(CREDENTIALS);
      expect(loadConfig().rosterSource).toBe('grade');
    });

    it('treats an unrecognised value as grade rather than guessing', () => {
      env({ ...CREDENTIALS, PCO_ROSTER_SOURCE: 'spreadsheet' });
      expect(loadConfig().rosterSource).toBe('grade');
    });

    it('reports list mode with no list id as a configuration error', () => {
      env({ ...CREDENTIALS, PCO_ROSTER_SOURCE: 'list' });
      const config = loadConfig();

      expect(config.rosterSource).toBe('list');
      expect(config.configError).toContain('PCO_STUDENT_LIST_ID');
    });

    it('is happy with list mode once the list is named', () => {
      env({ ...CREDENTIALS, PCO_ROSTER_SOURCE: 'list', PCO_STUDENT_LIST_ID: 'L1' });
      const config = loadConfig();

      expect(config.studentListId).toBe('L1');
      expect(config.configError).toBeNull();
    });
  });

  describe('cache TTL', () => {
    it('defaults to half a minute', () => {
      expect(loadConfig().cacheTtlSeconds).toBe(30);
    });

    it('accepts zero, which turns retention off', () => {
      // Not a degenerate case to be defended against — a supported way to run.
      // Tally works with no cache at all; it just asks every time.
      process.env.PCO_CACHE_TTL_SECONDS = '0';
      expect(loadConfig().cacheTtlSeconds).toBe(0);
    });

    it('refuses to hold people for longer than a cache should', () => {
      // Past a couple of minutes this stops being a cache and starts being the
      // mirror this design exists to remove.
      process.env.PCO_CACHE_TTL_SECONDS = '86400';
      expect(loadConfig().cacheTtlSeconds).toBe(300);
    });

    it('never goes negative', () => {
      process.env.PCO_CACHE_TTL_SECONDS = '-60';
      expect(loadConfig().cacheTtlSeconds).toBe(0);
    });

    it('falls back to the default rather than to zero on a typo', () => {
      // Silently disabling the cache because somebody wrote "thirty" would look
      // like Planning Center got slow, which is far harder to diagnose than a
      // wrong number.
      process.env.PCO_CACHE_TTL_SECONDS = 'thirty';
      expect(loadConfig().cacheTtlSeconds).toBe(30);
    });

    it('is not a reason to refuse to start', () => {
      // An unusable TTL has a sane fallback, so it never joins the list of
      // things that stop Tally talking to Planning Center at all.
      process.env.PCO_CACHE_TTL_SECONDS = 'nonsense';
      expect(loadConfig().configError ?? '').not.toMatch(/cache/i);
    });
  });

  describe('write-back', () => {
    it('defaults to create-only', () => {
      env(CREDENTIALS);
      expect(loadConfig().writeBack).toBe('create');
    });

    it.each(['off', 'full'] as const)('honours %s', (mode) => {
      env({ ...CREDENTIALS, PCO_WRITE_BACK: mode });
      expect(loadConfig().writeBack).toBe(mode);
    });

    it('falls back to create on an unrecognised mode', () => {
      // Never silently escalate to `full`: that would let a typo start editing
      // the church's real database.
      env({ ...CREDENTIALS, PCO_WRITE_BACK: 'everything' });
      expect(loadConfig().writeBack).toBe('create');
    });
  });

  it('accumulates every problem rather than stopping at the first', () => {
    env({ PCO_ROSTER_SOURCE: 'list', PCO_API_BASE_URL: 'nope' });
    const error = loadConfig().configError ?? '';

    expect(error).toContain('PCO_APP_ID');
    expect(error).toContain('PCO_SECRET');
    expect(error).toContain('PCO_STUDENT_LIST_ID');
    expect(error).toContain('PCO_API_BASE_URL');
  });
});

/* -------------------------------------------------------------------------- */
/* Runtime overrides                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the core team saves in Settings has to win over what was deployed —
 * that is the entire point of the document — without ever becoming a way to
 * put the server into a state the deploy-time path could not reach.
 */
describe('resolveConfig', () => {
  function withDocument(fields: Record<string, unknown> | null): FakeFirestore {
    const db = new FakeFirestore();
    if (fields) db.seed(PATHS.pcoConfig, fields);
    return db;
  }

  it('falls back to the deployed parameters when nothing has been saved', async () => {
    env({ ...CREDENTIALS, PCO_ROSTER_SOURCE: 'list', PCO_STUDENT_LIST_ID: 'deployed' });
    const config = await resolveConfig(withDocument(null));

    expect(config.studentListId).toBe('deployed');
    expect(config.managedInApp).toBe(false);
  });

  it('lets a saved list win over the deployed one', async () => {
    env({ ...CREDENTIALS, PCO_ROSTER_SOURCE: 'list', PCO_STUDENT_LIST_ID: 'deployed' });
    const config = await resolveConfig(withDocument({ studentListId: 'chosen-in-app' }));

    expect(config.studentListId).toBe('chosen-in-app');
    expect(config.managedInApp).toBe(true);
  });

  it('treats an absent key as no opinion and an empty one as cleared', async () => {
    // The two have to be distinguishable, or there is no way to *remove* a
    // counselor list from Settings — only to overwrite it with another one.
    env({ ...CREDENTIALS, PCO_COUNSELOR_LIST_ID: 'deployed', PCO_SMALL_GROUP_FIELD: 'Small Group' });
    const config = await resolveConfig(withDocument({ counselorListId: '' }));

    expect(config.counselorListId).toBeNull();
    expect(config.smallGroupField).toBe('Small Group');
  });

  it('accepts numbers, so a document written by hand behaves the same', async () => {
    env(CREDENTIALS);
    const config = await resolveConfig(withDocument({ minGrade: 7, maxGrade: 9, cacheTtlSeconds: 0 }));

    expect(config.minGrade).toBe(7);
    expect(config.maxGrade).toBe(9);
    expect(config.cacheTtlSeconds).toBe(0);
  });

  it('clamps saved values exactly as it clamps deployed ones', async () => {
    // The document is client-written, so this is not politeness — it is the
    // guarantee that no browser can widen the grade band past what the app's
    // own `Grade` type admits, whatever the rules let through.
    env(CREDENTIALS);
    const config = await resolveConfig(
      withDocument({ minGrade: 1, maxGrade: 99, cacheTtlSeconds: 86_400, writeBack: 'everything' }),
    );

    expect(config.minGrade).toBe(6);
    expect(config.maxGrade).toBe(12);
    expect(config.cacheTtlSeconds).toBe(300);
    // Never silently escalate: an unrecognised mode must not become `full`.
    expect(config.writeBack).toBe('create');
  });

  it('ignores fields it does not know and values of the wrong type', async () => {
    env({ ...CREDENTIALS, PCO_WRITE_BACK: 'off' });
    const config = await resolveConfig(
      withDocument({ writeBack: { mode: 'full' }, appId: 'stolen', secret: 'stolen', nonsense: true }),
    );

    expect(config.writeBack).toBe('off');
    // Credentials come from Secret Manager and from nowhere else. A document
    // that names them changes nothing.
    expect(config.appId).toBe('app-id');
    expect(config.secret).toBe('secret');
  });

  it('treats an empty API address as no override rather than as a reset', async () => {
    /*
     * The one field where "cleared" would be dangerous rather than useful.
     *
     * The app writes every field on save, including the ones a core-team member
     * cannot see. If an empty `baseUrl` meant "use the real Planning Center",
     * then the first time anybody saved an unrelated setting, an install
     * deployed against a proxy — or the end-to-end suite's simulator — would
     * silently start talking to production instead.
     */
    env({ ...CREDENTIALS, PCO_API_BASE_URL: 'http://127.0.0.1:4010/people/v2' });
    const config = await resolveConfig(withDocument({ baseUrl: '', studentListId: 'L1' }));

    expect(config.baseUrl).toBe('http://127.0.0.1:4010/people/v2');
    expect(config.baseUrlOverridden).toBe(true);
  });

  it('lets a saved API address win over the deployed one', async () => {
    env({ ...CREDENTIALS, PCO_API_BASE_URL: 'http://127.0.0.1:4010/people/v2' });
    const config = await resolveConfig(withDocument({ baseUrl: 'https://proxy.example.org/people/v2' }));

    expect(config.baseUrl).toBe('https://proxy.example.org/people/v2');
  });

  it('points at Settings, not at a deploy parameter, once the app owns the config', async () => {
    env(CREDENTIALS);
    const config = await resolveConfig(withDocument({ rosterSource: 'list', studentListId: '' }));

    expect(config.configError).toMatch(/Settings/);
    expect(config.configError).not.toMatch(/PCO_STUDENT_LIST_ID/);
  });

  it('degrades to the deployed configuration when Firestore cannot be read', async () => {
    // A Firestore blip should cost Tally its *newest* configuration, not its
    // ability to run check-in tonight.
    env({ ...CREDENTIALS, PCO_ROSTER_SOURCE: 'list', PCO_STUDENT_LIST_ID: 'deployed' });
    const broken = {
      doc: () => ({
        get: () => Promise.reject(new Error('Firestore is having a minute')),
      }),
    } as unknown as FakeFirestore;

    const config = await resolveConfig(broken);
    expect(config.studentListId).toBe('deployed');
    expect(config.configError).toBeNull();
  });
});
