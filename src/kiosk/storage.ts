/**
 * The kiosk's localStorage, in one place.
 *
 * Every key is namespaced `tally:kiosk:` — the kiosk shares an origin with the
 * main app, and must never collide with `tally:roster` or `tally:theme`.
 * Reads parse defensively and answer null for anything malformed: a kiosk that
 * throws on a corrupt cache entry is a kiosk somebody has to drive out and
 * reboot.
 */
import { asGrade } from '@/types';
import type { KioskStudent } from './search';

export const KIOSK_KEYS = {
  binding: 'tally:kiosk:binding',
  roster: 'tally:kiosk:roster',
  phoneIndex: 'tally:kiosk:phoneIndex',
  /**
   * Who belongs to the gathering this kiosk is bound to — the scoped search and
   * the pre-ticked siblings. Cached whole rather than per chain: it is one small
   * document, and a kiosk moved to a different gathering must not have to go
   * back to the network before it can find anybody.
   */
  participation: 'tally:kiosk:participation',
  /**
   * The last pulse revisions this kiosk acted on — see `fetchPulse` in
   * services. On disk so that a reboot compares against what this kiosk last
   * saw: a change that happened while it was powered off is caught on the
   * first poll instead of waiting out a cache TTL.
   */
  pulse: 'tally:kiosk:pulse',
  pending: 'tally:kiosk:pending',
  pairing: 'tally:kiosk:pairing',
  /**
   * The label printer attached to *this* device: model and loaded media.
   *
   * Deliberately not on the event, and deliberately not in Firestore. Which
   * roll is loaded is a fact about the machine in this lobby — see
   * `lib/labelTemplate.ts` — and this key is also what tells the kiosk whether
   * to load the printing module at all, so a kiosk with no printer never parses
   * a byte of it.
   */
  printer: 'tally:kiosk:printer',
  /**
   * What has happened to that printer lately — see `printing/log.ts`.
   *
   * A bounded ring of events with no names in it, kept across the nightly
   * reload on purpose: the reload is one of the things it exists to explain,
   * and the question it answers — "why did the kiosk say the printer was
   * unplugged?" — is asked the morning after.
   */
  printerLog: 'tally:kiosk:printerLog',
} as const;

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    // Stryker disable next-line ConditionalExpression: nothing observable turns
    // on this. A missing key is `null`, which `JSON.parse` coerces to the string
    // "null" and answers `null` for; an empty one throws into the catch, which
    // answers `null` too. It is here to say what the empty cases mean.
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked. The kiosk keeps working from memory; the cache
    // is a warm-start convenience, never the source of truth.
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same posture as writeJson.
  }
}

/* -------------------------------------------------------------------------- */
/* The roster cache                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shape version of the cached roster. Bump it when a *row* gains a field the
 * kiosk relies on being there.
 *
 * Every other cache in here degrades safely when it is stale — a missing student
 * is a search that finds nobody, and the refresh behind the screen fixes it. The
 * allergy flag is the first field where "absent" and "false" are different
 * claims and only one of them is safe: a roster cached before this version has
 * no `hasAllergies`, and reading that as "no allergy" would print a clean label
 * for a child with a peanut allergy for as long as the cache lasts. So a cache
 * from a previous shape is ignored outright rather than half-trusted. The screen
 * still paints instantly — `KioskApp` seeds from this same reader and the
 * network copy lands a moment later — it simply paints an empty roster once,
 * after a deploy, instead of a confidently wrong one.
 */
export const KIOSK_ROSTER_VERSION = 2;

export interface CachedRoster {
  version?: number;
  fetchedAtMs: number;
  students: KioskStudent[];
}

/** The cached roster, or null when there is none this build can trust. */
export function readCachedRoster(): CachedRoster | null {
  const stored = readCachedRosterOfAnyVersion();
  return stored && stored.version === KIOSK_ROSTER_VERSION ? stored : null;
}

/**
 * The cached roster whatever shape it is in — for when the network has failed
 * and the choice is between an old copy and nothing.
 *
 * Nothing is the worse answer. A kiosk that rebooted into a new build with the
 * hallway switch unplugged would otherwise have an empty search box and no way
 * to check anybody in, which is a far bigger failure than the one the version
 * gate exists to prevent. The rows are still names and grades; what they may
 * lack is the allergy flag, and a missing flag reads as "print no allergy line"
 * — exactly what every label did before the token existed. It is never read as
 * a positive "this child has nothing on file" while a fresh copy is reachable,
 * because `readCachedRoster` above refuses it first.
 */
