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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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
      ...(note?.trim() ? { note: note.trim() } : {}),
    },
    { merge: true },
  );
}

export async function withdrawInvitation(id: string): Promise<void> {
  await deleteDoc(doc(db, paths.invitation(id)));
}
