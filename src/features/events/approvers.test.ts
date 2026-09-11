/**
 * Who the locked row names, and in what order.
 *
 * The sentence under a locked gathering is the whole of what a counselor can
 * do about it, so the claims here are about who gets named: somebody who
 * opened Tally today before anybody's title, the core team before admins, and
 * never a suspended profile — a name that cannot add you is worse than no name,
 * because the reader walks across the lobby to ask. And the admin fallback is
 * a separate sentence that is always available, not one that appears only when
 * the list is empty.
 */
import { describe, expect, it, vi } from 'vitest';
import { approvers, approversFallback, rankApprovers } from '@/features/events/approvers';
import type { EventAccess, UserProfile } from '@/types';
import { makeEvent, makeUser } from '../../../tests/factories';

// `useTeam` is imported for its name helpers; the directory itself is handed
// in below, so the listener behind it is never opened.
vi.mock('@/services/users', () => ({ subscribeUsers: () => () => {} }));

/** Friday 13 February 2026, half past seven in the evening. */
const NOW = new Date(2026, 1, 13, 19, 30);

const t = (key: string, values: Record<string, string> = {}) =>
  key === 'oneApprover'
    ? `${values.name} can add you`
    : key === 'twoApprovers'
      ? `${values.first} or ${values.second} can add you`
      : `or any admin: ${values.name}`;

const friday = makeEvent({ id: 'friday-2026-02-13', seriesId: 'friday-fellowship' });

function directory(...members: UserProfile[]): Map<string, UserProfile> {
  return new Map(members.map((member) => [member.id, member]));
}

function restricted(...uids: string[]): Map<string, EventAccess> {
  return new Map([
    [
      'friday-fellowship',
      {
        id: 'friday-fellowship',
        chainKey: 'friday-fellowship',
        restricted: true,
        members: new Set(uids),
        updatedAt: NOW,
        updatedBy: 'admin',
      },
    ],
  ]);
}

const miriam = makeUser({ id: 'miriam', displayName: 'Miriam Achebe', role: 'admin' });
const dana = makeUser({ id: 'dana', displayName: 'Dana Ruiz', role: 'core' });
const sam = makeUser({ id: 'sam', displayName: 'Sam Okafor', role: 'counselor' });
const jo = makeUser({ id: 'jo', displayName: 'Jo Whitfield', role: 'counselor' });

describe('who is named', () => {
  it('names nobody for a gathering nobody has restricted', () => {
    expect(approvers(t, friday, new Map(), directory(miriam), { now: NOW })).toBeNull();
  });

  it('puts the core team before admins', () => {
    // An admin passes every gate anyway and is named as the fallback; the
    // core member is the one who actually works this gathering.
    const who = approvers(t, friday, restricted('miriam', 'dana'), directory(miriam, dana), {
      now: NOW,
    });

    expect(who).toBe('Dana or Miriam can add you');
  });

  it('puts somebody who opened Tally today before anybody with a title', () => {
    const here = { ...sam, lastSeenAt: new Date(2026, 1, 13, 18, 5) };

    const who = approvers(
      t,
      friday,
      restricted('miriam', 'dana', 'sam'),
      directory(miriam, dana, here),
      { now: NOW },
    );

    expect(who).toBe('Sam or Dana can add you');
  });

  it('measures "today" by the calendar day, not the last twenty-four hours', () => {
    // Signed in at five to midnight yesterday: not here today, whatever the
    // clock says about how long ago that was.
    const lastNight = { ...sam, lastSeenAt: new Date(2026, 1, 12, 23, 55) };

    const who = approvers(t, friday, restricted('dana', 'sam'), directory(dana, lastNight), {
      now: NOW,
    });

    expect(who).toBe('Dana or Sam can add you');
  });

  it('never names a suspended profile', () => {
    // Membership survives suspension on purpose, so the list still holds the
    // uid. Naming them would send the reader across the lobby for nothing.
    const gone = { ...dana, active: false };

    const who = approvers(t, friday, restricted('dana', 'sam'), directory(gone, sam), {
      now: NOW,
    });

    expect(who).toBe('Sam can add you');
  });

  it('names nobody when everybody on the list is suspended', () => {
    const who = approvers(
      t,
      friday,
      restricted('dana'),
      directory({ ...dana, active: false }),
      { now: NOW },
    );

    expect(who).toBeNull();
  });

  it('stops at two names, and at one when the row asks for one', () => {
    const list = restricted('sam', 'jo', 'dana');
    const team = directory(sam, jo, dana);

    expect(approvers(t, friday, list, team, { now: NOW })).toBe('Dana or Sam can add you');
    expect(approvers(t, friday, list, team, { now: NOW, limit: 1 })).toBe('Dana can add you');
  });

  it('keeps the order the document holds for people of the same rank', () => {
    expect(
      rankApprovers(['jo', 'sam'], directory(sam, jo), NOW).map((profile) => profile.id),
    ).toEqual(['jo', 'sam']);
  });

  it('skips a uid the directory does not know', () => {
    const who = approvers(t, friday, restricted('ghost', 'sam'), directory(sam), { now: NOW });

    expect(who).toBe('Sam can add you');
  });
});

describe('the admin fallback', () => {
  it('names the first active admin in the directory, in full', () => {
    expect(approversFallback(t, [sam, dana, miriam])).toBe('or any admin: Miriam Achebe');
  });

  it('is there whether or not the list named anybody', () => {
    // The whole point: it used to appear only when the list was empty.
    expect(approversFallback(t, [miriam, dana])).toBe('or any admin: Miriam Achebe');
  });

  it('passes over a suspended admin for the next one', () => {
    const second = makeUser({ id: 'ravi', displayName: 'Ravi Menon', role: 'admin' });

    expect(approversFallback(t, [{ ...miriam, active: false }, second])).toBe(
      'or any admin: Ravi Menon',
    );
  });

  it('has nothing to say when the directory holds no active admin', () => {
    expect(approversFallback(t, [sam, { ...miriam, active: false }])).toBeNull();
    expect(approversFallback(t, [])).toBeNull();
  });
});
