/**
 * Counselor / core-team profile documents.
 *
 * A Firebase Auth account by itself grants nothing. Access is decided by the
 * `users/{uid}` document, which an admin creates ahead of time (or approves
 * afterwards). Firestore rules read this document on every request, so a
 * revoked counselor loses access on their next operation, not at next login.
 */
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
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
import { toUserProfile } from '@/services/converters';
import type { Role, UserProfile } from '@/types';

/** Where a profile snapshot came from. `fromCache` means "nobody has asked the server yet". */
export interface ProfileSource {
  fromCache: boolean;
}

export function subscribeUserProfile(
  uid: string,
  onChange: (profile: UserProfile | null, source: ProfileSource) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, paths.user(uid)),
    /*
     * Metadata changes matter on this one document.
     *
     * "No document, from the local cache" and "no document, confirmed by the
     * server" carry identical data and opposite meanings: the first is *not
     * yet*, the second is *not authorised*. Without this flag the SDK treats
     * the move between them as a metadata-only change and never delivers it,
     * so a counselor whose first read missed would stay unauthorised until
     * they thought to reload.
     */
    { includeMetadataChanges: true },
    (snapshot) =>
      onChange(snapshot.exists() ? toUserProfile(snapshot) : null, {
        fromCache: snapshot.metadata.fromCache,
      }),
    (error) => onError?.(error),
  );
}

/**
 * A one-shot, server-authoritative read of one profile.
 *
 * `getDocFromServer`, not `getDoc`: this is what the app calls when the live
 * listener has not produced something there is good reason to believe exists,
 * and a cached "no such document" is the exact answer that got it here.
 */
export async function getUserProfileFromServer(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDocFromServer(doc(db, paths.user(uid)));
  return snapshot.exists() ? toUserProfile(snapshot) : null;
}

export function subscribeUsers(
  onChange: (users: UserProfile[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.users()), orderBy('email')),
    (snapshot) => onChange(snapshot.docs.map(toUserProfile)),
    (error) => onError?.(error),
  );
}

/**
 * Best-effort "last seen" ping on sign-in. Failure is swallowed: a counselor
 * whose profile is momentarily unwritable should still be able to check
 * students in.
 */
export async function touchLastSeen(uid: string): Promise<void> {
  try {
    await updateDoc(doc(db, paths.user(uid)), { lastSeenAt: serverTimestamp() });
  } catch {
    /* non-critical */
  }
}

/** Admin-only: invite or update a team member. */
export async function upsertUser(
  uid: string,
  patch: {
    email: string;
    displayName?: string | null;
    role: Role;
    active: boolean;
  },
): Promise<void> {
  const ref = doc(db, paths.user(uid));
  const existing = await getDoc(ref);

  const payload: Record<string, unknown> = {
    email: patch.email.trim().toLowerCase(),
    displayName: patch.displayName?.trim() || null,
    role: patch.role,
    active: patch.active,
  };
  // Never re-stamp `createdAt` on an edit — it is the record of when someone
  // joined the team.
  if (!existing.exists()) {
    payload.createdAt = serverTimestamp();
    payload.lastSeenAt = null;
  }

  await setDoc(ref, payload, { merge: true });
}
