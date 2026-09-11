/**
 * Invitations, and the two doors into Tally.
 *
 * An invitation used to be one thing: an address an admin typed, matched
 * exactly against whichever Google account the volunteer happened to pick,
 * with nothing sent to anybody. Two kinds now share the collection:
 *
 *   - **An address invitation**, keyed by `emailKey(email)` as before. The
 *     inviter knows which account the person will use — the church's Workspace
 *     address, usually — and `provisionAccess` finds it by address at sign-in.
 *   - **A link invitation**, keyed `link_<sha256(token)>`. The inviter knows
 *     the person but not their account, which is the ordinary case for a
 *     volunteer with a Gmail address they have never spelled out loud. Tally
 *     mints a token, keeps only its hash — as the document id, so a redemption
 *     is one `get()` at a known path rather than a scan of the collection —
 *     and hands the inviter a link to send or a QR to hold up.
 *
 * ## Why the id is the hash
 *
 * The token is a bearer credential: whoever holds it becomes a counselor. So
 * the plaintext never touches Firestore, exactly as the kiosk's pairing secret
 * does not. Making the *id* the hash rather than a field means the redemption
 * path reads one document by name — no query, no index, and nothing an
 * unauthenticated caller can turn into a collection scan.
 *
 * The cost is that re-minting moves the row: **Extend** and **QR** write a new
 * document and delete the old one in a single batch, carrying `label`,
 * `gatherings`, `invitedBy` and `invitedAt` across. That is the honest shape of
 * the act — the old token stops working the moment a new one exists — and the
 * row a person is looking at is identified by who it is for, not by its id.
 *
 * ## Every link grants counselor
 *
 * Whoever mints it. A core-team link that leaks in a screenshot would open
 * Insights, Students and Settings; promoting is one tap on the row once there
 * is a person to promote. Minting is core and up: handing out the access you
 * already hold on one gathering is not the same act as granting sign-in to a
 * ministry, which is why a counselor cannot mint one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { PATHS, type DocumentSnapshotLike, type FirestoreLike } from './firestore.js';
import { canonicalEmail, type Role } from './pco/mapping.js';

/** How long a link a person is meant to *send* lives. */
export const LINK_LIFE_MS = 14 * 86_400_000;

/**
 * How long a QR lives.
 *
 * Its whole safety property is that both people are in the room: the code on
 * the screen is read by the phone in front of it, and a photograph of a screen
 * taken over somebody's shoulder is worth nothing ten minutes later.
 */
export const QR_LIFE_MS = 10 * 60_000;

/**
 * How many unredeemed links may exist at once.
 *
 * A cap rather than a rate limit, because the risk is not speed: it is a
 * season roll where somebody mints thirty links "to have them ready", half of
 * them are never sent, and the collection becomes thirty live credentials to
 * the children's roster that nobody is watching. Twenty is more than a
 * ministry needs in a week and small enough to read down.
 */
export const MAX_LIVE_LINKS = 20;

/** At most this many chains on one invitation — see `gatherings`. */
export const MAX_GATHERINGS = 20;

/** The label an inviter types: "Jo, nursery, Marie's daughter". */
export const MAX_LABEL_LENGTH = 80;

const LINK_PREFIX = 'link_';

export type InviteLife = 'link' | 'qr';

export interface InvitationRecord {
  kind?: string;
  email?: string;
  role?: string;
  label?: string;
  gatherings?: string[];
  invitedBy?: string;
  invitedAt?: Timestamp;
  tokenExpiresAt?: Timestamp;
  resolvedAt?: Timestamp;
  placed?: string[];
  skipped?: string[];
  redeemedBy?: string;
  redeemedEmail?: string;
  redeemedName?: string | null;
}

