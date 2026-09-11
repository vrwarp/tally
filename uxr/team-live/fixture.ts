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
 *
 * The screen then grew a person under every row, a fold for the people who have
 * left, and a find field over both — so the fixture grew the things those draw:
 * two narrowed gatherings and who is on them, two lobby kiosks (one recording
 * right now, one long retired), a volunteer's unanswered ask from Thursday, and
 * three profiles carrying the stamps that say how access began and ended. Two
 * of those are deliberately *missing* the `invitedBy` stamp, because most of a
 * real deployment's profiles predate it and "Not recorded (before …)" is a
 * state the loop has to be able to look at.
 */
import type {
  AccessRequest,
  EventAccess,
  EventSeries,
  Invitation,
  KioskDevice,
  Role,
  UserProfile,
} from '@/types';


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
  /**
   * Index of whoever let them in, or `'deployment'` for a pinned address —
   * left off for the profiles that predate the stamp, which is most of a real
   * deployment and the case the person page has to say it cannot answer.
   */
  invitedBy?: number | 'deployment';
  /** Milliseconds ago that access ended, for the one person it has. */
  ended?: number;
}

const MEMBERS: readonly SeedMember[] = [
  {
    name: 'Dana Ruiz',
    email: 'dana.ruiz@example.org',
    role: 'admin',
    seen: 12 * MINUTE,
    invitedBy: 'deployment',
  },
  {
    name: 'Miriam Achebe',
    email: 'miriam.achebe@example.org',
    role: 'core',
    seen: 3 * HOUR,
    invitedBy: 0,
  },
  {
    name: 'Sam Whitfield',
    email: 'sam.whitfield@example.org',
    role: 'counselor',
    seen: 2 * DAY,
    invitedBy: 1,
  },
  {
    name: 'Jonathan Oyelaran-Whitmore',
    email: 'jonathan.oyelaran-whitmore@example.org',
    role: 'counselor',
    seen: 5 * DAY,
  },
  { name: 'Grace Kim', email: 'grace.kim@example.org', role: 'core', seen: 9 * HOUR },
  { name: 'Tobias Lund', email: 'tobias.lund@example.org', role: 'counselor', seen: 6 * DAY },
  { name: 'Ana Beltrán', email: 'ana.beltran@example.org', role: 'counselor', seen: 11 * DAY },
  /*
   * The leaver. He is the whole of the fold, the name a director searches for,
   * and the only row carrying the ending stamps — and he is still on Nursery,
   * because membership survives suspension by design and un-suspending has to
   * be able to say so.
   */
  {
    name: 'Marcus Webb',
    email: 'marcus.webb@example.org',
    role: 'counselor',
    active: false,
    seen: 71 * DAY,
    invitedBy: 1,
    ended: 68 * DAY,
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
  invitedBy:
    member.invitedBy === undefined
      ? null
      : member.invitedBy === 'deployment'
        ? 'deployment'
        : `user-${member.invitedBy}`,
  /*
   * Only the one suspended member carries an ending, and nobody has been put
   * back: the fold is drawn from `active` alone, which is what the list reads,
   * and these are the record of *when* it happened that the person page draws.
   */
  accessEndedAt: member.ended === undefined ? null : new Date(NOW - member.ended),
  accessEndedBy: member.ended === undefined ? null : SELF_ID,
  accessRestoredAt: null,
}));

/* -------------------------------------------------------------------------- */
/* What the person under a row is drawn from                                   */
/* -------------------------------------------------------------------------- */

/**
 * Two narrowed gatherings, which is the smallest number that shows the
 * distinction the person page is about: one this person is on and one they are
 * not, side by side, each with its own controls.
 *
 * Nursery is Miriam's and Marcus's, and Marcus is suspended — so ending
 * Miriam's access is the sentence that has to say she is the last person left
 * on it, since a suspended member is never a way in.
 */
const CHAINS = {
  sundaySchool: 'series-sunday-school',
  nursery: 'series-nursery',
} as const;

export const SERIES: EventSeries[] = [
  {
    id: CHAINS.sundaySchool,
    title: 'Sunday School',
    dayOfWeek: 0,
    startTime: '09:30',
    endTime: '10:30',
    checkInOpensMinutesBefore: 30,
    checkInClosesMinutesAfter: 30,
    active: true,
    order: 0,
  },
  {
    id: CHAINS.nursery,
    title: 'Nursery',
    dayOfWeek: 0,
    startTime: '09:30',
    endTime: '11:30',
    checkInOpensMinutesBefore: 30,
    checkInClosesMinutesAfter: 30,
    active: true,
    order: 1,
  },
];

