/**
 * Telling "you may not read this" apart from "this went wrong".
 *
 * The difference is not cosmetic. A failed read is a thing to retry and to
 * apologise for; a refused one is a settled fact about who the reader is, and
 * retrying it is a loop. Until per-gathering access existed, a refusal in this
 * app was almost always a deactivated account — one global condition, handled
 * once at the shell. Now a counselor in perfectly good standing can be refused
 * one gathering out of five while the other four are theirs, so the distinction
 * has to travel with each read rather than being a property of the session.
 *
 * The `includes` rather than an equality check is deliberate and matches what
 * the codebase already does in `usePersonDetails`, `useAdultContact` and the
 * kiosk's replay queue: Firestore raises `permission-denied` while the
 * callables raise `functions/permission-denied`, and both mean the same thing
 * to a caller deciding whether to try again.
 */
export function isPermissionDenied(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.includes('permission-denied');
}
