/**
 * Server-side configuration for the Planning Center integration.
 *
 * Three kinds of input:
 *   - secrets  (Secret Manager) — the Personal Access Token pair. Never
 *                                 editable from the app, never sent to a
 *                                 browser.
 *   - runtime  (Firestore)      — everything else, owned by the core team from
 *                                 Settings: which people count as the roster,
 *                                 how much write-back is allowed, how long a
 *                                 read may be reused.
 *   - params   (deploy-time)    — the same non-secret values, as the defaults a
 *                                 fresh install starts from before anybody has
 *                                 opened Settings.
 *
 * The split used to be two ways: everything non-secret was a deploy-time param,
 * so moving the youth roster onto a different Planning Center list meant a
 * `firebase deploy`. That is a strange thing to ask of a youth pastor in
 * September, and it made the most commonly changed setting the hardest one to
 * change. Now `config/planningCenter` wins wherever it has an opinion and the
 * params are the fallback — which means an install with no document behaves
 * exactly as it did before, and the end-to-end suite can keep configuring
 * itself through the environment.
 *
 * `loadConfig()`/`resolveConfig()` never throw. A missing credential is a
 * *configuration* state, not a crash: a throw here would surface to a counselor
 * as an opaque "internal" error on a screen that has nothing to do with
 * credentials. Instead the config carries `configError`, every entry point
 * checks it first, and the Settings screen can say exactly which value is
 * missing.
 */
import { defineSecret, defineString } from 'firebase-functions/params';
import { PATHS, type FirestoreLike } from './firestore.js';
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
   * True when `config/planningCenter` exists, i.e. somebody has saved these
   * settings from inside the app. Decides where an error message sends them:
   * to Settings, or to whoever runs the deploys.
   */
  managedInApp: boolean;
  /**
   * Human-readable reason the sync cannot run, or null when it can. Callers
   * must check this before constructing a client.
   */
  configError: string | null;
}

/**
 * The non-secret settings, as raw text.
 *
 * Everything is a string regardless of where it came from — a param, an
 * environment variable, or a number in Firestore — so that parsing, clamping
 * and validation happen in exactly one place (`normalizeConfig`) and cannot
 * drift between the two sources.
 */
export interface PcoConfigOverrides {
  baseUrl?: string;
  rosterSource?: string;
  studentListId?: string;
  counselorListId?: string;
  minGrade?: string;
  maxGrade?: string;
  writeBack?: string;
  smallGroupField?: string;
  cacheTtlSeconds?: string;
}

/** Every key a leader may set from Settings. The rules mirror this list. */
export const PCO_CONFIG_KEYS = [
  'baseUrl',
  'rosterSource',
  'studentListId',
  'counselorListId',
  'minGrade',
  'maxGrade',
  'writeBack',
  'smallGroupField',
  'cacheTtlSeconds',
] as const satisfies readonly (keyof PcoConfigOverrides)[];

export type PcoConfigKey = (typeof PCO_CONFIG_KEYS)[number];

