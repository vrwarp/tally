/**
 * Who may sign in to Tally.
 *
 * An invitation is an admin saying "this Google address may sign in, as this".
 * It exists because authorisation has to be decided *before* the person first
 * appears: there is no `users/{uid}` document to grant a role on until they have
 * signed in, and rules rightly forbid anyone creating their own.
 *
 * The pair is worth keeping straight:
 *
 *   - `invitations/{emailKey}` — the allowlist. Written here, read by
 *     `provisionAccess` at the moment somebody signs in.
 *   - `users/{uid}` — the live authorisation, created by that callable. Roles
 *     are changed there (see `@/services/users`), and it is what the security
 *     rules read on every request.
 *
 * So deleting an invitation stops somebody *arriving*; it does not evict
 * anybody who already has. Removing access is deactivating the profile.
 *
 * ## The pause switch that used to be here
 *
 * An invitation carried an `active` flag, and the Team screen drew it as a
 * checkbox reading "may sign in". It is gone, because it only ever governed a
 * *first* sign-in: `provisionAccess` returns on the profile before it ever
 * reads the invitation, so on the row for anybody who had already arrived the
 * switch was a control over access that changed nothing. Two states for one
 * question — invited or not — and withdrawing already expresses the no.
 *
 * Documents written before the removal may still carry the field. Nothing reads
 * it, here or on the server: a value nobody can see must not be able to refuse
 * somebody at the door. `inviteToTally` deletes it from any document it
 * rewrites, so the field decays out of the collection on its own.
 */
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import { emailKey, type Invitation, type Role } from '@/types';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function toInvitation(snapshot: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): Invitation {
  const data = snapshot.data() ?? {};
  const link = data.kind === 'link';
  return {
    id: snapshot.id,
    /*
     * A link has no address until somebody redeems it, and its id is a hash —
     * so the fallback that reads an address out of the id is for the other
     * kind only. A link row is named by its label instead.
     */
    ...(link
      ? { kind: 'link' as const }
      : { email: typeof data.email === 'string' ? data.email : snapshot.id.replace(/,/g, '.') }),
    ...(typeof data.email === 'string' && link ? { email: data.email } : {}),
    role: (data.role === 'admin' || data.role === 'core' ? data.role : 'counselor') as Role,
    invitedAt: toDateOrNull(data.invitedAt),
    invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : null,
    ...(typeof data.note === 'string' && data.note ? { note: data.note } : {}),
    ...(typeof data.label === 'string' && data.label ? { label: data.label } : {}),
    tokenExpiresAt: toDateOrNull(data.tokenExpiresAt),
    gatherings: strings(data.gatherings),
    resolvedAt: toDateOrNull(data.resolvedAt),
    ...(typeof data.redeemedBy === 'string' ? { redeemedBy: data.redeemedBy } : {}),
    ...(typeof data.redeemedEmail === 'string' ? { redeemedEmail: data.redeemedEmail } : {}),
    ...(typeof data.redeemedName === 'string' ? { redeemedName: data.redeemedName } : {}),
    placed: strings(data.placed),
    skipped: strings(data.skipped),
  };
}

/**
 * Core and up: the rules deny this read to a counselor.
 *
 * Unordered on the wire, and sorted here. It used to `orderBy('email')`, which
 * is a filter as much as an order: Firestore drops from an ordered query every
 * document that lacks the field, so the day links arrived — a link has no
 * address until somebody redeems it — every link would have been missing from
 * the list that exists to show them. The collection is small enough that the
 * sort belongs on this side.
 */
export function subscribeInvitations(
  onChange: (invitations: Invitation[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, paths.invitations()),
    (snapshot) => onChange(snapshot.docs.map(toInvitation).sort(byInvitedAtThenName)),
    (error) => onError?.(error),
  );
}

/** Newest first, because the row somebody is looking for is the one they just made. */
function byInvitedAtThenName(a: Invitation, b: Invitation): number {
  const at = (b.invitedAt?.getTime() ?? 0) - (a.invitedAt?.getTime() ?? 0);
  if (at !== 0) return at;
  return (a.email ?? a.label ?? a.id).localeCompare(b.email ?? b.label ?? b.id);
}

/**
 * Invites an address, or changes the role on one already invited.
 *
 * Idempotent by construction: the document id is derived from the address, so
 * inviting the same person twice updates the invitation instead of creating a
 * second one that disagrees with the first.
 *
 * `active` is deleted rather than written, which is what retires the flag
 * described above from any document this touches — a rewrite that left it
 * behind would keep a value on the record that looks like it still decides
 * something. Deleting a field that is not there is not an error.
 */
export async function inviteToTally(
  email: string,
  role: Role,
  invitedBy: string,
  note?: string,
  /**
   * The chains to put them on at first sign-in — see `InvitationDoc`. Written
   * whole rather than merged: unticking a gathering on a re-invite has to be
   * able to take it off again.
   */
  gatherings: readonly string[] = [],
): Promise<void> {
  const address = email.trim().toLowerCase();
  if (!address) throw new Error('An email address is required.');

  await setDoc(
    doc(db, paths.invitation(emailKey(address))),
    {
      email: address,
      role,
      active: deleteField(),
      invitedAt: serverTimestamp(),
      invitedBy,
      gatherings: [...gatherings],
      ...(note?.trim() ? { note: note.trim() } : {}),
    },
    { merge: true },
  );
}

/**
 * Withdraws an invitation — an address one or a link.
 *
 * Never offered on a redeemed row: withdrawing would evict nobody and would
 * delete the only record of who arrived on it. The rules say the same.
 */
export async function withdrawInvitation(id: string): Promise<void> {
  await deleteDoc(doc(db, paths.invitation(id)));
}
