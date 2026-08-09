/**
 * The one assumption `eventAccess` is built on — and Firestore has since
 * changed half of its answer.
 *
 * `eventAccess/{chainKey}` uses an *absent* document to mean "this gathering is
 * open to the whole team". That is what makes the feature deployable with no
 * backfill and no migration: before anybody restricts anything, no document
 * exists anywhere, and every chain must still be readable and writable exactly
 * as it was.
 *
 * Which puts the entire feature on one question — what does `get()` do at a
 * path where nothing lives?
 *
 * It used to raise, and a raised lookup denies. Written the tempting way —
 * `get(p) == null || …` — every rule guarding a gathering would have denied for
 * every chain nobody had restricted: a total outage on a database with not one
 * ACL in it. The Firestore emulator that ships with firebase-tools 15 answers
 * differently. `get()` at an absent path now returns `null`, and comparing it
 * against null is a legal question with a true answer.
 *
 * That does **not** retire the guard, for two reasons. A null is only safe to
 * *compare* against; reading *through* it still denies, so
 * `get(p).data.get(…)` at an absent path fails exactly as it always did — and
 * that dereference is the one `onChain()` would reach without `exists()` in
 * front of it. And this suite pins the emulator's behaviour, not production's;
 * `exists()` is correct under both answers, which is reason enough to keep it.
 *
 * So `onChain()` in firestore.rules is unchanged, and these tests still say
 * why. What moved is which of the two wrong shapes fails loudly: comparing a
 * lookup against null used to deny everything, and now quietly allows it — the
 * more dangerous of the two mistakes, and worth pinning on its own.
 *
 * This suite tests Firestore, not Tally, against its own tiny ruleset in its
 * own project.
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
     * without a lookup at all, and || carries the get() so it is never reached
     * when the document is absent.
     */
    function onChain(id) {
      return !exists(aclPath(id))
        || get(aclPath(id)).data.get('restricted', false) != true
        || request.auth.uid in get(aclPath(id)).data.get('members', []);
    }

    // Comparing an absent lookup against null. ALLOWS: get() returns null.
    match /comparedToNull/{id} {
      allow get: if get(/databases/$(database)/documents/acl/missing) == null;
    }

    // Reading through that same null. Still DENIES.
    match /readThroughNull/{id} {
      allow get: if get(aclPath('missing')).data.get('restricted', false) != true;
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
  it('returns null rather than raising, so a comparison against null passes', async () => {
    // This assertion used to run the other way. It is kept pointed at the
    // current answer so that a Firestore which changes its mind back — or a
    // production database that never agreed — shows up here rather than as a
    // gathering nobody can open.
    await assertSucceeds(getDoc(doc(asSomeone(UID_OUTSIDER), 'comparedToNull/any')));
  });

  it('still denies when that null is read through', async () => {
    // The half that did not change, and the half onChain() is built on: the
    // lookup may now be compared, but it still cannot be dereferenced. Without
    // the exists() guard in front of it, this is the expression onChain() would
    // evaluate for every unrestricted chain.
    await assertFails(getDoc(doc(asSomeone(UID_OUTSIDER), 'readThroughNull/any')));
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
