/**
 * The one assumption `eventAccess` is built on — and the answer is not the
 * convenient one.
 *
 * `eventAccess/{chainKey}` uses an *absent* document to mean "this gathering is
 * open to the whole team". That is what makes the feature deployable with no
 * backfill and no migration: before anybody restricts anything, no document
 * exists anywhere, and every chain must still be readable and writable exactly
 * as it was.
 *
 * Which puts the entire feature on one question — what does `get()` do at a
 * path where nothing lives? The tempting answer is `null`, which would let
 * `onChain()` say `a == null || …` and let absence fall through to "open".
 *
 * **It does not return null. It raises**, and a raised lookup denies. Written
 * the tempting way, every rule guarding a gathering would deny for every chain
 * nobody had restricted — a total outage on a database with not one ACL in it,
 * arriving the moment the rules deployed rather than the first time somebody
 * used the feature.
 *
 * So absence has to be asked about with `exists()` first, and the `||` that
 * follows has to carry the `get()`. That is the shape `onChain()` uses in
 * firestore.rules, and these tests are why. The guard is not defensive
 * programming; it is the difference between the feature working and the app
 * going dark.
 *
 * This suite tests Firestore, not Tally, against its own tiny ruleset in its
 * own project. If it ever goes green on the first case, Firestore changed its
 * mind and `onChain()` could be simplified — but nothing breaks by leaving it
 * as it is.
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_EMULATOR = '127.0.0.1:8080';

/**
 * A project of its own, so this ruleset cannot be confused with the real one
 * and clearing it cannot disturb the suite that matters.
 */
const PROBE_PROJECT_ID = 'demo-tally-getsemantics';

/**
 * Seeded below with `restricted: true`, members `[uid-member]`. Its sibling
 * `acl/missing` is named in the ruleset and never written — that is the point.
 */
const PRESENT = 'acl/present';

const UID_MEMBER = 'uid-member';
const UID_OUTSIDER = 'uid-outsider';

/**
 * Each `match` isolates one behaviour, so a failure names which half broke
 * rather than "the probe".
 */
const PROBE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function aclPath(id) {
      return /databases/$(database)/documents/acl/$(id);
    }

    /*
     * The shape firestore.rules actually uses. exists() answers the question
     * get() raises on, and || carries the lookup so it is never reached when
     * the document is absent.
     */
    function onChain(id) {
      return !exists(aclPath(id))
        || get(aclPath(id)).data.get('restricted', false) != true
        || request.auth.uid in get(aclPath(id)).data.get('members', []);
    }

    // The tempting form. Must DENY, on a path with nothing behind it.
    match /unguarded/{id} {
      allow get: if get(/databases/$(database)/documents/acl/missing) == null;
    }

    // The guarded form over an absent document: falls through to open.
    match /guardedAbsent/{id} {
      allow get: if onChain('missing');
    }

    // The guarded form over a restricted document: members only.
    match /guardedPresent/{id} {
      allow get: if onChain('present');
    }

    // Proof the suite can tell allow from deny at all.
    match /control/{id} {
      allow get: if false;
    }

    match /acl/{id} {
      allow read, write: if false;
    }
  }
}
`;

let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, rawPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? DEFAULT_EMULATOR).split(':');

  env = await initializeTestEnvironment({
    projectId: PROBE_PROJECT_ID,
    firestore: { rules: PROBE_RULES, host, port: Number(rawPort) },
  });

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    await setDoc(doc(db, PRESENT), { restricted: true, members: [UID_MEMBER] });
  });
});

afterAll(async () => {
  await env.cleanup();
});

function asSomeone(uid: string): Firestore {
  return env.authenticatedContext(uid).firestore() as unknown as Firestore;
}

describe('get() at a path with no document', () => {
  it('raises rather than returning null, so an unguarded lookup denies', async () => {
    // The load-bearing negative. If this ever starts succeeding, Firestore
    // changed `get()` to return null for a missing document and onChain()
    // could drop its exists() guard. Until then, absence must be asked about
    // with exists() — not compared against null.
    await assertFails(getDoc(doc(asSomeone(UID_OUTSIDER), 'unguarded/any')));
  });

  it('is guarded by exists(), which lets an absent ACL mean open', async () => {
    // The migration story in one assertion: no document, anybody gets in.
    await assertSucceeds(getDoc(doc(asSomeone(UID_OUTSIDER), 'guardedAbsent/any')));
  });
});

describe('the guarded predicate over a document that does exist', () => {
  it('admits somebody on the members list', async () => {
    await assertSucceeds(getDoc(doc(asSomeone(UID_MEMBER), 'guardedPresent/any')));
  });

  it('refuses somebody who is not', async () => {
    // Both halves matter: the exists() guard must not be so eager that it
    // waves through a document that is really there.
    await assertFails(getDoc(doc(asSomeone(UID_OUTSIDER), 'guardedPresent/any')));
  });
});

describe('the control', () => {
  it('denies an unconditionally false rule', async () => {
    // Without this, an emulator that allowed everything would make the
    // succeeding cases above pass and prove nothing.
    await assertFails(getDoc(doc(asSomeone(UID_MEMBER), 'control/any')));
  });
});