/** What a redemption did with the gatherings the invitation named. */
export interface Placement {
  placed: string[];
  skipped: string[];
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 128 bits, base64url.
 *
 * Twenty-two characters — short enough to sit in a text message and in a QR
 * that scans from across a lobby, and far past guessing: a link is public the
 * moment it is sent, so its only protection is that nobody can arrive at one
 * they were not given.
 */
export function mintToken(): string {
  return randomBytes(16).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The document a token redeems, addressed by name rather than by search. */
export function linkId(token: string): string {
  return `${LINK_PREFIX}${hashToken(token)}`;
}

export function isLinkId(id: string): boolean {
  return id.startsWith(LINK_PREFIX);
}

/**
 * A token as it may appear in a URL, or null.
 *
 * Checked before anything is hashed, so a paste of a whole sentence or a path
 * of its own cannot become a document id.
 */
export function asToken(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Minting                                                                     */
/* -------------------------------------------------------------------------- */

export function sanitizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_LABEL_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A chain key, as a thing that will become a document path.
 *
 * Checked wherever one arrives from a document as well as from a caller: an
 * invitation's `gatherings` is written by a client under the rules, which can
 * say the array is short but not what is in it, and every reader here turns an
 * entry into `eventAccess/{key}`. A key carrying a slash would address a
 * different collection entirely.
 */
export function isChainKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..'
  );
}

export function sanitizeGatherings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isChainKey))].slice(0, MAX_GATHERINGS);
}

/**
 * How many links could still be redeemed right now.
 *
 * Expired ones are not counted, and that is the difference between a cap and a
 * trap: a season roll that mints twenty links in March and sends none of them
 * would otherwise block every invitation in April behind a message reading
 * "withdraw one", with twenty dead rows to withdraw. A link that can no longer
 * open anything is not holding a place.
 */
export async function countLiveLinks(db: FirestoreLike, now: Date): Promise<number> {
  const snapshot = await db.collection(PATHS.invitations).get();
  return snapshot.docs.filter((entry) => {
    if (!isLinkId(entry.id)) return false;
    const record = (entry.data() ?? {}) as InvitationRecord;
    if (record.resolvedAt != null) return false;
    const expiresAt = record.tokenExpiresAt;
    return !(expiresAt instanceof Timestamp) || expiresAt.toMillis() > now.getTime();
  }).length;
}

export function lifeMs(life: InviteLife): number {
  return life === 'qr' ? QR_LIFE_MS : LINK_LIFE_MS;
}

/**
 * Mints a link, and answers the token exactly once.
 *
 * The token is never stored and never recoverable: an inviter who loses the
 * message they were about to send re-mints, which invalidates what they lost —
 * the only behaviour that is safe to offer, since Tally cannot tell "I lost it"
 * from "somebody else has it".
 */
export async function createLink(
  db: FirestoreLike,
  input: {
    invitedBy: string;
    label: string;
    gatherings: string[];
    life: InviteLife;
    now: Date;
  },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = mintToken();
  const expiresAt = new Date(input.now.getTime() + lifeMs(input.life));
  const id = linkId(token);

  await db.doc(`${PATHS.invitations}/${id}`).set({
    kind: 'link',
    // Counselor, whoever minted it. See the note at the top.
    role: 'counselor' satisfies Role,
    label: input.label,
    gatherings: input.gatherings,
    invitedBy: input.invitedBy,
    invitedAt: Timestamp.fromDate(input.now),
    tokenExpiresAt: Timestamp.fromDate(expiresAt),
  });

  return { id, token, expiresAt };
}

/**
 * Re-mints an existing link: the same invitation, a new token, a new life.
 *
 * Both **Extend** and **QR** are this. A new document under the new hash and
 * the old one deleted, in one batch, so there is never a moment when two
 * tokens open the same invitation and never one where the row has vanished.
 */