export const ACCESS: Map<string, EventAccess> = new Map([
  [
    CHAINS.sundaySchool,
    {
      id: CHAINS.sundaySchool,
      chainKey: CHAINS.sundaySchool,
      restricted: true,
      // Dana, Miriam, Sam, Grace.
      members: new Set(['user-0', 'user-1', 'user-2', 'user-4']),
      updatedAt: new Date(NOW - 9 * DAY),
      updatedBy: SELF_ID,
    },
  ],
  [
    CHAINS.nursery,
    {
      id: CHAINS.nursery,
      chainKey: CHAINS.nursery,
      restricted: true,
      // Miriam, and Marcus — who is suspended, and therefore not a way in.
      members: new Set(['user-1', 'user-7']),
      updatedAt: new Date(NOW - 40 * DAY),
      updatedBy: 'user-1',
    },
  ],
]);

/**
 * Two lobby screens, which is the pair that makes the act on them legible.
 *
 * The first is bound and reported thirty seconds ago, so it is live and Retire
 * arms — the state the whole armed confirmation exists for. The second is the
 * same tablet's earlier pairing, retired in the spring and kept for ever,
 * because the row is the provenance of every morning it recorded. Together they
 * are also the duplicate-row shape that makes a mis-tap likely.
 */
export const KIOSK_DEVICES: KioskDevice[] = [
  {
    id: 'lobby-ipad-2f7c',
    approvedBy: 'user-1',
    approvedByName: 'Miriam Achebe',
    pairedAt: new Date(NOW - 96 * DAY),
    lastSeenAt: new Date(NOW - 30_000),
    boundTo: 'Sunday School',
    boundChain: CHAINS.sundaySchool,
    retiredAt: null,
    retiredBy: null,
  },
  {
    id: 'lobby-ipad-8b13',
    approvedBy: 'user-1',
    approvedByName: 'Miriam Achebe',
    pairedAt: new Date(NOW - 210 * DAY),
    lastSeenAt: new Date(NOW - 150 * DAY),
    boundTo: null,
    boundChain: null,
    retiredAt: new Date(NOW - 150 * DAY),
    retiredBy: SELF_ID,
  },
];

/**
 * One ask nobody has answered, from Thursday.
 *
 * The point of drawing it on a person's page rather than only on the roster is
 * that the roster is read at a door on a Sunday and this is read by an admin on
 * a Tuesday — the day the ask is still outstanding and the person who could
 * answer it is sitting down.
 */
export const ACCESS_REQUESTS: AccessRequest[] = [
  {
    id: `${CHAINS.nursery}__user-8`,
    chainKey: CHAINS.nursery,
    uid: 'user-8',
    name: 'Priya Raman',
    askedAt: new Date(NOW - 3 * DAY),
    clearedBy: null,
    clearedAt: null,
  },
];

/** The half of an invitation that only a link ever fills in. */
const UNSPENT = {
  tokenExpiresAt: null,
  resolvedAt: null,
  gatherings: [] as string[],
  placed: [] as string[],
  skipped: [] as string[],
};

export const INVITATIONS: Invitation[] = [
  /*
   * A link waiting to be sent. It has no address — nobody knows which Google
   * account Jo will use, which is the whole reason links exist — so the words
   * the inviter typed are the only thing naming the row.
   */
  {
    id: 'link_0000000000000000000000000000000000000000000000000000000000000001',
    kind: 'link',
    label: 'Jo, nursery, Marie’s daughter',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 3 * HOUR),
    tokenExpiresAt: new Date(NOW + 14 * DAY - 3 * HOUR),
    gatherings: ['sunday-school'],
    resolvedAt: null,
    placed: [],
    skipped: [],
  },
  /*
   * One that was used, and half-worked. The skip is the interesting half: it
   * is the only place anybody ever learns that a Tuesday decision did not
   * land, and it is the one row on this card that is somebody's to do.
   */
  {
    id: 'link_0000000000000000000000000000000000000000000000000000000000000002',
    kind: 'link',
    label: 'Priya, Friday',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 6 * DAY),
    tokenExpiresAt: new Date(NOW + 8 * DAY),
    gatherings: ['sunday-school', 'nursery'],
    resolvedAt: new Date(NOW - 2 * DAY),
    redeemedBy: 'user-priya',
    redeemedEmail: 'priya.raman@example.org',
    redeemedName: 'Priya Raman',
    placed: ['nursery'],
    skipped: ['sunday-school'],
  },
  {
    id: 'rosa.delgado@example.org',
    email: 'rosa.delgado@example.org',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 2 * DAY),
    ...UNSPENT,
  },
  {
    id: 'ken.tanaka@example.org',
    email: 'ken.tanaka@example.org',
    role: 'core',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 6 * DAY),
    ...UNSPENT,
  },
  {
    id: 'wednesday.volunteer@example.org',
    email: 'wednesday.volunteer@example.org',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 24 * DAY),
    ...UNSPENT,
  },
  {
    id: 'noor.haddad@example.org',
    email: 'noor.haddad@example.org',
    role: 'counselor',
    invitedBy: SELF_ID,
    invitedAt: new Date(NOW - 40 * MINUTE),
    ...UNSPENT,
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
    ...UNSPENT,
  },
];
