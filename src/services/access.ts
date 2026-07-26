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
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import { emailKey, type Invitation, type Role } from '@/types';

function toInvitation(snapshot: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): Invitation {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    email: typeof data.email === 'string' ? data.email : snapshot.id.replace(/,/g, '.'),
    role: (data.role === 'admin' || data.role === 'core' ? data.role : 'counselor') as Role,
    active: data.active !== false,
    invitedAt: toDateOrNull(data.invitedAt),
    invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : null,
    ...(typeof data.note === 'string' && data.note ? { note: data.note } : {}),
  };
}

/** Admin-only: the rules deny this read to everybody else. */
export function subscribeInvitations(
  onChange: (invitations: Invitation[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.invitations()), orderBy('email')),
    (snapshot) => onChange(snapshot.docs.map(toInvitation)),
    (error) => onError?.(error),
  );
}

/**
 * Invites an address, or changes the role on one already invited.
 *
 * Idempotent by construction: the document id is derived from the address, so
 * inviting the same person twice updates the invitation instead of creating a
 * second one that disagrees with the first.
 */
export async function inviteToTally(
  email: string,
  role: Role,
  invitedBy: string,
  note?: string,
): Promise<void> {
  const address = email.trim().toLowerCase();
  if (!address) throw new Error('An email address is required.');

  await setDoc(
    doc(db, paths.invitation(emailKey(address))),
    {
      email: address,
      role,
      active: true,
      invitedAt: serverTimestamp(),
      invitedBy,
      ...(note?.trim() ? { note: note.trim() } : {}),
    },
    { merge: true },
  );
}

/**
 * Pauses or restores an invitation.
 *
 * Only affects people who have not signed in yet — anybody who has is governed
 * by their profile from then on. Kept separate from deletion so an admin can
 * put a summer volunteer on hold without retyping their address in September.
 */
export async function setInvitationActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, paths.invitation(id)), { active });
}

export async function withdrawInvitation(id: string): Promise<void> {
  await deleteDoc(doc(db, paths.invitation(id)));
}
