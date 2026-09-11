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
import { isGoogleSignIn, provisionAccessForCaller, redeemLinkForCaller } from './access.js';
import { createLink, mintToken } from './invitations.js';
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

  describe('one mailbox, one key', () => {
    /*
     * Gmail ignores dots in the local part, treats `+tag` as an alias, and
     * answers to googlemail.com. Google's token carries the address as the
     * account registered it, so an invitation typed `josmith` used to fail the
     * `jo.smith` signing in on Sunday. Every other domain keeps its dots: a
     * rule that merged them on a Workspace domain would merge two real staff.
     */
    const GMAIL_CALLER = { ...CALLER, email: 'jo.smith@gmail.com' };

    it('matches a dotted Gmail sign-in to an invitation typed without dots', async () => {
      const db = new FakeFirestore();
      db.seed(invitationPath('josmith@gmail.com'), { role: 'core' });

      const result = await provisionAccessForCaller(db, GMAIL_CALLER, NOW, []);

      expect(result).toMatchObject({ status: 'granted', role: 'core' });
      // The profile carries the address the token did, not the one typed.
      expect(db.get(userPath())?.email).toBe('jo.smith@gmail.com');
    });

    it('matches a googlemail.com sign-in to a gmail.com invitation', async () => {
      const db = new FakeFirestore();
      db.seed(invitationPath('josmith@gmail.com'), { role: 'counselor' });

      const result = await provisionAccessForCaller(
        db,
        { ...CALLER, email: 'Jo.Smith+tally@googlemail.com' },
        NOW,
        [],
      );

      expect(result.status).toBe('granted');
    });

    it('does not match a Workspace address with dots to one without', async () => {
      const db = new FakeFirestore();
      db.seed(invitationPath('josmith@church.org'), { role: 'core' });

      const result = await provisionAccessForCaller(
        db,
        { ...CALLER, email: 'jo.smith@church.org' },
        NOW,
        [],
      );

      expect(result.status).toBe('not-on-roster');
      expect(db.get(userPath())).toBeUndefined();
    });

    it('finds an invitation written under the exact key, and moves it to the canonical one', async () => {
      // Written by the app before dots stopped counting: lowercased, dots to
      // commas, nothing else. It has to keep working, and it has to stop being
      // a second document the pending list would show beside the real one.
      const db = new FakeFirestore();
      const legacyPath = `${PATHS.invitations}/jo,smith@gmail,com`;
      const written = { email: 'jo.smith@gmail.com', role: 'core', invitedBy: 'uid-dana' };
      db.seed(legacyPath, written);

      const result = await provisionAccessForCaller(db, GMAIL_CALLER, NOW, []);

      expect(result).toMatchObject({ status: 'granted', role: 'core' });
      // The same invitation, under the canonical id — plus the stamp every
      // redemption leaves, which is what the pending list reads back as
      // "arrived this week".
      expect(db.get(`${PATHS.invitations}/josmith@gmail,com`)).toMatchObject(written);
      expect(db.get(`${PATHS.invitations}/josmith@gmail,com`)).toMatchObject({
        redeemedBy: GMAIL_CALLER.uid,
      });
      expect(db.get(legacyPath)).toBeUndefined();
    });

    it('reads the canonical invitation when both spellings exist', async () => {
      const db = new FakeFirestore();
      db.seed(invitationPath('josmith@gmail.com'), { role: 'core' });
      db.seed(`${PATHS.invitations}/jo,smith@gmail,com`, { role: 'counselor' });

      const result = await provisionAccessForCaller(db, GMAIL_CALLER, NOW, []);

      expect(result.role).toBe('core');
      // The canonical one is stamped as redeemed; the legacy one is left where
      // it lies rather than moved onto it, which is what would merge two
      // invitations that disagree.
      expect(db.writtenPaths(PATHS.invitations)).toEqual([
        `${PATHS.invitations}/josmith@gmail,com`,
      ]);
    });

    it('does not move a non-Gmail invitation, whose two keys are the same', async () => {
      const db = new FakeFirestore();
      db.seed(invitationPath(CALLER.email), { role: 'core' });

      await provisionAccessForCaller(db, CALLER, NOW, []);

      // One write, and it is the redemption stamp rather than a move.
      expect(db.writtenPaths(PATHS.invitations)).toEqual([invitationPath(CALLER.email)]);
    });

    it('pins a Gmail admin however the variable spelled it', async () => {
      const db = new FakeFirestore();
      const result = await provisionAccessForCaller(db, GMAIL_CALLER, NOW, ['josmith@gmail.com']);

      expect(result.role).toBe('admin');
    });
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

/* -------------------------------------------------------------------------- */
/* What an invitation is for, and what it did                                  */
/* -------------------------------------------------------------------------- */

const JO = { uid: 'uid-jo', email: 'jo.smith84@gmail.com', displayName: 'Jo Smith' };

/** Miriam, core, on Sunday School, having invited somebody to it. */
function ministry(): FakeFirestore {
  const db = new FakeFirestore();
  db.seed(userPath('uid-miriam'), {
    email: 'miriam.achebe@example.org',
    displayName: 'Miriam Achebe',
    role: 'core',
    active: true,
  });
  db.seed('eventSeries/sunday-school', { title: 'Sunday School' });
  db.seed('eventAccess/sunday-school', {
    chainKey: 'sunday-school',
    restricted: true,
    members: ['uid-miriam'],
  });
  return db;
}

describe('an invitation that says what it is for', () => {
  it('puts a new member on it, and says so in titles the grant screen can print', async () => {
    const db = ministry();
    db.seed(invitationPath(JO.email), {
      email: JO.email,
      role: 'counselor',
      invitedBy: 'uid-miriam',
      gatherings: ['sunday-school'],
    });

    const result = await provisionAccessForCaller(db, JO, NOW, []);

    expect(result.status).toBe('granted');
    expect(result.placed).toEqual([{ title: 'Sunday School', oneOffAt: null }]);
    expect(result.skipped).toEqual([]);
    expect(db.get('eventAccess/sunday-school')!.members).toEqual(['uid-miriam', 'uid-jo']);
  });

  it('stamps the invitation with who arrived, so the inviter meets the name rather than hunting it', async () => {
    const db = ministry();
    db.seed(invitationPath(JO.email), {
      email: JO.email,
      role: 'counselor',
      invitedBy: 'uid-miriam',
      gatherings: ['sunday-school'],
    });

    await provisionAccessForCaller(db, JO, NOW, []);

    expect(db.get(invitationPath(JO.email))).toMatchObject({
      resolvedAt: Timestamp.fromDate(NOW),
      redeemedBy: 'uid-jo',
      redeemedEmail: JO.email,
      redeemedName: 'Jo Smith',
      placed: ['sunday-school'],
      skipped: [],
    });
  });

  it('reports the skip rather than swallowing it, when the inviter is no longer on the gathering', async () => {
    const db = ministry();
    db.seed('eventAccess/sunday-school', {
      chainKey: 'sunday-school',
      restricted: true,
      members: ['uid-dana'],
    });
    db.seed(invitationPath(JO.email), {
      email: JO.email,
      role: 'counselor',
      invitedBy: 'uid-miriam',
      gatherings: ['sunday-school'],
    });

    const result = await provisionAccessForCaller(db, JO, NOW, []);

    expect(result.status).toBe('granted');
    expect(result.placed).toEqual([]);
    expect(result.skipped).toEqual([{ title: 'Sunday School', oneOffAt: null }]);
    // And it stays on the record, because somebody has to receive it.
    expect(db.get(invitationPath(JO.email))!.skipped).toEqual(['sunday-school']);
  });

  it('says nothing about gatherings on an invitation that named none', async () => {
    const db = ministry();
    db.seed(invitationPath(JO.email), { email: JO.email, role: 'counselor', invitedBy: 'uid-miriam' });

    const result = await provisionAccessForCaller(db, JO, NOW, []);
    expect(result.placed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe('redeemLinkForCaller', () => {
  async function linkFor(db: FakeFirestore, gatherings: string[] = ['sunday-school']) {
    return createLink(db, {
      invitedBy: 'uid-miriam',
      label: 'Jo, nursery',
      gatherings,
      life: 'link',
      now: NOW,
    });
  }

  it('grants counselor, places, and spends the link once', async () => {
    const db = ministry();
    const { token, id } = await linkFor(db);

    const result = await redeemLinkForCaller(db, JO, token, NOW, []);

    expect(result).toMatchObject({ status: 'granted', role: 'counselor', linkStatus: 'ok' });
    expect(result.placed).toEqual([{ title: 'Sunday School', oneOffAt: null }]);
    expect(db.get(userPath('uid-jo'))).toMatchObject({ role: 'counselor', active: true });
    expect(db.get(`invitations/${id}`)!.redeemedEmail).toBe(JO.email);

    // A second person following the same link finds it spent, which is the
    // whole of "single-use" — a link that works twice is a password.
    const again = await redeemLinkForCaller(
      db,
      { uid: 'uid-sam', email: 'sam@example.org', displayName: 'Sam' },
      token,
      NOW,
      [],
    );
    expect(again.linkStatus).toBe('spent');
    expect(db.get(userPath('uid-sam'))).toBeUndefined();
  });

  it('refuses an expired link, and a token that opens nothing at all', async () => {
    const db = ministry();
    const { token } = await createLink(db, {
      invitedBy: 'uid-miriam',
      label: 'Jo at the door',
      gatherings: [],
      life: 'qr',
      now: NOW,
    });

    const late = new Date(NOW.getTime() + 3_600_000);
    expect((await redeemLinkForCaller(db, JO, token, late, [])).linkStatus).toBe('expired');
    expect((await redeemLinkForCaller(db, JO, mintToken(), NOW, [])).linkStatus).toBe('not-found');
    expect((await redeemLinkForCaller(db, JO, 'a/b', NOW, [])).linkStatus).toBe('not-found');
    expect(db.get(userPath('uid-jo'))).toBeUndefined();
  });

  it('leaves a member who follows a link where they were, and still puts them on the gathering', async () => {
    // "Miriam sent me a link for Sunday School" is a counselor being added to a
    // gathering. A link grants counselor; it does not demote an admin who
    // followed one.
    const db = ministry();
    db.seed(userPath('uid-jo'), {
      email: JO.email,
      role: 'admin',
      active: true,
      createdAt: Timestamp.fromDate(new Date('2025-01-01T00:00:00Z')),
    });
    const { token } = await linkFor(db);

    const result = await redeemLinkForCaller(db, JO, token, NOW, []);

    expect(result).toMatchObject({ status: 'granted', role: 'admin' });
    expect(result.placed).toEqual([{ title: 'Sunday School', oneOffAt: null }]);
    expect(db.get('eventAccess/sunday-school')!.members).toContain('uid-jo');
  });

  it('refuses a suspended account, so a link is not a way back in', async () => {
    const db = ministry();
    db.seed(userPath('uid-jo'), { email: JO.email, role: 'counselor', active: false });
    const { token, id } = await linkFor(db);

    const result = await redeemLinkForCaller(db, JO, token, NOW, []);

    expect(result.status).toBe('inactive');
    // And the link is not burnt by the attempt: whoever it was for can use it.
    expect(db.get(`invitations/${id}`)!.resolvedAt).toBeUndefined();
  });

  it('still provisions a seeded admin as an admin', async () => {
    const db = ministry();
    const { token } = await linkFor(db, []);

    const result = await redeemLinkForCaller(db, JO, token, NOW, ['josmith84@gmail.com']);

    expect(result).toMatchObject({ status: 'granted', role: 'admin' });
  });
});

describe('who let somebody in, stamped once', () => {
  it('records the inviter on the sign-in that admitted them', async () => {
    const db = ministry();
    db.seed(invitationPath(JO.email), {
      email: JO.email,
      role: 'counselor',
      invitedBy: 'uid-miriam',
    });

    await provisionAccessForCaller(db, JO, NOW, []);

    expect(db.get(userPath('uid-jo'))).toMatchObject({ invitedBy: 'uid-miriam' });
  });

  it('records the deployment for a pinned address, whom nobody could have invited', async () => {
    const db = new FakeFirestore();
    await provisionAccessForCaller(db, { ...CALLER, email: ADMIN_EMAIL }, NOW, [ADMIN_EMAIL]);

    expect(db.get(userPath())).toMatchObject({ invitedBy: 'deployment' });
  });

  it('never re-decides it: a later sign-in leaves the stamp alone', async () => {
    // A fact about a moment. Re-deciding it every time would let a withdrawn
    // invitation quietly rewrite how somebody arrived.
    const db = ministry();
    db.seed(userPath('uid-jo'), {
      email: JO.email,
      role: 'counselor',
      active: true,
      invitedBy: 'uid-dana',
      createdAt: Timestamp.fromDate(new Date('2025-01-01T00:00:00Z')),
    });
    const { token } = await createLink(db, {
      invitedBy: 'uid-miriam',
      label: 'Jo',
      gatherings: [],
      life: 'link',
      now: NOW,
    });

    await redeemLinkForCaller(db, JO, token, NOW, []);

    expect(db.get(userPath('uid-jo'))).toMatchObject({ invitedBy: 'uid-dana' });
  });

  it('leaves it absent for somebody who was already here, rather than guessing', async () => {
    const db = new FakeFirestore();
    db.seed(userPath(), { email: CALLER.email, role: 'core', active: true });

    await provisionAccessForCaller(db, CALLER, NOW, []);

    expect(db.get(userPath())).not.toHaveProperty('invitedBy');
  });
});

