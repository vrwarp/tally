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
import type { AccessRequest, Invitation, KioskDevice, Role, UserProfile } from '@/types';
import {
  ACCESS,
  ACCESS_REQUESTS,
  INVITATIONS,
  KIOSK_DEVICES,
  SELF_ID,
  SERIES,
  USERS,
} from './fixture';

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
export async function setAccessActive() {}
export async function setRole() {}

/**
 * The calendar, as much of it as this screen reads.
 *
 * `events` is empty and `series` is not, which is the honest shape for a
 * screen nobody reaches with a week of gatherings loaded: the invite form's
 * tick-boxes and the person page's gathering list both name a chain from
 * `access`, and `series` is what gives those chains their titles.
 */
export function useData() {
  return { events: [], series: SERIES, access: ACCESS };
}

export async function addChainMembers() {}
export async function removeChainMember() {}

export function subscribeKioskDevices(next: (list: KioskDevice[]) => void) {
  next(KIOSK_DEVICES);
  return () => {};
}
export async function retireKioskDevice() {}

/**
 * Live, by the same rule the service uses. Re-stated rather than imported
 * because this module *is* what `@/services/kioskDevices` resolves to here, and
 * importing itself would be a cycle.
 */
export const KIOSK_LIVE_WITHIN_MS = 3 * 60_000;
export function isKioskLive(device: KioskDevice, nowMs: number): boolean {
  if (device.retiredAt || !device.boundChain) return false;
  const seen = device.lastSeenAt?.getTime();
  return seen !== undefined && nowMs - seen < KIOSK_LIVE_WITHIN_MS;
}

export const ACCESS_REQUEST_LIFE_MS = 7 * 86_400_000;
export function subscribeChainRequests(
  chainKey: string,
  next: (list: AccessRequest[]) => void,
) {
  next(ACCESS_REQUESTS.filter((request) => request.chainKey === chainKey));
  return () => {};
}
export function isOutstanding(request: AccessRequest, nowMs: number): boolean {
  if (request.clearedAt) return false;
  const asked = request.askedAt?.getTime();
  return asked === undefined || nowMs - asked < ACCESS_REQUEST_LIFE_MS;
}
export async function askToBeAdded() {}
export async function clearAccessRequest() {}

/*
 * The callables, which is the last thing standing between this screen and a
 * dev server: `@/services/functions` opens a Firebase app at module scope, so
 * importing it at all is what was throwing on the missing config.
 *
 * `listPinnedAdmins` answers the deployment's own admin, which is what makes
 * one row on the frozen roster wear "Pinned by the deployment" — the state an
 * ideation round is most likely to break, because it is the one row whose
 * controls are absent on purpose.
 */
export async function listPinnedAdmins() {
  return { data: { emails: [USERS[0]!.email] } };
}
export async function createInvitationLink() {
  return {
    data: {
      id: 'link_frozen',
      token: 'frozenwalkthroughtoken',
      expiresAt: Date.now() + 14 * 86_400_000,
    },
  };
}
export async function refreshInvitationLink() {
  return {
    data: {
      id: 'link_frozen',
      token: 'frozenwalkthroughtoken',
      expiresAt: Date.now() + 10 * 60_000,
    },
  };
}

export function subscribeInvitations(next: (list: Invitation[]) => void) {
  next(invitations);
  return () => {};
}

export async function inviteToTally() {}
export async function withdrawInvitation() {}