interface RawConfig extends Required<PcoConfigOverrides> {
  appId: string;
  secret: string;
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

function readParams(): RawConfig {
  return {
    appId: readValue(PCO_APP_ID, 'PCO_APP_ID'),
    secret: readValue(PCO_SECRET, 'PCO_SECRET'),
    baseUrl: readValue(PCO_API_BASE_URL, 'PCO_API_BASE_URL'),
    rosterSource: readValue(PCO_ROSTER_SOURCE, 'PCO_ROSTER_SOURCE'),
    studentListId: readValue(PCO_STUDENT_LIST_ID, 'PCO_STUDENT_LIST_ID'),
    counselorListId: readValue(PCO_COUNSELOR_LIST_ID, 'PCO_COUNSELOR_LIST_ID'),
    minGrade: readValue(PCO_MIN_GRADE, 'PCO_MIN_GRADE'),
    maxGrade: readValue(PCO_MAX_GRADE, 'PCO_MAX_GRADE'),
    writeBack: readValue(PCO_WRITE_BACK, 'PCO_WRITE_BACK'),
    smallGroupField: readValue(PCO_SMALL_GROUP_FIELD, 'PCO_SMALL_GROUP_FIELD'),
    cacheTtlSeconds: readValue(PCO_CACHE_TTL_SECONDS, 'PCO_CACHE_TTL_SECONDS'),
  };
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
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
function parseBaseUrl(raw: string): { baseUrl: string; overridden: boolean; problem: string | null } {
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

/**
 * Raw text in, usable config out. The single place any of these values is
 * parsed, clamped or rejected, whichever source it arrived from.
 */
function normalizeConfig(raw: RawConfig, managedInApp: boolean): PcoConfig {
  const base = parseBaseUrl(raw.baseUrl.trim());

  const rosterSource: PcoRosterSource = raw.rosterSource.trim().toLowerCase() === 'list' ? 'list' : 'grade';

  const rawWriteBack = raw.writeBack.trim().toLowerCase();
  const writeBack: PcoWriteBackMode =
    rawWriteBack === 'off' || rawWriteBack === 'full' ? rawWriteBack : 'create';

  const minGrade = clamp(
    parseInteger(raw.minGrade, ABSOLUTE_MIN_GRADE),
    ABSOLUTE_MIN_GRADE,
    ABSOLUTE_MAX_GRADE,
  );
  const maxGrade = clamp(parseInteger(raw.maxGrade, ABSOLUTE_MAX_GRADE), minGrade, ABSOLUTE_MAX_GRADE);

  const studentListId = raw.studentListId.trim() || null;
  const counselorListId = raw.counselorListId.trim() || null;
  const smallGroupField = raw.smallGroupField.trim() || null;

  // An unreadable value falls back to the default rather than to zero: silently
  // disabling the cache because of a typo would look like Planning Center got
  // slow, which is a much harder thing to diagnose than a wrong number.
  const cacheTtlSeconds = clamp(
    parseInteger(raw.cacheTtlSeconds, DEFAULT_CACHE_TTL_SECONDS),
    0,
    MAX_CACHE_TTL_SECONDS,
  );

  const problems: string[] = [];
  if (!raw.appId) problems.push('PCO_APP_ID is not set');
  if (!raw.secret) problems.push('PCO_SECRET is not set');
  if (rosterSource === 'list' && !studentListId) {
    // Where somebody is told to go and fix it depends on who owns the value.
    // Naming a deploy-time parameter at a leader who has been editing Settings
    // all afternoon sends them to the wrong person entirely.
    problems.push(
      managedInApp
        ? 'the roster is set to a Planning Center list, but no list is chosen (Settings → Planning Center)'
        : 'PCO_ROSTER_SOURCE is "list" but PCO_STUDENT_LIST_ID is not set',
    );
  }
  if (base.problem) problems.push(base.problem);

  return {
    appId: raw.appId,
    secret: raw.secret,
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
    managedInApp,
    configError:
      problems.length > 0 ? `Planning Center is not configured: ${problems.join('; ')}.` : null,
  };
}

/**
 * Configuration from deploy-time params and the environment only.
 *
 * This is what a fresh install runs on, and what the end-to-end suite drives
 * through `PCO_*` environment variables. Prefer `resolveConfig` anywhere a
 * Firestore handle is available — it layers whatever the core team has saved on
 * top of this.
 */
export function loadConfig(): PcoConfig {
  return normalizeConfig(readParams(), false);
}

/* -------------------------------------------------------------------------- */
/* Runtime overrides                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Reads one override off the saved document.
 *
 * A key that is *absent* means "no opinion", and the deploy-time param shows
 * through. A key that is present but empty means "cleared", which is how a
 * leader removes the counselor list without a deploy. The distinction is why
 * this returns `undefined` rather than `''` for a missing key.
 *
 * Numbers are accepted alongside strings because the grade band and the cache
 * TTL are natural to store as numbers, and a document written by hand in the
 * Firebase console should not behave differently from one the app wrote.
 */
function readOverride(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function overridesFromDocument(data: Record<string, unknown> | undefined): PcoConfigOverrides {
  const overrides: PcoConfigOverrides = {};
  if (!data) return overrides;

  for (const key of PCO_CONFIG_KEYS) {
    const value = readOverride(data[key]);
    if (value === undefined) continue;

    /*
     * `baseUrl` is the one field where empty means "no override" rather than
     * "cleared".
     *
     * Everywhere else, clearing is a real intent — a church removing its
     * counselor list wants no counselor list. Here, "cleared" would mean
     * *the real Planning Center*, which would quietly undo a deployed proxy or
     * point a test rig at production the first time somebody saved an unrelated
     * setting. An empty override falls back to the deployed value, which is
     * also how the parameter's own empty default behaves.
     */
    if (key === 'baseUrl' && value === '') continue;

    overrides[key] = value;
  }
  return overrides;
}

/**
 * The effective configuration: deploy-time params with the core team's saved
 * settings layered over them.
 *
 * The Firestore read is deliberately not cached. It is one document read on a
 * path that already does at least one (the caller's `users/{uid}` role check),
 * and the alternative — a memo with its own TTL — means a leader who has just
 * changed the roster list watches an old one come back and reasonably concludes
 * the save did not work.
 *
 * A failed read falls back to the params rather than to an error. Firestore
 * being briefly unavailable should degrade Tally to "the configuration it was
 * deployed with", not to "no check-in tonight".
 */
export async function resolveConfig(db: FirestoreLike): Promise<PcoConfig> {
  const params = readParams();

  let data: Record<string, unknown> | undefined;
  try {
    const snapshot = await db.doc(PATHS.pcoConfig).get();
    data = snapshot.exists ? snapshot.data() : undefined;
  } catch {
    return normalizeConfig(params, false);
  }

  if (!data) return normalizeConfig(params, false);
  return normalizeConfig({ ...params, ...overridesFromDocument(data) }, true);
}
