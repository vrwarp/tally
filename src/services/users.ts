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

export function subscribeUserProfile(
  uid: string,
  onChange: (profile: UserProfile | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, paths.user(uid)),
    (snapshot) => onChange(snapshot.exists() ? toUserProfile(snapshot) : null),
    (error) => onError?.(error),
  );
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(db, paths.user(uid)));
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
    assignedGroupId?: string | null;
    active: boolean;
  },
): Promise<void> {
  const ref = doc(db, paths.user(uid));
  const existing = await getDoc(ref);

  const payload: Record<string, unknown> = {
    email: patch.email.trim().toLowerCase(),
    displayName: patch.displayName?.trim() || null,
    role: patch.role,
    assignedGroupId: patch.assignedGroupId || null,
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

/** Lets a counselor pick which small group they are teaching this term. */
export async function setAssignedGroup(uid: string, groupId: string | null): Promise<void> {
  await updateDoc(doc(db, paths.user(uid)), { assignedGroupId: groupId || null });
}
