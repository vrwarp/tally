/**
 * Invitations, and the four things about them that must not drift.
 *
 * The token is a bearer credential: whoever holds it becomes a counselor. So
 * these are less about shapes than about the properties that make a link safe
 * to send in a text message — the plaintext is never stored, re-minting takes
 * the old one out, a spent one stays spent, and an inviter who has since been
 * taken off a gathering cannot still seed people onto it.
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { FakeFirestore } from './testing/fakeFirestore.js';
import {
  ACCESS_REQUEST_LIFE_MS,
  asToken,
  backfillInvitedBy,
  countLiveLinks,
  createLink,
  hashToken,
  isChainKey,
  linkId,
  MAX_GATHERINGS,
  mintToken,
  placeOnGatherings,
  QR_LIFE_MS,
  readLink,
  recordRedemption,
  refreshLink,
  resolveChainNames,
  sanitizeGatherings,
  sanitizeLabel,
  sweepAccessRequests,
} from './invitations.js';

const NOW = new Date('2026-09-06T14:00:00Z');
const MIRIAM = 'uid-miriam';

function stamp(at: Date): Timestamp {
  return Timestamp.fromDate(at);
}

describe('tokens', () => {
  it('mints something long, url-safe and never the same twice', () => {
    const first = mintToken();
    expect(asToken(first)).toBe(first);
    expect(first).not.toBe(mintToken());
  });

  it('refuses anything that could be a path, a paste or a probe', () => {
    expect(asToken('a/b')).toBeNull();
    expect(asToken('short')).toBeNull();
    expect(asToken('x'.repeat(65))).toBeNull();
    expect(asToken(42)).toBeNull();
    expect(asToken(null)).toBeNull();
  });

  it('keys the document by the hash, so the token itself is never written', async () => {
    const db = new FakeFirestore();
    const { token, id } = await createLink(db, {
      invitedBy: MIRIAM,
      label: 'Jo, nursery',
      gatherings: [],
      life: 'link',
      now: NOW,
    });

    expect(id).toBe(`link_${hashToken(token)}`);
    const stored = JSON.stringify([...db.data.entries()]);
    expect(stored).not.toContain(token);
  });
});

describe('sanitising what an inviter typed', () => {
  it('keeps a label as words and refuses an empty one', () => {
    expect(sanitizeLabel('  Jo, nursery, Marie’s daughter  ')).toBe('Jo, nursery, Marie’s daughter');
    expect(sanitizeLabel('   ')).toBeNull();
    expect(sanitizeLabel(undefined)).toBeNull();
    expect(sanitizeLabel('x'.repeat(200))).toHaveLength(80);
  });

  it('refuses a chain key that would address a different collection', () => {
    expect(isChainKey('sunday-school')).toBe(true);
    expect(isChainKey('a/b')).toBe(false);
    expect(isChainKey('..')).toBe(false);
    expect(isChainKey('')).toBe(false);
  });

  it('dedupes gatherings and caps the list', () => {
    expect(sanitizeGatherings(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(sanitizeGatherings(['ok', 'bad/key'])).toEqual(['ok']);
    expect(sanitizeGatherings(Array.from({ length: 40 }, (_, i) => `c${i}`))).toHaveLength(
      MAX_GATHERINGS,
    );
    expect(sanitizeGatherings('not a list')).toEqual([]);
  });
});

describe('reading a link', () => {
  it('opens for a live token and says which kind of no for every other', async () => {
    const db = new FakeFirestore();
    const { token, id } = await createLink(db, {
      invitedBy: MIRIAM,
      label: 'Jo',
      gatherings: ['sunday-school'],
      life: 'link',
      now: NOW,
    });

    expect((await readLink(db, token, NOW)).status).toBe('ok');

    // Ten minutes is the QR's whole safety property, so an expiry has to bite.
    const qr = await createLink(db, {
      invitedBy: MIRIAM,
      label: 'Jo at the door',
      gatherings: [],
      life: 'qr',
      now: NOW,
    });
    const afterwards = new Date(NOW.getTime() + QR_LIFE_MS + 1);
    expect((await readLink(db, qr.token, afterwards)).status).toBe('expired');

    await recordRedemption(db, {
      id,
      uid: 'uid-jo',
      email: 'jo@example.org',
      name: 'Jo Smith',
      placement: { placed: ['sunday-school'], skipped: [] },
      now: NOW,
    });
    expect((await readLink(db, token, NOW)).status).toBe('spent');

    expect((await readLink(db, mintToken(), NOW)).status).toBe('not-found');
  });
});

describe('re-minting', () => {
  it('carries the invitation across and takes the old token out with it', async () => {
    const db = new FakeFirestore();
    const first = await createLink(db, {
      invitedBy: MIRIAM,
      label: 'Jo, nursery',
      gatherings: ['sunday-school'],
      life: 'link',
      now: NOW,
    });

    const later = new Date(NOW.getTime() + 86_400_000);
    const second = await refreshLink(db, { id: first.id, life: 'qr', now: later });

    expect(second).not.toBeNull();
    expect(second!.token).not.toBe(first.token);
    // The row moved, and there is never a moment when two tokens open it.
    expect((await readLink(db, first.token, later)).status).toBe('not-found');
    expect((await readLink(db, second!.token, later)).status).toBe('ok');

    const row = db.get(`invitations/${second!.id}`)!;
    expect(row.label).toBe('Jo, nursery');
    expect(row.gatherings).toEqual(['sunday-school']);
    expect(row.invitedBy).toBe(MIRIAM);
    // Extending a link is not inviting somebody again.
    expect(row.invitedAt).toEqual(stamp(NOW));
    expect((row.tokenExpiresAt as Timestamp).toMillis()).toBe(later.getTime() + QR_LIFE_MS);
  });

  it('refuses to reissue a redeemed invitation — that record is not a credential', async () => {
    const db = new FakeFirestore();
    const { id } = await createLink(db, {
      invitedBy: MIRIAM,
      label: 'Jo',
      gatherings: [],
      life: 'link',
      now: NOW,
    });
    await recordRedemption(db, {
      id,
      uid: 'uid-jo',
      email: 'jo@example.org',
      name: null,
      placement: { placed: [], skipped: [] },
      now: NOW,
    });

    expect(await refreshLink(db, { id, life: 'link', now: NOW })).toBeNull();
  });

  it('refuses an id that is not a link at all', async () => {
    const db = new FakeFirestore();
    db.seed('invitations/sam@example,org', { email: 'sam@example.org', role: 'counselor' });
    expect(await refreshLink(db, { id: 'sam@example,org', life: 'link', now: NOW })).toBeNull();
  });
});

describe('the live-link cap', () => {
  it('counts unredeemed links and nothing else', async () => {
    const db = new FakeFirestore();
    db.seed('invitations/sam@example,org', { email: 'sam@example.org', role: 'counselor' });

    const first = await createLink(db, {
      invitedBy: MIRIAM,
      label: 'One',
      gatherings: [],
      life: 'link',
      now: NOW,
    });
    await createLink(db, {
      invitedBy: MIRIAM,
      label: 'Two',
      gatherings: [],
      life: 'link',
      now: NOW,
    });
    expect(await countLiveLinks(db, NOW)).toBe(2);

    await recordRedemption(db, {
      id: first.id,
      uid: 'uid-jo',
      email: 'jo@example.org',
      name: null,
      placement: { placed: [], skipped: [] },
      now: NOW,
    });
    expect(await countLiveLinks(db, NOW)).toBe(1);
  });

  it('does not count an expired one, so a cap cannot become a trap', async () => {
    const db = new FakeFirestore();
    await createLink(db, {
      invitedBy: MIRIAM,
      label: 'March, never sent',
      gatherings: [],
      life: 'link',
      now: NOW,
    });

    const april = new Date(NOW.getTime() + 40 * 86_400_000);
    expect(await countLiveLinks(db, NOW)).toBe(1);
    expect(await countLiveLinks(db, april)).toBe(0);
  });
});

describe('placing somebody on the gatherings their invitation named', () => {
  function withInviter(role: string, active = true): FakeFirestore {
    const db = new FakeFirestore();
    db.seed(`users/${MIRIAM}`, { role, active, email: 'miriam@example.org' });
    return db;
  }

  it('adds them to a restricted chain the inviter is on', async () => {
    const db = withInviter('core');
    db.seed('eventAccess/sunday-school', {
      chainKey: 'sunday-school',
      restricted: true,
      members: [MIRIAM],
    });

    const outcome = await placeOnGatherings(db, {
      uid: 'uid-jo',
      invitedBy: MIRIAM,
      gatherings: ['sunday-school'],
      now: NOW,
    });

    expect(outcome).toEqual({ placed: ['sunday-school'], skipped: [] });
    expect(db.get('eventAccess/sunday-school')!.members).toEqual([MIRIAM, 'uid-jo']);
  });

  it('skips a chain the inviter has since been taken off — the one way this could escalate', async () => {
    const db = withInviter('core');
    db.seed('eventAccess/sunday-school', {
      chainKey: 'sunday-school',
      restricted: true,
      members: ['uid-dana'],
    });

    const outcome = await placeOnGatherings(db, {
      uid: 'uid-jo',
      invitedBy: MIRIAM,
      gatherings: ['sunday-school'],
      now: NOW,
    });

    expect(outcome).toEqual({ placed: [], skipped: ['sunday-school'] });
    expect(db.get('eventAccess/sunday-school')!.members).toEqual(['uid-dana']);
  });

  it('skips it for a suspended inviter too, however senior they were', async () => {
    const db = withInviter('admin', false);
    db.seed('eventAccess/sunday-school', { restricted: true, members: [] });

    const outcome = await placeOnGatherings(db, {
      uid: 'uid-jo',
      invitedBy: MIRIAM,
      gatherings: ['sunday-school'],
      now: NOW,
    });
    expect(outcome.skipped).toEqual(['sunday-school']);
  });

  it('lets an admin place on a chain they are not on — the break-glass, as everywhere else', async () => {
    const db = withInviter('admin');
    db.seed('eventAccess/sunday-school', { restricted: true, members: ['uid-dana'] });

    const outcome = await placeOnGatherings(db, {
      uid: 'uid-jo',
      invitedBy: MIRIAM,
      gatherings: ['sunday-school'],
      now: NOW,
    });
    expect(outcome.placed).toEqual(['sunday-school']);
  });

  it('counts an unrestricted gathering as placed, because "you are on it" is true', async () => {
    const db = withInviter('core');
    // No document at all, and a document that was reopened: both are open.
    db.seed('eventAccess/friday', { restricted: false, members: [] });

    const outcome = await placeOnGatherings(db, {
      uid: 'uid-jo',
      invitedBy: MIRIAM,
      gatherings: ['nursery', 'friday'],
      now: NOW,
    });

    expect(outcome).toEqual({ placed: ['nursery', 'friday'], skipped: [] });
    // Nothing is written to a fence that is not there.
    expect(db.writtenPaths('eventAccess')).toEqual([]);
  });

  it('writes nothing when they are already on it', async () => {
    const db = withInviter('core');
    db.seed('eventAccess/sunday-school', { restricted: true, members: [MIRIAM, 'uid-jo'] });

    const outcome = await placeOnGatherings(db, {
      uid: 'uid-jo',
      invitedBy: MIRIAM,
      gatherings: ['sunday-school'],
      now: NOW,
    });

    expect(outcome.placed).toEqual(['sunday-school']);
    expect(db.writtenPaths('eventAccess')).toEqual([]);
  });

  it('never turns a chain key into a path', async () => {
    const db = withInviter('admin');
    const outcome = await placeOnGatherings(db, {
      uid: 'uid-jo',
      invitedBy: MIRIAM,
      gatherings: ['../users/uid-jo'],
      now: NOW,
    });
    expect(outcome).toEqual({ placed: [], skipped: [] });
    expect(db.writes).toEqual([]);
  });
});

describe('naming a gathering on the grant screen', () => {
  it('reads a series title, an event title, and falls back to the key', async () => {
    const db = new FakeFirestore();
    db.seed('eventSeries/sunday-school', { title: 'Sunday School' });
    db.seed('events/youth-root', { title: 'Youth night', mode: 'recurring' });

    expect(await resolveChainNames(db, ['sunday-school', 'youth-root', 'mystery'])).toEqual({
      'sunday-school': { title: 'Sunday School', oneOffAt: null },
      'youth-root': { title: 'Youth night', oneOffAt: null },
      // An unnamed gathering on a grant screen is better than a blank.
      mystery: { title: 'mystery', oneOffAt: null },
    });
  });

  it('dates a one-off, because "the retreat" and "the retreat on the 12th" are different grants', async () => {
    const db = new FakeFirestore();
    const when = new Date('2026-09-12T16:00:00Z');
    db.seed('events/retreat-2026', {
      title: 'Autumn retreat',
      mode: 'oneoff',
      startAt: stamp(when),
    });

    expect(await resolveChainNames(db, ['retreat-2026'])).toEqual({
      'retreat-2026': { title: 'Autumn retreat', oneOffAt: when.getTime() },
    });
  });
});

describe('what a redemption leaves behind', () => {
  it('stamps who arrived, under which address, and what they were put on', async () => {
    const db = new FakeFirestore();
    const { id } = await createLink(db, {
      invitedBy: MIRIAM,
      label: 'Jo, nursery',
      gatherings: ['sunday-school', 'nursery'],
      life: 'link',
      now: NOW,
    });

    await recordRedemption(db, {
      id,
      uid: 'uid-jo',
      email: 'jo.smith84@gmail.com',
      name: 'Jo Smith',
      placement: { placed: ['nursery'], skipped: ['sunday-school'] },
      now: NOW,
    });

    expect(db.get(`invitations/${id}`)).toMatchObject({
      resolvedAt: stamp(NOW),
      redeemedBy: 'uid-jo',
      redeemedEmail: 'jo.smith84@gmail.com',
      redeemedName: 'Jo Smith',
      placed: ['nursery'],
      skipped: ['sunday-school'],
      // The invitation is still the invitation: the label survives, so the row
      // in Arrived this week is the one the inviter recognises.
      label: 'Jo, nursery',
    });
  });
});

describe('linkId', () => {
  it('is stable for a token and unguessable from the id', () => {
    const token = mintToken();
    expect(linkId(token)).toBe(linkId(token));
    expect(linkId(token)).toContain('link_');
    expect(linkId(token)).not.toContain(token);
  });
});

describe('sweeping old asks to be added', () => {
  it('takes week-old ones, cleared or not, and leaves this week’s alone', async () => {
    const db = new FakeFirestore();
    const old = new Date(NOW.getTime() - ACCESS_REQUEST_LIFE_MS - 1);
    db.seed('accessRequests/sunday-school__uid-sam', {
      chainKey: 'sunday-school',
      uid: 'uid-sam',
      askedAt: stamp(old),
    });
    db.seed('accessRequests/sunday-school__uid-pat', {
      chainKey: 'sunday-school',
      uid: 'uid-pat',
      askedAt: stamp(old),
      clearedBy: 'uid-miriam',
      clearedAt: stamp(old),
    });
    db.seed('accessRequests/nursery__uid-jo', {
      chainKey: 'nursery',
      uid: 'uid-jo',
      askedAt: stamp(NOW),
    });

    const { swept } = await sweepAccessRequests(db, NOW);

    expect(swept.sort()).toEqual(['sunday-school__uid-pat', 'sunday-school__uid-sam']);
    expect(db.get('accessRequests/nursery__uid-jo')).toBeDefined();
  });

  it('leaves a row with no moment on it where it lies, rather than guessing', async () => {
    // Nothing writes one — the rules require the field — so its existence means
    // something has gone wrong, and deleting the evidence is the wrong reflex
    // for a job that runs unattended at ten past three.
    const db = new FakeFirestore();
    db.seed('accessRequests/broken__uid-sam', { chainKey: 'broken', uid: 'uid-sam' });

    expect((await sweepAccessRequests(db, NOW)).swept).toEqual([]);
    expect(db.get('accessRequests/broken__uid-sam')).toBeDefined();
  });
});

describe('backfilling how the team arrived', () => {
  function tally(): FakeFirestore {
    const db = new FakeFirestore();
    db.seed('users/uid-sam', { email: 'sam.smith@example.org' });
    db.seed('users/uid-jo', { email: 'Jo.Smith84+tally@googlemail.com' });
    db.seed('users/uid-dana', { email: 'dana@example.org', invitedBy: 'deployment' });
    db.seed('users/uid-ghost', { email: 'ghost@example.org' });

    db.seed('invitations/sam,smith@example,org', {
      email: 'sam.smith@example.org',
      invitedBy: MIRIAM,
    });
    // Spelled differently from the profile: the whole reason the canonical
    // address exists is that these two are the same mailbox.
    db.seed('invitations/josmith84@gmail,com', {
      email: 'josmith84@gmail.com',
      invitedBy: 'uid-dana',
    });
    return db;
  }

  it('reports without writing, which is the mode to run first', async () => {
    const db = tally();
    const result = await backfillInvitedBy(db, { apply: false });

    expect([...result.stamped].sort((a, b) => a.uid.localeCompare(b.uid))).toEqual([
      { uid: 'uid-jo', invitedBy: 'uid-dana' },
      { uid: 'uid-sam', invitedBy: MIRIAM },
    ]);
    expect(db.writtenPaths('users')).toEqual([]);
  });

  it('stamps from a surviving invitation, however the Gmail address was spelled', async () => {
    const db = tally();
    await backfillInvitedBy(db, { apply: true });

    expect(db.get('users/uid-sam')).toMatchObject({ invitedBy: MIRIAM });
    expect(db.get('users/uid-jo')).toMatchObject({ invitedBy: 'uid-dana' });
  });

  it('leaves a profile with no surviving invitation unrecorded rather than guessing', async () => {
    const db = tally();
    const result = await backfillInvitedBy(db, { apply: true });

    expect(result.unrecorded).toEqual(['uid-ghost']);
    expect(db.get('users/uid-ghost')).not.toHaveProperty('invitedBy');
  });

  it('skips anybody who already carries the stamp, so a second run is a no-op', async () => {
    const db = tally();
    await backfillInvitedBy(db, { apply: true });
    const after = await backfillInvitedBy(db, { apply: true });

    expect(after.stamped).toEqual([]);
    expect(db.get('users/uid-dana')).toMatchObject({ invitedBy: 'deployment' });
  });

  it('reads a link’s redeemer, so somebody who arrived on one is covered too', async () => {
    const db = new FakeFirestore();
    db.seed('users/uid-pat', { email: 'pat@example.org' });
    db.seed('invitations/link_abc', {
      kind: 'link',
      label: 'Pat',
      invitedBy: MIRIAM,
      redeemedEmail: 'pat@example.org',
      resolvedAt: stamp(NOW),
    });

    await backfillInvitedBy(db, { apply: true });
    expect(db.get('users/uid-pat')).toMatchObject({ invitedBy: MIRIAM });
  });
});

