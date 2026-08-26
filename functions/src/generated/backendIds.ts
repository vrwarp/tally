/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/backendIds.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * Which people-backend a student id belongs to.
 *
 * Tally's roster is its own, but the *people* on it live in an upstream system
 * of record — Planning Center for one deployment, Attendees for another, both
 * at once for a ministry mid-migration. A student who came from a backend has a
 * document id that says so: `students/pco_123` is Planning Center person 123,
 * `students/a32_9f0c…` is Attendees attendee 9f0c…. The prefix is the claim,
 * which is why the security rules stop a browser minting one of these ids with
 * a person behind it — see `addRosterMember`.
 *
 * A visitor Tally created itself has a generated Firestore id with no prefix
 * (and no underscore at all, so `parseStudentId` cannot misread one). Their
 * backend linkage, once a push lands, lives in document fields instead —
 * `upstreamBackend` / `upstreamPersonId`, with the older `pcoPersonId` field
 * still meaning what it always meant.
 *
 * SHARED WITH THE CLOUD FUNCTIONS via `scripts/sync-functions-shared.mjs`, so
 * this module imports nothing. Both packages must agree on these prefixes or a
 * student stops matching their own roster row.
 */

/**
 * Every backend Tally can speak to, keyed by id. The prefix is permanent once
 * any deployment has used it: it is baked into document ids that attendance
 * history points at for ever.
 */
export const BACKEND_PREFIXES = {
  pco: 'pco_',
  a32: 'a32_',
} as const;

export type BackendId = keyof typeof BACKEND_PREFIXES;

export const BACKEND_IDS = Object.keys(BACKEND_PREFIXES) as readonly BackendId[];

/**
 * `Object.hasOwn`, never `in`: `in` walks the prototype chain, so `constructor`
 * and `toString` both answered yes — and the value being asked about is
 * `upstreamBackend` off a student document, which is the one field here that
 * something other than Tally can have written. Answering yes made
 * `studentIdFor` interpolate `Object` itself into a student id, and the kiosk
 * then joined a child to no roster row at all.
 */
export function isBackendId(value: unknown): value is BackendId {
  return typeof value === 'string' && Object.hasOwn(BACKEND_PREFIXES, value);
}

/** The student id a backend person is known by, everywhere in Tally. */
export function studentIdFor(backendId: BackendId, personId: string): string {
  return `${BACKEND_PREFIXES[backendId]}${personId}`;
}

/**
 * The claim a prefixed student id makes, or null for a Tally-owned id — a
 * visitor whose push has not landed, or one linked through document fields
 * rather than through their id.
 */
export function parseStudentId(
  studentId: string,
): { backendId: BackendId; personId: string } | null {
  for (const backendId of BACKEND_IDS) {
    const prefix = BACKEND_PREFIXES[backendId];
    if (studentId.startsWith(prefix)) {
      return { backendId, personId: studentId.slice(prefix.length) };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Planning Center compatibility                                               */
/* -------------------------------------------------------------------------- */

/** The id Tally uses for a Planning Center person, everywhere. */
export const PCO_ID_PREFIX = BACKEND_PREFIXES.pco;

export function pcoStudentId(personId: string): string {
  return studentIdFor('pco', personId);
}

/**
 * The Planning Center person a `pco_…` id names, or null for anything else —
 * including another backend's id, which is the point of asking this narrowly.
 */
export function personIdFromStudentId(studentId: string): string | null {
  const parsed = parseStudentId(studentId);
  return parsed?.backendId === 'pco' ? parsed.personId : null;
}
