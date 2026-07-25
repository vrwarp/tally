/**
 * Configuration reading.
 *
 * `loadConfig()` must never throw. A missing or malformed value is a state the
 * Settings screen has to be able to explain, not a crash that kills the
 * container on every scheduled tick and leaves the core team staring at an
 * empty sync card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
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
