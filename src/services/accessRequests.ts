/**
 * Asking to be put on a gathering, and what that is deliberately not.
 *
 * It is not a queue, an approval, or a notification. Nothing waits on one of
 * these documents and nobody is obliged to answer: a counselor who presses
 * **Ask to be added** still walks over and asks out loud, exactly as they do
 * today, and all the row buys them is that their name is one tap on the roster
 * instead of a search through it. Every word on the surfaces that read this
 * avoids "request", "pending" and "asked" for that reason — anything shaped
 * like a workflow is a promise the design does not make.
 *
 * Two properties are load-bearing:
 *
 *   - **One document per pair.** The id is `{chainKey}__{uid}`, so pressing
 *     twice addresses the row that already exists rather than stacking a
 *     second claim on somebody else's screen.
 *   - **Clearing marks rather than deletes.** Otherwise the asker cannot tell
 *     "nobody has looked" from "somebody has said no", and presses again next
 *     week. The mark is what lets their own screen say "Miriam cleared this at
 *     7:01 — ask her in person".
 */
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { accessRequestId, paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import type { AccessRequest } from '@/types';

/**
 * How long a row is worth showing.
 *
 * An ask is about tonight. A fortnight-old one on a roster is a claim nobody
 * can act on and a name whose situation has moved; the person page shows the
 * week's unanswered ones to somebody who can do something on a Tuesday, and
 * after that they are swept.
 */
export const ACCESS_REQUEST_LIFE_MS = 7 * 86_400_000;

function toAccessRequest(snapshot: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): AccessRequest {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    chainKey: typeof data.chainKey === 'string' ? data.chainKey : '',
    uid: typeof data.uid === 'string' ? data.uid : '',
    name: typeof data.name === 'string' ? data.name : '',
    askedAt: toDateOrNull(data.askedAt),
    clearedBy: typeof data.clearedBy === 'string' ? data.clearedBy : null,
    clearedAt: toDateOrNull(data.clearedAt),
  };
}

/**
 * Every ask on one gathering, cleared ones included.
 *
 * Cleared rows come through on purpose: the asker's own screen is the one
 * place that has to say a clear happened, and hiding them here would leave it
 * unable to tell that from silence. The surfaces that show *outstanding* asks
 * filter on `clearedAt` themselves.
 */
export function subscribeChainRequests(
  chainKey: string,
  onChange: (requests: AccessRequest[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.accessRequestsCollection()), where('chainKey', '==', chainKey)),
    (snapshot) => onChange(snapshot.docs.map(toAccessRequest)),
    (error) => onError?.(error),
  );
}

/** Whether a row is still asking, as against answered or too old to mean anything. */
export function isOutstanding(request: AccessRequest, nowMs: number): boolean {
  if (request.clearedAt) return false;
  const asked = request.askedAt?.getTime();
  return asked === undefined || nowMs - asked < ACCESS_REQUEST_LIFE_MS;
}

/**
 * Puts somebody's name on the Add list for a gathering.
 *
 * Written as themselves — the rules pin `uid` to the caller — and idempotent,
 * because the id is the pair. A second press re-stamps `askedAt`, which is the
 * honest reading of pressing again: it is the same ask, today.
 */
export async function askToBeAdded(
  chainKey: string,
  uid: string,
  name: string,
): Promise<void> {
  await setDoc(doc(db, paths.accessRequest(chainKey, uid)), {
    chainKey,
    uid,
    name: name.slice(0, 120),
    askedAt: serverTimestamp(),
  });
}

/**
 * Marks an ask answered. Anybody on the gathering, or the asker taking it back.
 *
 * `updateDoc` rather than a merged `set`, because the rules admit a change to
 * exactly these two fields and a whole-document write reads as touching every
 * key — which is also what stops a clear quietly rewriting who asked.
 */
export async function clearAccessRequest(
  chainKey: string,
  uid: string,
  clearedBy: string,
): Promise<void> {
  await updateDoc(doc(db, paths.accessRequest(chainKey, uid)), {
    clearedBy,
    clearedAt: serverTimestamp(),
  });
}

export { accessRequestId };
