/**
 * Who may work each gathering.
 *
 * One document per repeat chain, shaped after `skippedNights` for the same
 * reason: the fact is about a gathering, not about a night, and most nights on
 * the calendar have no document to hang it on. A chain with no document is
 * open to the whole team, which is why nothing here creates one until somebody
 * actually restricts something — an "open" document would be a billed read on
 * every gated request, forever, saying nothing.
 *
 * ## Why the writes are transforms
 *
 * `arrayUnion` and `arrayRemove` rather than rewriting `members`, for the
 * reason `skippedNights.ts` gives about `skipped`: two people are plausibly
 * holding this sheet at once — Miriam trimming the list on the event page while
 * Priya adds a volunteer at the door — and a wholesale rewrite means whichever
 * phone saves second silently undoes the other. The rules cannot express
 * "transform only", so they check the shape and leave the atomicity here.
 *
 * The one write that is not a transform is `restrictChain`, which creates the
 * document. There is nothing to clobber when the document does not exist yet,
 * and the initial list is a deliberate choice the person just made on screen.
 */
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import type { EventAccess } from '@/types';

function toEventAccess(id: string, data: Record<string, unknown> | undefined): EventAccess {
  const members = Array.isArray(data?.members) ? data.members : [];

  return {
    id,
    chainKey: id,
    restricted: data?.restricted === true,
    // A set, because this is asked once per gathering per render on the chooser
    // and the sheet's search box tests it per keystroke.
    members: new Set(members.filter((uid): uid is string => typeof uid === 'string')),
    updatedAt: toDateOrNull(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : '',
  };
}

/**
 * Every access list, live.
 *
 * The whole collection rather than a query, because there is nothing to filter
 * on: the client needs to know about a gathering it is *not* on in order to
 * draw the locked row, so "only mine" would be exactly the wrong selection. It
 * stays small by construction — one document per restricted chain, and most
 * ministries restrict a handful.
 *
 * Keyed by `chainKey`, which is what every caller has: `canWorkChain` is asked
 * about an event, and `chainKey(event)` is the lookup.
 */
export function subscribeEventAccess(
  onChange: (access: Map<string, EventAccess>) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, paths.eventAccessCollection()),
    (snapshot) => {
      onChange(new Map(snapshot.docs.map((d) => [d.id, toEventAccess(d.id, d.data())])));
    },
    onError,
  );
}

/**
 * Closes a gathering to everybody but `members`.
 *
 * `members` must include the caller — the rules refuse a write that closes a
 * door from outside it, because nobody below an admin could then reopen it.
 * The UI pre-fills this list from whoever has recently taken the register, so
 * the default outcome of a mis-tap is "no change" rather than "the ministry is
 * locked out of Friday".
 */
export async function restrictChain(
  chainKey: string,
  members: readonly string[],
  uid: string,
): Promise<void> {
  await setDoc(
    doc(db, paths.eventAccess(chainKey)),
    {
      chainKey,
      restricted: true,
      members: [...new Set([...members, uid])],
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    },
    // Merge, because the chain may have been restricted and reopened before:
    // reopening keeps the list, and closing again should not lose whatever a
    // previous round added.
    { merge: true },
  );
}

/**
 * Reopens a gathering to the whole team, keeping the list.
 *
 * Deliberately not a delete — the rules refuse that outright. Changing your
 * mind twice should not mean rebuilding four names from memory, and the
 * document is cheap.
 */
export async function reopenChain(chainKey: string, uid: string): Promise<void> {
  await updateDoc(doc(db, paths.eventAccess(chainKey)), {
    restricted: false,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Adds somebody to a gathering.
 *
 * The counselor's verb, and the one that matters at a door: Priya is on Friday
 * Fellowship, Jo turns up, and nobody goes looking for an admin. Handing out
 * the access you already have is not an escalation, which is why the rules let
 * anybody on the gathering do it.
 */
export async function addChainMembers(
  chainKey: string,
  uids: readonly string[],
  uid: string,
): Promise<void> {
  if (uids.length === 0) return;
  await updateDoc(doc(db, paths.eventAccess(chainKey)), {
    members: arrayUnion(...uids),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Takes somebody off a gathering. Core team and up.
 *
 * Not symmetric with adding, which is why it is a separate call with a separate
 * rank behind it: handing over access you hold is one thing, evicting the
 * person who set the gathering up is another. The rules also refuse removing
 * *yourself*, so the caller cannot lock the door behind them.
 */
export async function removeChainMember(
  chainKey: string,
  memberUid: string,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, paths.eventAccess(chainKey)), {
    members: arrayRemove(memberUid),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
