/**
 * The door between "signed in to Google" and "allowed to use Tally".
 *
 * Every test here is about a decision that, if wrong, either locks a volunteer
 * out of a check-in they are running or lets a stranger read a roster of minors.
 * There is no Planning Center in any of them any more: who may sign in is
 * Tally's own record, because a Planning Center List is a saved query and
 * "these particular twelve adults" is not a query.
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { isGoogleSignIn, provisionAccessForCaller } from './access.js';
import { PATHS } from './firestore.js';
import { emailKey } from './pco/mapping.js';
import { FakeFirestore } from './testing/fakeFirestore.js';

const NOW = new Date('2026-03-06T19:00:00Z');

const CALLER = {
  uid: 'uid-miriam',
  email: 'miriam.achebe@example.org',
  displayName: 'Miriam Achebe',
};

const ADMIN_EMAIL = 'dana.ruiz@example.org';

function invitationPath(email: string): string {
  return `${PATHS.invitations}/${emailKey(email)}`;
}

function userPath(uid = CALLER.uid): string {
  return `${PATHS.users}/${uid}`;
}

describe('isGoogleSignIn', () => {
  it('accepts a Google account', () => {
    expect(isGoogleSignIn({ email: 'a@b.org', firebase: { sign_in_provider: 'google.com' } })).toBe(
      true,
    );
  });

  it('refuses an email link, however verified the address is', () => {
    /*
     * A magic link really does prove the address, and it was accepted for that
     * reason. It is refused now for a different one: one way in is one way to
     * explain at a church door, one set of failure modes, and no mailbox left
     * signed in on a shared phone.
     */
    expect(
      isGoogleSignIn({
        email: 'a@b.org',
        email_verified: true,
        firebase: { sign_in_provider: 'emailLink' },
      }),
    ).toBe(false);
  });

  it('refuses a password account, verified or not', () => {
    expect(
      isGoogleSignIn({
        email: 'a@b.org',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      }),
    ).toBe(false);
  });

  it('refuses a token with no address at all', () => {
    expect(isGoogleSignIn({ firebase: { sign_in_provider: 'google.com' } })).toBe(false);
  });
});

