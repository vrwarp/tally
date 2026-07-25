/**
 * Planning Center sync state and the access allowlist — read-only from the app.
 *
 * Both collections are written exclusively by Cloud Functions: the client has
 * no Planning Center credentials, and letting a browser edit `accessRoster`
 * would turn the allowlist into a self-service one. The UI therefore only
 * observes, and every change originates from a sync run or the `provisionAccess`
 * callable.
 */
import { collection, doc, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toAccessRosterEntry, toPcoSyncState } from '@/services/converters';
import { EMPTY_PCO_COUNTS, type AccessRosterEntry, type PcoSyncState } from '@/types';

/**
 * What to report before a sync has ever run.
 *
 * A missing document means Planning Center has not been configured yet, which
 * is a setup step rather than a failure — so it gets its own status instead of
 * an error the core team cannot act on.
 */
const NEVER_SYNCED: PcoSyncState = {
  status: 'never',
  startedAt: null,
  finishedAt: null,
  cursor: null,
  lastFullSyncAt: null,
  counts: EMPTY_PCO_COUNTS,
  lastError: null,
  rosterSource: 'grade',
  writeBack: 'create',
  triggeredBy: null,
};

export function subscribePcoSyncState(
  onChange: (state: PcoSyncState) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, paths.pcoSync()),
    (snapshot) => onChange(snapshot.exists() ? toPcoSyncState(snapshot) : NEVER_SYNCED),
    (error) => onError?.(error),
  );
}

/** Who Planning Center says may sign in, ordered the way the team list reads it. */
export function subscribeAccessRoster(
  onChange: (entries: AccessRosterEntry[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.accessRoster()), orderBy('email')),
    (snapshot) => onChange(snapshot.docs.map(toAccessRosterEntry)),
    (error) => onError?.(error),
  );
}
