/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/eventAccess.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * Whether one person may work one gathering — the rule on its own.
 *
 * Tally never became a permissions product and this does not turn it into one.
 * There is exactly one question here, asked in three places, and the answer is
 * the same in all of them: the check-in screen deciding whether to mount a
 * register, a Cloud Function deciding whether to honour a call, and
 * `firestore.rules` deciding whether to let a write land.
 *
 * Two of those can share this module. The third cannot — rules have no imports
 * — so `onChain()` in `firestore.rules` restates it, and the rules suite is
 * what keeps the restatement honest. That is a real seam and worth naming: if
 * this file and that function ever disagree, the rules win, because they are
 * the only copy an attacker cannot skip.
 *
 * The functions package deploys on its own and cannot import from `src/`, so
 * `scripts/sync-functions-shared.mjs` copies this into
 * `functions/src/generated/` and `tests/functionsShared.test.ts` fails if the
 * copy goes stale. Modules in that set may import nothing but each other, which
 * is why what follows takes primitives — a `uid` and a flag — rather than a
 * `UserProfile` and a `Role`.
 */

/**
 * A gathering's access list, narrowed to the two fields the question needs.
 *
 * Structural rather than the stored `EventAccessDoc` so every caller can
 * satisfy it: the client holds hydrated documents with a `Set`, the functions
 * hold raw Admin SDK data, and a test holds an object literal.
 */
export interface ChainAccess {
  restricted: boolean;
  members: readonly string[] | ReadonlySet<string>;
}

function hasMember(members: ChainAccess['members'], uid: string): boolean {
  return members instanceof Set ? members.has(uid) : (members as readonly string[]).includes(uid);
}

/**
 * May `uid` work the gathering `access` describes?
 *
 * `access` being undefined is the ordinary case, not an error case: no document
 * means nobody has ever restricted this gathering, which means everybody on the
 * team may work it. Every deployment starts there and most gatherings stay
 * there forever, so the undefined branch is the hot path rather than the edge.
 *
 * Admins pass unconditionally. That is break-glass, and it is deliberate: the
 * mistake this feature makes easiest is one core member restricting the
 * gathering the whole ministry works, and somebody has to be able to undo that
 * without a database console.
 */
export function canWorkChain(
  access: ChainAccess | undefined,
  uid: string,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (!access || !access.restricted) return true;
  return hasMember(access.members, uid);
}
