/**
 * What the Team screen asks the rest of the app for, answered locally.
 *
 * `TeamPage` is very nearly a pure function of two subscriptions and a profile.
 * The only things standing between it and a dev server are the four modules
 * that reach Firestore, so the harness aliases those four and nothing else: the
 * component, its markup, its classes and its stylesheet are the app's own.
 *
 * The writes resolve without doing anything. A frame is a state, not a session
 * — the loop photographs the screen an admin arrives at, not the toast they get
 * for changing a role — and a stub that mutated the fixture would make the
 * shooter's frames depend on the order it drove them in.
 */
import type { Invitation, Role, UserProfile } from '@/types';
import { INVITATIONS, SELF_ID, USERS } from './fixture';

const params = new URLSearchParams(location.search);

/**
 * Who is looking.
 *
 * `?role=core` is not a cosmetic variation: a core member sees no invite card
 * and no role selects at all, so it is a genuinely different screen — a
 * read-only directory — and it is the one an ideation round is most likely to
 * break without noticing, because the admin frame looks fine.
 */
const role: Role = (params.get('role') as Role | null) ?? 'admin';

/** How much of the fixture to serve, for the states a real ministry passes through. */
const memberCount = Number(params.get('users') ?? USERS.length);
const inviteCount = Number(params.get('invites') ?? INVITATIONS.length);

const users = USERS.slice(0, Math.max(0, memberCount));
const invitations = INVITATIONS.slice(0, Math.max(0, inviteCount));

/*
 * The signed-in person is always in the list when the list is long enough to
 * hold them, because "(you)" and the sentence about needing another admin are
 * part of the screen's normal state rather than an edge case.
 */
const self = users.find((user) => user.id === SELF_ID) ?? { ...USERS[0]!, role };

export function useAuth() {
  return {
    profile: { ...self, role },
    can: (needed: Role) => (needed === 'admin' ? role === 'admin' : true),
  };
}

export function useToast() {
  return { show: () => '' };
}

export function subscribeUsers(next: (list: UserProfile[]) => void) {
  next(users);
  return () => {};
}

export async function upsertUser() {}

export function subscribeInvitations(next: (list: Invitation[]) => void) {
  next(invitations);
  return () => {};
}

export async function inviteToTally() {}
export async function withdrawInvitation() {}
