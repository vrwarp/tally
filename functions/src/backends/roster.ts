/**
 * Assembling one roster answer from several backends' answers.
 *
 * Pure on purpose — the fan-out itself (who gets asked, what happens to the
 * flags) stays in the entry point with the database, and everything about
 * *combining* what came back lives here where a test can hold it still.
 *
 * The partial-failure rule is the point of the module: one backend down must
 * not blank the other's roster. A failed backend contributes nothing to the
 * merged people and nothing to `unresolved` — its students are not
 * "unresolved" in the sense that word has always had (a person the backend
 * could not name); the whole backend was unreachable, and the per-backend
 * entry is how a screen says that without flooding the missing-students
 * banner. The caller throws only when *every* enabled backend failed, which
 * keeps a single-backend deployment behaving exactly as it always has.
 */
import type { BackendId } from '../generated/backendIds.js';
import type { RosterPerson } from './types.js';

/** One backend's contribution to a roster read, failure included. */
export interface PerBackendRoster {
  backendId: BackendId;
  displayName: string;
  ok: boolean;
  /** Why it failed, in plain language. Null when `ok`. */
  error: string | null;
  /**
   * The failure itself, kept so the all-backends-down path can report it with
   * the full debug payload. Never serialized — the wire summary carries
   * `error` only.
   */
  thrown?: unknown;
  people: RosterPerson[];
  /** Backend-local person ids the backend could not name. */
  unresolved: string[];
  relinks: Array<{ fromPersonId: string; toPersonId: string }>;
  /** The subset of `unresolved` that is known gone. */
  missing: string[];
  cached: boolean;
  fetchedAt: string;
  /**
   * Person id -> the same person's Attendees UUID, when this backend carries
   * the church's cross-backend pointers (Planning Center's `attendees_uuid`
   * field). Server-internal: read by the alias fold in the entry point, never
   * merged into the wire answer.
   */
  a32Aliases?: Record<string, string>;
}

export interface MergedRoster {
  people: RosterPerson[];
  unresolved: string[];
  relinks: Array<{ fromPersonId: string; toPersonId: string }>;
  missing: string[];
  /** True only when nothing went upstream — every answering backend held one. */
  cached: boolean;
  fetchedAt: string;
}

/**
 * The union of every answering backend, in one roster order.
 *
 * With a single backend answering this is that backend's result unchanged —
 * same people, same order, same flags — which is what keeps the seam
 * invisible to a deployment that never connected a second one.
 */
export function mergeBackendRosters(results: readonly PerBackendRoster[]): MergedRoster {
  const answered = results.filter((result) => result.ok);

  const people = answered.flatMap((result) => result.people);
  // The same ordering each backend already applied to its own people; merging
  // must not depend on which backend answered first.
  people.sort((a, b) => (a.searchName < b.searchName ? -1 : a.searchName > b.searchName ? 1 : 0));

  return {
    people,
    unresolved: answered.flatMap((result) => result.unresolved),
    relinks: answered.flatMap((result) => result.relinks),
    missing: answered.flatMap((result) => result.missing),
    cached: answered.length > 0 && answered.every((result) => result.cached),
    // The freshest claim made, because the number is shown as "how stale might
    // this be" — the pessimistic direction would be the *oldest*, but a failed
    // backend contributes no timestamp at all and the screen pairing this with
    // `perBackend` can say more than one number ever could.
    fetchedAt: results.reduce((latest, result) => (result.fetchedAt > latest ? result.fetchedAt : latest), ''),
  };
}