describe('provisionAccessForCaller', () => {
  it('refuses somebody nobody has invited', async () => {
    const db = new FakeFirestore();
    const result = await provisionAccessForCaller(db, CALLER, NOW, []);

    expect(result.status).toBe('not-on-roster');
    expect(result.message).toContain(CALLER.email);
    // Nothing written: a stranger signing in must not leave a profile behind.
    expect(db.get(userPath())).toBeUndefined();
  });

  it('grants access on an invitation and creates the profile', async () => {
    const db = new FakeFirestore();
    db.seed(invitationPath(CALLER.email), { role: 'core' });

    const result = await provisionAccessForCaller(db, CALLER, NOW, []);

    expect(result).toMatchObject({ status: 'granted', role: 'core' });
    expect(db.get(userPath())).toMatchObject({
      email: CALLER.email,
      role: 'core',
      active: true,
      displayName: 'Miriam Achebe',
    });
  });

  it('defaults to the least privilege when an invitation names no role', async () => {
    const db = new FakeFirestore();
    db.seed(invitationPath(CALLER.email), {});

    const result = await provisionAccessForCaller(db, CALLER, NOW, []);
    expect(result.role).toBe('counselor');
  });

  it('refuses a role the invitation made up', async () => {
    // An invitation is written by an admin through the app, but it is still a
    // database document; a `role: "superuser"` must not become anything.
    const db = new FakeFirestore();
    db.seed(invitationPath(CALLER.email), { role: 'superuser' });

    expect((await provisionAccessForCaller(db, CALLER, NOW, [])).role).toBe('counselor');
  });

  it('ignores the retired pause flag on an invitation written before it went', async () => {
    /*
     * `active` was a switch on the Team screen that could refuse a first
     * sign-in. It is gone — it did nothing for anybody who already had a
     * profile, which was most of the rows it appeared on — and a stale `false`
     * left on a document must not go on refusing people at a door no admin can
     * see any more. Withdrawing the invitation is how the no is said now.
     */
    const db = new FakeFirestore();
    db.seed(invitationPath(CALLER.email), { role: 'counselor', active: false });

    const result = await provisionAccessForCaller(db, CALLER, NOW, []);

    expect(result).toMatchObject({ status: 'granted', role: 'counselor' });
    expect(db.get(userPath())).toMatchObject({ active: true });
  });

  it('matches the invitation however the address was typed', async () => {
    const db = new FakeFirestore();
    db.seed(invitationPath('Miriam.Achebe@Example.ORG'), { role: 'core' });

    const result = await provisionAccessForCaller(
      db,
      { ...CALLER, email: '  MIRIAM.ACHEBE@example.org ' },
      NOW,
      [],
    );

    expect(result.status).toBe('granted');
    expect(db.get(userPath())?.email).toBe(CALLER.email);
  });

  describe('the seeded admin', () => {
    it('is an admin without an invitation, because nobody could have sent one', async () => {
      // The bootstrap: on a fresh install there is no admin to grant the first
      // admin anything, and this is what breaks that circle.
      const db = new FakeFirestore();
      const result = await provisionAccessForCaller(
        db,
        { ...CALLER, email: ADMIN_EMAIL },
        NOW,
        [ADMIN_EMAIL],
      );

      expect(result).toMatchObject({ status: 'granted', role: 'admin' });
      expect(db.get(userPath())).toMatchObject({ role: 'admin', active: true });
    });

    it('is an admin again even after somebody demoted them in the app', async () => {
      const db = new FakeFirestore();
      db.seed(userPath(), { email: ADMIN_EMAIL, role: 'counselor', active: true });

      const result = await provisionAccessForCaller(
        db,
        { ...CALLER, email: ADMIN_EMAIL },
        NOW,
        [ADMIN_EMAIL],
      );

      expect(result.role).toBe('admin');
      expect(db.get(userPath())?.role).toBe('admin');
    });

    it('gets back in even after being deactivated, which is the whole point', async () => {
      /*
       * Deactivating the last admin is exactly the accident the standing grant
       * exists for. Honouring `active: false` here would mean the break-glass
       * breaks along with everything else.
       */
      const db = new FakeFirestore();
      db.seed(userPath(), { email: ADMIN_EMAIL, role: 'admin', active: false });

      const result = await provisionAccessForCaller(
        db,
        { ...CALLER, email: ADMIN_EMAIL },
        NOW,
        [ADMIN_EMAIL],
      );

      expect(result.status).toBe('granted');
      expect(db.get(userPath())?.active).toBe(true);
    });

    it('is matched case-insensitively, the way an env var gets typed', async () => {
      const db = new FakeFirestore();
      const result = await provisionAccessForCaller(
        db,
        { ...CALLER, email: 'Dana.Ruiz@Example.org' },
        NOW,
        [ADMIN_EMAIL],
      );

      expect(result.role).toBe('admin');
    });

    it('does not make everybody else an admin', async () => {
      const db = new FakeFirestore();
      db.seed(invitationPath(CALLER.email), { role: 'counselor' });

      const result = await provisionAccessForCaller(db, CALLER, NOW, [ADMIN_EMAIL]);
      expect(result.role).toBe('counselor');
    });
  });

  describe('somebody who has signed in before', () => {
    it('keeps the role an admin gave them, over the invitation they arrived on', async () => {
      const db = new FakeFirestore();
      db.seed(invitationPath(CALLER.email), { role: 'counselor' });
      db.seed(userPath(), { email: CALLER.email, role: 'core', active: true });

      const result = await provisionAccessForCaller(db, CALLER, NOW, []);

      expect(result.role).toBe('core');
      expect(db.get(userPath())?.role).toBe('core');
    });

    it('is refused once an admin deactivates them', async () => {
      const db = new FakeFirestore();
      db.seed(userPath(), { email: CALLER.email, role: 'core', active: false });

      const result = await provisionAccessForCaller(db, CALLER, NOW, []);

      expect(result.status).toBe('inactive');
      expect(db.get(userPath())?.active).toBe(false);
    });

    it('gets in on their profile even after the invitation is gone', async () => {
      // Invitations are how somebody arrives, not what keeps them here. Tidying
      // the invitation list must not throw the team out of the app.
      const db = new FakeFirestore();
      db.seed(userPath(), { email: CALLER.email, role: 'counselor', active: true });

      expect((await provisionAccessForCaller(db, CALLER, NOW, [])).status).toBe('granted');
    });

    it('does not reset "member since"', async () => {
      const joined = Timestamp.fromDate(new Date('2025-09-01T00:00:00Z'));
      const db = new FakeFirestore();
      db.seed(userPath(), { email: CALLER.email, role: 'core', active: true, createdAt: joined });

      await provisionAccessForCaller(db, CALLER, NOW, []);
      expect(db.get(userPath())?.createdAt).toBe(joined);
    });

    it('leaves a field the sign-in has no opinion about alone', async () => {
      // The write merges, so anything another screen set survives a sign-in.
      const db = new FakeFirestore();
      db.seed(userPath(), {
        email: CALLER.email,
        role: 'core',
        active: true,
        pcoPersonId: '9100003',
      });

      await provisionAccessForCaller(db, CALLER, NOW, []);
      expect(db.get(userPath())?.pcoPersonId).toBe('9100003');
    });

    it('keeps the name it already had when the token carries none', async () => {
      const db = new FakeFirestore();
      db.seed(userPath(), {
        email: CALLER.email,
        role: 'core',
        active: true,
        displayName: 'Miriam A.',
      });

      await provisionAccessForCaller(db, { ...CALLER, displayName: null }, NOW, []);
      expect(db.get(userPath())?.displayName).toBe('Miriam A.');
    });
  });
});
