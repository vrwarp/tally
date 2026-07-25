/**
 * The door between "signed in to Firebase" and "allowed to use Tally".
 *
 * Every test here is about a decision that, if wrong, either locks a volunteer
 * out of a check-in they are running or lets a stranger read a roster of minors.
 * The Planning Center lookup is injected, so these exercise the decision rather
 * than the HTTP.
 */
import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { isVerifiedEmail, provisionAccessForCaller, type TeamEntry } from './access.js';
import { FakeFirestore } from './testing/fakeFirestore.js';

const NOW = new Date('2026-03-06T19:00:00Z');

const CALLER = {
  uid: 'uid-miriam',
  email: 'miriam.achebe@footprints.example.org',
  displayName: 'Miriam Achebe',
};

function entry(overrides: Partial<TeamEntry> = {}): TeamEntry {
  return {
    displayName: 'Miriam Achebe',
    role: 'core',
    pcoPersonId: '9100002',
    assignedGroupId: null,
    active: true,
    ...overrides,
  };
}

/** A lookup that returns `result` for any address. */
const lookupReturning = (result: TeamEntry | null) => vi.fn().mockResolvedValue(result);

describe('isVerifiedEmail', () => {
  it('accepts an address the provider has verified', () => {
    expect(isVerifiedEmail({ email: 'a@b.org', email_verified: true })).toBe(true);
  });

  it('accepts a magic link, which proves the address by construction', () => {
    expect(
      isVerifiedEmail({ email: 'a@b.org', firebase: { sign_in_provider: 'emailLink' } }),
    ).toBe(true);
  });

  it('accepts Google, which has already verified it', () => {
    expect(
      isVerifiedEmail({ email: 'a@b.org', firebase: { sign_in_provider: 'google.com' } }),
    ).toBe(true);
  });

  it('refuses an unverified password account', () => {
    // Otherwise anyone could register youth.pastor@church.org and inherit
    // their role.
    expect(
      isVerifiedEmail({
        email: 'youth.pastor@church.org',
        email_verified: false,
        firebase: { sign_in_provider: 'password' },
      }),
    ).toBe(false);
  });

  it('refuses a token with no address at all', () => {
    expect(isVerifiedEmail({})).toBe(false);
  });
});

describe('provisionAccessForCaller', () => {
  it('grants access and creates the profile for somebody on the roster', async () => {
    const db = new FakeFirestore();
    const result = await provisionAccessForCaller(db, CALLER, NOW, lookupReturning(entry()));

    expect(result.status).toBe('granted');
    expect(result.role).toBe('core');

    const stored = db.get('users/uid-miriam');
    expect(stored?.role).toBe('core');
    expect(stored?.active).toBe(true);
    expect(stored?.pcoPersonId).toBe('9100002');
  });

  it('refuses somebody Planning Center has never heard of', async () => {
    const db = new FakeFirestore();
    const result = await provisionAccessForCaller(db, CALLER, NOW, lookupReturning(null));

    expect(result.status).toBe('not-on-roster');
    expect(result.role).toBeNull();
    // The message has to say what to do next, because the person reading it
    // cannot see Planning Center.
    expect(result.message).toMatch(/ask a leader/i);
    // And nothing is created: a refused caller must not leave a profile behind.
    expect(db.get('users/uid-miriam')).toBeUndefined();
  });

  it('pauses access for an inactive Planning Center profile', async () => {
    const db = new FakeFirestore();
    const result = await provisionAccessForCaller(
      db,
      CALLER,
      NOW,
      lookupReturning(entry({ active: false })),
    );

    expect(result.status).toBe('inactive');
    expect(db.get('users/uid-miriam')).toBeUndefined();
  });

  it('lets a role granted inside Tally outrank what Planning Center says', async () => {
    // An admin who promoted somebody in Tally must not be demoted the next time
    // that person signs in.
    const db = new FakeFirestore();
    db.seed('users/uid-miriam', {
      role: 'admin',
      active: true,
      createdAt: Timestamp.fromDate(new Date('2025-09-01T00:00:00Z')),
    });

    const result = await provisionAccessForCaller(
      db,
      CALLER,
      NOW,
      lookupReturning(entry({ role: 'counselor' })),
    );

    expect(result.role).toBe('admin');
    expect(db.get('users/uid-miriam')?.role).toBe('admin');
  });

  it('defaults to the least privilege when nobody has said otherwise', async () => {
    const db = new FakeFirestore();
    const result = await provisionAccessForCaller(
      db,
      CALLER,
      NOW,
      // A role Planning Center does not map to anything Tally understands.
      lookupReturning(entry({ role: 'counselor' })),
    );

    expect(result.role).toBe('counselor');
  });

  it('does not reset "member since" on a returning volunteer', async () => {
    const joined = Timestamp.fromDate(new Date('2025-09-01T00:00:00Z'));
    const db = new FakeFirestore();
    db.seed('users/uid-miriam', { role: 'core', active: true, createdAt: joined });

    await provisionAccessForCaller(db, CALLER, NOW, lookupReturning(entry()));

    expect(db.get('users/uid-miriam')?.createdAt).toBe(joined);
  });

  it('keeps a small group chosen in Tally over the one Planning Center suggests', async () => {
    const db = new FakeFirestore();
    db.seed('users/uid-miriam', { role: 'core', active: true, assignedGroupId: 'grade-8-girls' });

    await provisionAccessForCaller(
      db,
      CALLER,
      NOW,
      lookupReturning(entry({ assignedGroupId: 'grade-6-boys' })),
    );

    expect(db.get('users/uid-miriam')?.assignedGroupId).toBe('grade-8-girls');
  });

  it('takes the small group from Planning Center when Tally has none', async () => {
    const db = new FakeFirestore();
    await provisionAccessForCaller(
      db,
      CALLER,
      NOW,
      lookupReturning(entry({ assignedGroupId: 'grade-6-boys' })),
    );

    expect(db.get('users/uid-miriam')?.assignedGroupId).toBe('grade-6-boys');
  });

  it('prefers the name the caller signed in with', async () => {
    const db = new FakeFirestore();
    await provisionAccessForCaller(
      db,
      CALLER,
      NOW,
      lookupReturning(entry({ displayName: 'M. Achebe' })),
    );

    expect(db.get('users/uid-miriam')?.displayName).toBe('Miriam Achebe');
  });

  it('falls back to the Planning Center name when the token carries none', async () => {
    const db = new FakeFirestore();
    await provisionAccessForCaller(
      db,
      { ...CALLER, displayName: null },
      NOW,
      lookupReturning(entry({ displayName: 'M. Achebe' })),
    );

    expect(db.get('users/uid-miriam')?.displayName).toBe('M. Achebe');
  });

  it('lets a lookup failure propagate rather than reading as a refusal', async () => {
    // "Planning Center is unreachable" and "you are not on the roster" look the
    // same to a volunteer at a door and mean completely different things. One
    // is "try again"; the other sends them hunting for a leader.
    const db = new FakeFirestore();
    const lookup = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(provisionAccessForCaller(db, CALLER, NOW, lookup)).rejects.toThrow('ECONNRESET');
    expect(db.get('users/uid-miriam')).toBeUndefined();
  });

  it('asks about the address the caller actually signed in with', async () => {
    const db = new FakeFirestore();
    const lookup = lookupReturning(entry());
    await provisionAccessForCaller(db, CALLER, NOW, lookup);

    expect(lookup).toHaveBeenCalledWith(CALLER.email);
  });
});
