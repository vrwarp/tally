/**
 * Server-side configuration for the Planning Center integration.
 *
 * Two kinds of input, both from `firebase-functions/params`:
 *   - secrets  (Secret Manager) — the Personal Access Token pair.
 *   - params   (deploy-time)    — which people count as the roster, how much
 *                                 write-back is allowed, how long a read may be
 *                                 reused.
 *
 * `loadConfig()` never throws. A missing credential is a *configuration* state,
 * not a crash: a throw here would surface to a counselor as an opaque "internal"
 * error on a screen that has nothing to do with credentials. Instead the config
 * carries `configError`, every entry point checks it first, and the Settings
 * screen can say exactly which value is missing.
 */
import { defineSecret, defineString } from 'firebase-functions/params';
import { PCO_BASE_URL } from './pco/types.js';

/** Mirrors `PcoRosterSource` in src/types — duplicated because Cloud Functions
 * compile as a separate package and must not import from the browser bundle. */
export type PcoRosterSource = 'list' | 'grade';

/** Mirrors `PcoWriteBackMode` in src/types. */
export type PcoWriteBackMode = 'off' | 'create' | 'full';

/* -------------------------------------------------------------------------- */
/* Declarations                                                                */
/* -------------------------------------------------------------------------- */

export const PCO_APP_ID = defineSecret('PCO_APP_ID');
export const PCO_SECRET = defineSecret('PCO_SECRET');

/**
 * Where the Planning Center API lives.
 *
 * Configurable because production is not the only place this code runs: the
 * end-to-end suite points it at a local Planning Center simulator, and a church
 * behind an outbound proxy may need to route through their own host. Anything
 * that is not the real API is a deliberate act, so `loadConfig` reports the
 * override rather than letting it pass silently.
 */
const PCO_API_BASE_URL = defineString('PCO_API_BASE_URL', { default: '' });

const PCO_ROSTER_SOURCE = defineString('PCO_ROSTER_SOURCE', { default: 'grade' });
const PCO_STUDENT_LIST_ID = defineString('PCO_STUDENT_LIST_ID', { default: '' });
const PCO_COUNSELOR_LIST_ID = defineString('PCO_COUNSELOR_LIST_ID', { default: '' });
const PCO_MIN_GRADE = defineString('PCO_MIN_GRADE', { default: '6' });
const PCO_MAX_GRADE = defineString('PCO_MAX_GRADE', { default: '12' });
const PCO_WRITE_BACK = defineString('PCO_WRITE_BACK', { default: 'create' });
const PCO_SMALL_GROUP_FIELD = defineString('PCO_SMALL_GROUP_FIELD', { default: '' });

/**
 * How long a Planning Center read may be reused, in seconds.
 *
 * Tally holds no copy of the church's people: every roster and every profile is
 * read from Planning Center when it is needed. This is the only thing standing
 * between that design and eight identical roster pulls when eight counselors
 * open the app in the same minute.
 *
 * `0` turns retention off entirely, which is a supported way to run — the app
 * works, it just asks every time. The ceiling is deliberately low: a cache
 * measured in minutes would be a mirror again, and a name corrected in Planning
 * Center should show up on the next tap.
 */
const PCO_CACHE_TTL_SECONDS = defineString('PCO_CACHE_TTL_SECONDS', { default: '30' });

export const DEFAULT_CACHE_TTL_SECONDS = 30;
/** Beyond a couple of minutes this stops being a cache and starts being state. */
export const MAX_CACHE_TTL_SECONDS = 300;

/** Attach to every function that talks to Planning Center. */
export const PCO_SECRETS = [PCO_APP_ID, PCO_SECRET];

/**
 * Grades Tally understands at all (`Grade` in src/types is 6..12). The
 * configured band is clamped into this, so a typo cannot produce a student the
 * client-side converter would silently rewrite to 6.
 */
export const ABSOLUTE_MIN_GRADE = 6;
export const ABSOLUTE_MAX_GRADE = 12;

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export interface PcoConfig {
  appId: string;
  secret: string;
  /** API root, without a trailing slash. Defaults to the real Planning Center. */
  baseUrl: string;
  /** True when `baseUrl` was overridden — surfaced so a test rig is never mistaken for production. */
  baseUrlOverridden: boolean;
  rosterSource: PcoRosterSource;
  studentListId: string | null;
  counselorListId: string | null;
  minGrade: number;
  maxGrade: number;
  writeBack: PcoWriteBackMode;
  /**
   * Seconds a Planning Center read may be reused. `0` means no retention at
   * all — every request goes upstream.
   */
  cacheTtlSeconds: number;
  /** Name or slug of the custom field holding a small-group name, if any. */
  smallGroupField: string | null;
  /**
   * Human-readable reason the sync cannot run, or null when it can. Callers
   * must check this before constructing a client.
   */
  configError: string | null;
}