export function readCachedRosterOfAnyVersion(): CachedRoster | null {
  const stored = readJson<CachedRoster>(KIOSK_KEYS.roster);
  if (!stored || !Array.isArray(stored.students) || stored.students.length === 0) return null;
  /*
   * The grade is re-checked on the way out, because a cache is the one input
   * that can be older than the code reading it. A build before `asGrade` wrote
   * whatever the backend offered, including the `-1` a graduation year derives
   * for a child not yet in school — and this is the copy the screen paints from
   * at boot, before any network read lands, and the only copy it has at all
   * when the hallway switch is unplugged.
   */
  const students = stored.students.map((student) => ({ ...student, grade: asGrade(student.grade) }));
  return { ...stored, students };
}

export function writeCachedRoster(students: KioskStudent[]): void {
  writeJson(KIOSK_KEYS.roster, {
    version: KIOSK_ROSTER_VERSION,
    fetchedAtMs: Date.now(),
    students,
  } satisfies CachedRoster);
}

/* -------------------------------------------------------------------------- */
/* The participation cache                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Who belongs to a gathering, as the kiosk holds it. See `loadParticipation`.
 *
 * The reader lives here rather than in `services` so that `KioskApp` can seed
 * from it synchronously at mount, exactly as it seeds the roster and the phone
 * index. The alternative is a kiosk that is briefly unscoped on every boot —
 * safe, because every failure here widens the search rather than narrowing it,
 * but needlessly non-deterministic for something already on the disk.
 */
export interface CachedParticipation {
  fetchedAtMs: number;
  builtAtMs: number | null;
  chains: Record<string, { participated: string[]; recent: string[] }>;
}

export interface KioskParticipationScope {
  participated: ReadonlySet<string>;
  recent: ReadonlySet<string>;
}

/**
 * Empty means "nothing to scope by" to every reader.
 *
 * Stryker cannot answer for this one and says so: the object is built when the
 * module loads, which is before any mutant is switched on, so a test can read
 * the emptied version only by reloading the module — see `docs/mutation-testing.md`.
 */
// Stryker disable next-line ObjectLiteral: built at module load, so no test run can see it emptied.
export const NO_PARTICIPATION: KioskParticipationScope = {
  participated: new Set<string>(),
  recent: new Set<string>(),
};

export function participationScope(
  stored: CachedParticipation | null,
  chain: string | null | undefined,
): KioskParticipationScope {
  const held = chain ? stored?.chains?.[chain] : undefined;
  if (!held) return NO_PARTICIPATION;
  return {
    participated: new Set(Array.isArray(held.participated) ? held.participated : []),
    recent: new Set(Array.isArray(held.recent) ? held.recent : []),
  };
}

/** The scope for one chain, straight off the disk. */
export function readCachedParticipation(chain: string | null | undefined): KioskParticipationScope {
  return participationScope(readJson<CachedParticipation>(KIOSK_KEYS.participation), chain);
}

/* -------------------------------------------------------------------------- */
/* The pulse cache                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The revisions this kiosk last acted on, one number per channel.
 *
 * Numbers only. The revs are opaque change markers: any difference from the
 * live document means "refetch that channel", nothing more. (A copy written
 * by a pre-retirement bundle may carry a `registration` number; it is ignored
 * on read and dropped on the next write.)
 */
export interface CachedPulse {
  roster: number;
  phones: number;
  participation: number;
}

function pulseNumber(value: unknown): number {
  // Stryker disable next-line ConditionalExpression: `Number.isFinite` — the
  // static one, not the global — is already false for everything that is not a
  // number, so the `typeof` refuses nothing it would let through. It is here
  // for the narrowing that makes `value` a number at the return.
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function readCachedPulse(): CachedPulse | null {
  const stored = readJson<CachedPulse>(KIOSK_KEYS.pulse);
  if (!stored || typeof stored !== 'object') return null;
  return {
    roster: pulseNumber(stored.roster),
    phones: pulseNumber(stored.phones),
    participation: pulseNumber(stored.participation),
  };
}

export function writeCachedPulse(pulse: CachedPulse): void {
  writeJson(KIOSK_KEYS.pulse, pulse);
}
