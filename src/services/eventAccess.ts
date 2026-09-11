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
 * The one write that is not a transform is `restrictChain`. It used to be a
 * merged `setDoc`, on the theory that it only ever created the document — but
 * a merge replaces an array field wholesale, and the document does exist the
 * second time round: a gathering that was narrowed in March, reopened for the
 * summer and narrowed again in September. So it runs as a transaction instead,
 * which reads what is there and unions rather than overwrites; see the
 * function for what exactly it keeps.
 */
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { fetchAttendance } from '@/services/attendance';
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
 * Who has actually been taking this gathering's register.
 *
 * The safety net under the one mistake this feature makes easiest. Nothing
 * stops a core member restricting *Friday Fellowship* — the gathering the whole
 * ministry works — and it is three taps. If the list started empty, or started
 * with only the person doing it, the default outcome of a mis-tap would be
 * locking out every counselor until an admin intervened.
 *
 * Starting from the people who have taken the register recently makes the
 * default outcome "no change": the gathering closes to exactly the set already
 * working it. Somebody restricting deliberately trims from there, which is less
 * work than building the list from memory anyway.
 *
 * Reads a handful of recent nights rather than a year. Three is enough to
 * distinguish the team from a one-off stand-in, and this runs while somebody
 * waits for a sheet to open.
 */
export async function recentRegisterTakers(
  events: readonly { id: string }[],
): Promise<Set<string>> {
  const takers = new Set<string>();

  const registers = await Promise.all(
    events.map(async (event) => {
      try {
        return await fetchAttendance(event.id);
      } catch {
        // One unreadable night should not stop the sheet opening; a shorter
        // suggestion is better than none, and the person can add anybody.
        return [];
      }
    }),
  );

  for (const records of registers) {
    for (const record of records) takers.add(record.checkedInBy);
  }

  /*
   * Not every value in here is a person. An import writes
   * `checkedInBy: 'planning-center'`, and any future route that is not a
   * counselor's thumb will write something of its own. Rather than guess at the
   * shape of a uid — Firebase's are opaque, and 'planning-center' would survive
   * most guesses — the caller intersects this with the team directory, which is
   * the only thing that actually knows who is a person.
   */
  return takers;
}

/**
 * Closes a gathering to everybody but `members` — and never erases anybody.
 *
 * `members` must include the caller — the rules refuse a write that closes a
 * door from outside it, because nobody below an admin could then reopen it —
 * so the caller is added here whatever the list says. The UI pre-fills the
 * list from whoever has recently taken the register and lets the person trim
 * it before the press, so the default outcome of a mis-tap is "no change"
 * rather than "the ministry is locked out of Friday".
 *
 * ## Why a transaction, and what `seenAtOpen` is for
 *
 * The list is a decision made on a sheet that has been open for a while, over
 * a document other phones can still write to. The sheet shows the kept list
 * and the ticks the person is trimming — but the volunteer Priya added at the
 * door sixty seconds ago, after the sheet last drew, is on the document and
 * not on the screen, and a write that replaced `members` with what was on the
 * screen would erase her without anybody seeing it happen. That is the one
 * case `arrayUnion` cannot express either: the person may also have *unticked*
 * somebody, which a union would put straight back.
 *
 * So the write reads the document first. Anybody on it who was not there when
 * the sheet opened (`seenAtOpen`) was added by somebody else in the meantime,
 * and is kept whatever the ticks say; anybody who *was* there and is unticked
 * is a deliberate trim and stays off. A document that does not exist yet is
 * written whole, exactly as chosen. The rules allow this shape — a core member
 * on the chain may rewrite the list — and the transaction is what makes the
 * decision made on a Tuesday unable to undo what happened at the door.
 */
export async function restrictChain(
  chainKey: string,
  members: readonly string[],
  uid: string,
  seenAtOpen: Iterable<string> = [],
): Promise<void> {
  const ref = doc(db, paths.eventAccess(chainKey));
  const seen = new Set(seenAtOpen);

  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    // Order matters only for the reader of the document: the chosen list
    // first, then the writer, then whoever arrived while the sheet was open.
    const next = new Set([...members, uid]);

    if (!current.exists()) {
      transaction.set(ref, {
        chainKey,
        restricted: true,
        members: [...next],
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
      return;
    }

    const stored = current.data()?.members;
    const live = Array.isArray(stored)
      ? stored.filter((member): member is string => typeof member === 'string')
      : [];
    for (const member of live) {
      if (!seen.has(member)) next.add(member);
    }

    transaction.update(ref, {
      restricted: true,
      members: [...next],
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  });
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