/**
 * `defineSecret(...).value()` throws when the secret is not bound to the running
 * function (analysis passes, unit tests, a misconfigured deploy). Params fall
 * back to `process.env` themselves, but secrets do not, so every read goes
 * through here and degrades to the environment.
 */
function readValue(param: { value: () => string }, envKey: string): string {
  try {
    const value = param.value();
    if (value) return value.trim();
  } catch {
    // Not bound in this context — fall through to the environment.
  }
  return (process.env[envKey] ?? '').trim();
}

function readInt(param: { value: () => string }, envKey: string, fallback: number): number {
  const parsed = Number.parseInt(readValue(param, envKey), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalises an API root and rejects anything that is not an absolute http(s)
 * URL. A typo here would otherwise turn every request into a relative path and
 * fail with a confusing `Invalid URL` deep inside the client.
 */
function readBaseUrl(): { baseUrl: string; overridden: boolean; problem: string | null } {
  const raw = readValue(PCO_API_BASE_URL, 'PCO_API_BASE_URL');
  if (!raw) return { baseUrl: PCO_BASE_URL, overridden: false, problem: null };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      baseUrl: PCO_BASE_URL,
      overridden: false,
      problem: `PCO_API_BASE_URL="${raw}" is not a valid URL`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      baseUrl: PCO_BASE_URL,
      overridden: false,
      problem: `PCO_API_BASE_URL="${raw}" must be http or https`,
    };
  }

  return { baseUrl: raw.replace(/\/+$/, ''), overridden: true, problem: null };
}

export function loadConfig(): PcoConfig {
  const appId = readValue(PCO_APP_ID, 'PCO_APP_ID');
  const secret = readValue(PCO_SECRET, 'PCO_SECRET');
  const base = readBaseUrl();

  const rawSource = readValue(PCO_ROSTER_SOURCE, 'PCO_ROSTER_SOURCE').toLowerCase();
  const rosterSource: PcoRosterSource = rawSource === 'list' ? 'list' : 'grade';

  const rawWriteBack = readValue(PCO_WRITE_BACK, 'PCO_WRITE_BACK').toLowerCase();
  const writeBack: PcoWriteBackMode =
    rawWriteBack === 'off' || rawWriteBack === 'full' ? rawWriteBack : 'create';

  const minGrade = clamp(
    readInt(PCO_MIN_GRADE, 'PCO_MIN_GRADE', ABSOLUTE_MIN_GRADE),
    ABSOLUTE_MIN_GRADE,
    ABSOLUTE_MAX_GRADE,
  );
  const maxGrade = clamp(
    readInt(PCO_MAX_GRADE, 'PCO_MAX_GRADE', ABSOLUTE_MAX_GRADE),
    minGrade,
    ABSOLUTE_MAX_GRADE,
  );

  const studentListId = readValue(PCO_STUDENT_LIST_ID, 'PCO_STUDENT_LIST_ID') || null;
  const counselorListId = readValue(PCO_COUNSELOR_LIST_ID, 'PCO_COUNSELOR_LIST_ID') || null;
  const smallGroupField = readValue(PCO_SMALL_GROUP_FIELD, 'PCO_SMALL_GROUP_FIELD') || null;

  // An unreadable value falls back to the default rather than to zero: silently
  // disabling the cache because of a typo would look like Planning Center got
  // slow, which is a much harder thing to diagnose than a wrong number.
  const cacheTtlSeconds = clamp(
    readInt(PCO_CACHE_TTL_SECONDS, 'PCO_CACHE_TTL_SECONDS', DEFAULT_CACHE_TTL_SECONDS),
    0,
    MAX_CACHE_TTL_SECONDS,
  );

  const problems: string[] = [];
  if (!appId) problems.push('PCO_APP_ID is not set');
  if (!secret) problems.push('PCO_SECRET is not set');
  if (rosterSource === 'list' && !studentListId) {
    problems.push('PCO_ROSTER_SOURCE is "list" but PCO_STUDENT_LIST_ID is not set');
  }
  if (base.problem) problems.push(base.problem);

  return {
    appId,
    secret,
    baseUrl: base.baseUrl,
    baseUrlOverridden: base.overridden,
    rosterSource,
    studentListId,
    counselorListId,
    minGrade,
    maxGrade,
    writeBack,
    cacheTtlSeconds,
    smallGroupField,
    configError: problems.length > 0 ? `Planning Center is not configured: ${problems.join('; ')}.` : null,
  };
}