export async function refreshLink(
  db: FirestoreLike,
  input: { id: string; life: InviteLife; now: Date },
): Promise<{ id: string; token: string; expiresAt: Date } | null> {
  const ref = db.doc(`${PATHS.invitations}/${input.id}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || !isLinkId(input.id)) return null;

  const held = (snapshot.data() ?? {}) as InvitationRecord;
  // A redeemed invitation is a record of what happened, not a credential to
  // reissue: whoever is being invited again is a new invitation.
  if (held.resolvedAt != null) return null;

  const token = mintToken();
  const expiresAt = new Date(input.now.getTime() + lifeMs(input.life));
  const id = linkId(token);

  const batch = db.batch();
  batch.set(db.doc(`${PATHS.invitations}/${id}`), {
    kind: 'link',
    role: 'counselor' satisfies Role,
    label: held.label ?? '',
    gatherings: held.gatherings ?? [],
    invitedBy: held.invitedBy ?? '',
    // Carried, not restamped: the row says when this person was invited, and
    // extending a link is not inviting them again.
    invitedAt: held.invitedAt ?? Timestamp.fromDate(input.now),
    tokenExpiresAt: Timestamp.fromDate(expiresAt),
  });
  batch.delete(ref);
  await batch.commit();

  return { id, token, expiresAt };
}

/* -------------------------------------------------------------------------- */
/* Reading one                                                                 */
/* -------------------------------------------------------------------------- */

export type LinkStatus = 'ok' | 'expired' | 'spent' | 'not-found';

export interface LinkLookup {
  status: LinkStatus;
  id: string;
  record: InvitationRecord | null;
}

/**
 * The invitation a token opens, and whether it still opens it.
 *
 * `spent` and `expired` are told apart deliberately: they are different
 * sentences to the person holding the link — one of them means "you are
 * already in, sign in", and the other means "ask for another".
 */
export async function readLink(
  db: FirestoreLike,
  token: string,
  now: Date,
): Promise<LinkLookup> {
  const id = linkId(token);
  const snapshot = await db.doc(`${PATHS.invitations}/${id}`).get();
  if (!snapshot.exists) return { status: 'not-found', id, record: null };

  const record = (snapshot.data() ?? {}) as InvitationRecord;
  if (record.resolvedAt != null) return { status: 'spent', id, record };

  const expiresAt = record.tokenExpiresAt;
  if (expiresAt instanceof Timestamp && expiresAt.toMillis() <= now.getTime()) {
    return { status: 'expired', id, record };
  }
  return { status: 'ok', id, record };
}

/* -------------------------------------------------------------------------- */
/* What an invitation is for                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Puts a new member on the gatherings their invitation named.
 *
 * Re-checked at redemption rather than trusted from Tuesday: the inviter must
 * still be an admin, or still be on that chain themselves. Handing out access
 * you no longer hold is the one way this could become an escalation — a core
 * member taken off Sunday School in January must not still be seeding people
 * onto it in March through a link minted before.
 *
 * A chain nobody has restricted is `placed` rather than skipped: every active
 * member can work it, so "you're on Sunday School" is true, and telling
 * somebody it could not be added would be a refusal about a fence that is not
 * there.
 */
export async function placeOnGatherings(
  db: FirestoreLike,
  input: { uid: string; invitedBy: string; gatherings: readonly string[]; now: Date },
): Promise<Placement> {
  const placed: string[] = [];
  const skipped: string[] = [];
  const chains = input.gatherings.filter(isChainKey).slice(0, MAX_GATHERINGS);
  if (chains.length === 0) return { placed, skipped };

  const inviterSnapshot = await db.doc(`${PATHS.users}/${input.invitedBy}`).get();
  const inviter = inviterSnapshot.exists ? (inviterSnapshot.data() ?? {}) : {};
  const inviterIsAdmin = inviter.active === true && inviter.role === 'admin';
  const inviterIsActive = inviter.active === true;

  for (const chain of chains) {
    const ref = db.doc(`${PATHS.eventAccess}/${chain}`);
    const snapshot = await ref.get();
    const access = snapshot.exists ? (snapshot.data() ?? {}) : {};

    if (access.restricted !== true) {
      placed.push(chain);
      continue;
    }

    const members = Array.isArray(access.members)
      ? access.members.filter((uid: unknown): uid is string => typeof uid === 'string')
      : [];

    if (!inviterIsAdmin && !(inviterIsActive && members.includes(input.invitedBy))) {
      skipped.push(chain);
      continue;
    }

    if (!members.includes(input.uid)) {
      await ref.set(
        {
          chainKey: chain,
          restricted: true,
          members: [...members, input.uid],
          updatedAt: Timestamp.fromDate(input.now),
          // The inviter's decision, carried out at the moment it can be: the
          // new member did not put themselves on this.
          updatedBy: input.invitedBy,
        },
        { merge: true },
      );
    }
    placed.push(chain);
  }

  return { placed, skipped };
}

/**
 * A gathering as the person being added to it would name it.
 *
 * `oneOffAt` is the difference between "you can work Sunday School" and "you
 * can work the retreat, on the 12th of September" — which is invisible to
 * whoever was added and permanent, so the screen has to say it. Epoch millis
 * rather than a formatted date, because the server has no idea what language
 * the person reads.
 */
export interface GatheringName {
  title: string;
  oneOffAt: number | null;
}

/**
 * Chain keys as the gatherings a person would name them.
 *
 * A chain key is a series id, a recurrence root's event id, or a one-off's own
 * id — `chainKey()` in `src/lib/materialize.ts` — so the title is under one of
 * two documents, and neither is guaranteed to exist. The key itself is the
 * last resort: an unnamed gathering on a grant screen is better than a blank.
 *
 * Only the third of those three is dated. A series and a recurrence root each
 * stand for every night the gathering ever runs; a one-off stands for one
 * evening, and saying which one is the whole point.
 */
export async function resolveChainNames(
  db: FirestoreLike,
  keys: readonly string[],
): Promise<Record<string, GatheringName>> {
  const names: Record<string, GatheringName> = {};
  const read = async (path: string): Promise<DocumentSnapshotLike | null> => {
    const snapshot = await db.doc(path).get();
    return snapshot.exists ? snapshot : null;
  };

  for (const key of new Set(keys.filter(isChainKey).slice(0, MAX_GATHERINGS))) {
    const series = await read(`${PATHS.eventSeries}/${key}`);
    const event = series ? null : await read(`${PATHS.events}/${key}`);
    const data = (series ?? event)?.data() ?? {};
    const startAt = data.startAt;
    names[key] = {
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : key,
      oneOffAt:
        data.mode === 'oneoff' && startAt instanceof Timestamp ? startAt.toMillis() : null,
    };
  }
  return names;
}

/**
 * Stamps what a redemption did onto the invitation it spent.
 *
 * The invitation stops being a credential and becomes the record: who arrived,
 * under which address, when, and what they were put on. The pending card reads
 * it back as **Arrived this week**, so the inviter meets the name of whoever
 * redeemed their link rather than having to go looking for it — and a skipped
 * placement sits there as an outstanding item until somebody resolves it.
 */
export async function recordRedemption(
  db: FirestoreLike,
  input: {
    id: string;
    uid: string;
    email: string;
    name: string | null;
    placement: Placement;
    now: Date;
  },
): Promise<void> {
  await db.doc(`${PATHS.invitations}/${input.id}`).set(
    {
      resolvedAt: Timestamp.fromDate(input.now),
      redeemedBy: input.uid,
      redeemedEmail: input.email,
      redeemedName: input.name,
      placed: input.placement.placed,
      skipped: input.placement.skipped,
    },
    { merge: true },
  );
}

/* -------------------------------------------------------------------------- */
/* Asking to be added                                                          */
/* -------------------------------------------------------------------------- */

/** Mirrors `ACCESS_REQUEST_LIFE_MS` in `src/services/accessRequests.ts`. */
export const ACCESS_REQUEST_LIFE_MS = 7 * 86_400_000;

const ACCESS_REQUESTS = 'accessRequests';

/**
 * Sweeps asks nobody needs any longer.
 *
 * An ask is about tonight. A fortnight-old one is a claim nobody can act on
 * about a person whose situation has moved, and the rules deliberately refuse
 * every client delete — clearing *marks*, because the asker has to be able to
 * tell "nobody looked" from "somebody said no". That leaves the sweep to the
 * server, which is here: a week after it was made, an ask stops being anything
 * and goes.
 *
 * A row with no `askedAt` at all is left where it lies rather than guessed
 * about. Nothing writes one — the rules require the field — so its existence
 * would mean something has gone wrong, and deleting evidence of that is the
 * wrong reflex for a job that runs unattended at half past three.
 */
export async function sweepAccessRequests(
  db: FirestoreLike,
  now: Date,
): Promise<{ swept: string[] }> {
  const snapshot = await db.collection(ACCESS_REQUESTS).get();
  const swept: string[] = [];

  for (const entry of snapshot.docs) {
    const askedAt = (entry.data() ?? {}).askedAt;
    if (!(askedAt instanceof Timestamp)) continue;
    if (now.getTime() - askedAt.toMillis() < ACCESS_REQUEST_LIFE_MS) continue;
    await db.doc(`${ACCESS_REQUESTS}/${entry.id}`).delete();
    swept.push(entry.id);
  }

  return { swept };
}

/* -------------------------------------------------------------------------- */
/* Backfilling how people arrived                                              */
/* -------------------------------------------------------------------------- */

/**
 * Copies `invitedBy` onto profiles that predate the stamp.
 *
 * `provisionAccess` records who let somebody in on the sign-in that admitted
 * them, and never again — so everybody who already had a profile the day that
 * arrived has no such record. Their invitations usually survive: an invitation
 * is not consumed when it is used, and most of them are still in the
 * collection carrying the uid of whoever wrote them.
 *
 * Where none survives, nothing is written. The person page reads that as "Not
 * recorded (before <date>)", which is the honest answer to a safeguarding
 * question; inventing an inviter would be worse than the gap.
 *
 * Matched on the canonical address rather than the stored id, so a profile
 * whose Gmail spelling differs from the invitation's — dots, a `+tag`,
 * `googlemail.com` — still finds it. That mismatch is the reason the canonical
 * key exists at all.
 */
export async function backfillInvitedBy(
  db: FirestoreLike,
  options: { apply: boolean },
): Promise<{ stamped: Array<{ uid: string; invitedBy: string }>; unrecorded: string[] }> {
  const invitations = await db.collection(PATHS.invitations).get();
  const byAddress = new Map<string, string>();
  for (const entry of invitations.docs) {
    const record = (entry.data() ?? {}) as InvitationRecord;
    const address = record.email ?? record.redeemedEmail;
    if (typeof address !== 'string' || typeof record.invitedBy !== 'string') continue;
    if (!record.invitedBy) continue;
    byAddress.set(canonicalEmail(address), record.invitedBy);
  }

  const users = await db.collection(PATHS.users).get();
  const stamped: Array<{ uid: string; invitedBy: string }> = [];
  const unrecorded: string[] = [];

  for (const entry of users.docs) {
    const profile = entry.data() ?? {};
    if (profile.invitedBy != null) continue;

    const email = typeof profile.email === 'string' ? profile.email : '';
    const invitedBy = email ? byAddress.get(canonicalEmail(email)) : undefined;
    if (!invitedBy) {
      unrecorded.push(entry.id);
      continue;
    }

    stamped.push({ uid: entry.id, invitedBy });
    if (options.apply) {
      await db.doc(`${PATHS.users}/${entry.id}`).set({ invitedBy }, { merge: true });
    }
  }

  return { stamped, unrecorded };
}

