/**
 * A ministry's team, as the Team screen would find it.
 *
 * The seeded ministry has three staff — an admin, a core member and a
 * counselor — because three is all the emulator needs to prove that access
 * works. Three is useless for judging *this* screen: every question a critic
 * asks of it is about the shape of a list (how many rows are answered above the
 * fold, what a suspended row looks like beside an active one, whether the
 * invite form still earns its column when four people are waiting on it), and a
 * three-row list answers none of them.
 *
 * So this fixture is a plausible mid-size youth ministry rather than the seed:
 * eleven profiles and five invitations — four of them still outstanding, since
 * the fifth belongs to somebody who has since signed in — with every state the
 * screen can be in
 * present at least once — a suspended counselor, somebody who was invited and
 * has never signed in, an invitation for an address that has since signed in
 * (which the screen must *not* list as waiting), the admin looking at their own
 * row, and a display name long enough to test the truncation.
 */
import type { Invitation, Role, UserProfile } from '@/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * Anchored to the clock rather than to a date. Every row on this screen carries
 * a relative time ("Last seen 3 days ago"), and a fixture pinned to a fixed
 * evening drifts into "8 months ago" on every row — which is a different
 * screen, and one no ministry would ever see.
 */
const NOW = Date.now();

interface SeedMember {
  name: string;
  email: string;
  role: Role;
  active?: boolean;
  /** Milliseconds ago, or `null` for an account that has never been used. */
  seen: number | null;
}

const MEMBERS: readonly SeedMember[] = [
  { name: 'Dana Ruiz', email: 'dana.ruiz@example.org', role: 'admin', seen: 12 * MINUTE },
  { name: 'Miriam Achebe', email: 'miriam.achebe@example.org', role: 'core', seen: 3 * HOUR },
  { name: 'Sam Whitfield', email: 'sam.whitfield@example.org', role: 'counselor', seen: 2 * DAY },
  {
    name: 'Jonathan Oyelaran-Whitmore',
    email: 'jonathan.oyelaran-whitmore@example.org',
    role: 'counselor',
    seen: 5 * DAY,
  },
  { name: 'Grace Kim', email: 'grace.kim@example.org', role: 'core', seen: 9 * HOUR },
  { name: 'Tobias Lund', email: 'tobias.lund@example.org', role: 'counselor', seen: 6 * DAY },
  { name: 'Ana Beltrán', email: 'ana.beltran@example.org', role: 'counselor', seen: 11 * DAY },
  {
    name: 'Marcus Webb',
    email: 'marcus.webb@example.org',
    role: 'counselor',
    active: false,
    seen: 71 * DAY,
  },
  { name: 'Priya Raman', email: 'priya.raman@example.org', role: 'counselor', seen: 4 * DAY },
  { name: 'Eli Sandoval', email: 'eli.sandoval@example.org', role: 'admin', seen: 26 * HOUR },
  { name: 'Hannah Boateng', email: 'hannah.boateng@example.org', role: 'counselor', seen: null },
];

/** The signed-in admin: Dana, the ministry's director, and row one of the list. */
export const SELF_ID = 'user-0';

export const USERS: UserProfile[] = MEMBERS.map((member, index) => ({
  id: `user-${index}`,
  email: member.email,
  displayName: member.name,
  role: member.role,
  active: member.active ?? true,
  pcoPersonId: null,
  createdAt: new Date(NOW - 200 * DAY),
  lastSeenAt: member.seen === null ? null : new Date(NOW - member.seen),
}));

export const INVITATIONS: Invitation[] = [
  {
    id: 'rosa.delgado@example.org',
    email: 'rosa.delgado@example.org',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 2 * DAY),
  },
  {
    id: 'ken.tanaka@example.org',
    email: 'ken.tanaka@example.org',
    role: 'core',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 6 * DAY),
  },
  {
    id: 'wednesday.volunteer@example.org',
    email: 'wednesday.volunteer@example.org',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 24 * DAY),
  },
  {
    id: 'noor.haddad@example.org',
    email: 'noor.haddad@example.org',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 40 * MINUTE),
  },
  /*
   * Sam accepted a month ago and is in the list above. Nothing deletes an
   * invitation when it is used, so a real collection holds one of these for
   * every person who has ever signed in — and the card is about who has *not*,
   * so it must not draw this row or count it. Last, so a frame shot with
   * `?invites=n` still gets n rows.
   */
  {
    id: 'sam.whitfield@example.org',
    email: 'sam.whitfield@example.org',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 30 * DAY),
  },
];
