/**
 * Erasing a gathering — or a whole chain of them — with everything filed under it.
 *
 * Tally's deletions are otherwise deliberately timid. Cancelling is the
 * reversible thing and it keeps the attendance a dashboard is built from, so
 * the event page only ever offered a hard delete for a gathering nobody had
 * been checked into. That leaves two jobs with no way to do them at all: a
 * night that was recorded by mistake (the wrong Friday, a duplicate, a test
 * event somebody checked eleven students into), and a weekly gathering the
 * ministry has stopped running, whose rule keeps projecting Fridays onto the
 * calendar forever. Both are rare, both are destructive, and both need to
 * actually remove the history rather than orphan it.
 *
 * ## Why a callable and not a client write
 *
 * The security rules already let the core team delete an event document, so
 * this is not about permission. It is about what a delete has to *reach*.
 * Deleting a document in Firestore does not delete its subcollections: the
 * attendance and RSVP records under a gathering would survive it, unreadable
 * and uncountable, and every one of them would still be returned by the
 * collection-group queries the dashboard runs. A browser can be told to sweep
 * them first, but a browser at a church door is a device that goes through a
 * tunnel mid-sweep — and half a sweep is exactly the orphaned state the sweep
 * existed to prevent.
 *
 * A chain makes that worse by an order of magnitude. "Every past and future
 * Friday" is every event document whose `chainKey` matches, each with its own
 * attendance, which for a ministry two years in is a four-figure number of
 * deletes that has to be driven from one place that does not move.
 *
 * ## What "the whole chain" means
 *
 * Exactly what `chainKey` says it means — the same grouping the projection and
 * the predictive roster use, so "delete this repeating gathering" removes
 * precisely the set of nights the app has been treating as one gathering all
 * along. Future occurrences need no separate handling: they are not documents,
 * they are the rule speaking, and the rule lives on the chain's own instances.
 * Remove the last of them and the projection has nothing left to expand, so the
 * calendar ahead empties itself.
 */
import { chainKey } from './generated/materialize.js';
import { EVENTS } from './occurrences.js';
import type { DocumentSnapshotLike, FirestoreLike, FunctionLogger } from './firestore.js';

/**
 * Firestore's write batch tops out at 500 operations. Four hundred leaves room
 * to be wrong about that without failing a delete halfway through.
 */
const BATCH_LIMIT = 400;

/** What a delete is aimed at. Mirrors `DeletionTarget` in src/services/events.ts. */
export type DeletionTarget =
  /** One gathering, whatever else shares its chain. */
  | { scope: 'event'; eventId: string }
  /** Every gathering in one chain of repeats — see `chainKey`. */
  | { scope: 'chain'; chain: string };

export interface DeletionSummary {
  /** Event documents removed, or that would be. */
  events: number;
  /** Attendance records removed with them. This is the number that matters. */
  checkIns: number;
  rsvps: number;
  /**
   * One-off gatherings that were borrowing this chain's regulars and will stop.
   * Always zero for a single-event delete.
   */
  unlinked: number;
  /** What it is called, for the sentence the app puts in front of somebody. */
  title: string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Which chain a stored event belongs to.
 *
 * Read straight off the raw fields rather than through `toSource`, which
 * refuses a document with a missing timestamp. A corrupt event still occupies
 * the calendar and still has to be removable with the chain it belongs to;
 * being unprojectable is a reason to delete it, not a reason to leave it.
 */
function chainOf(doc: DocumentSnapshotLike): string {
  const data = doc.data() ?? {};
  return chainKey({
    id: doc.id,
    seriesId: str(data.seriesId),
    recurrenceRootId: str(data.recurrenceRootId),
  });
}

/** Everything one delete touches, as full document paths. */
interface Plan {
  events: string[];
  checkIns: string[];
  rsvps: string[];
  /** One-off events whose `predictFromChain` points at what is going. */
  unlink: string[];
  title: string | null;
}

async function childrenOf(firestore: FirestoreLike, eventId: string): Promise<Pick<Plan, 'checkIns' | 'rsvps'>> {
  const [attendance, rsvps] = await Promise.all([
    firestore.collection(`${EVENTS}/${eventId}/attendance`).get(),
    firestore.collection(`${EVENTS}/${eventId}/rsvps`).get(),
  ]);

  return {
    checkIns: attendance.docs.map((doc) => `${EVENTS}/${eventId}/attendance/${doc.id}`),
    rsvps: rsvps.docs.map((doc) => `${EVENTS}/${eventId}/rsvps/${doc.id}`),
  };
}

/**
 * What the request describes, read from the database rather than taken from the
 * caller. Null when the named event does not exist.
 *
 * The whole `events` collection is read for a chain, the way
 * `materializeOccurrence` reads it: `chainKey` is three fields with a fallback
 * order, not something a `where` clause can express in one query, and this
 * ministry's calendar is measured in hundreds of documents.
 */
async function planDeletion(
  firestore: FirestoreLike,
  target: DeletionTarget,
): Promise<Plan | null> {
  if (target.scope === 'event') {
    const snapshot = await firestore.doc(`${EVENTS}/${target.eventId}`).get();
    if (!snapshot.exists) return null;

    return {
      events: [`${EVENTS}/${target.eventId}`],
      ...(await childrenOf(firestore, target.eventId)),
      unlink: [],
      title: str(snapshot.data()?.title),
    };
  }

  const snapshot = await firestore.collection(EVENTS).get();
  const members = snapshot.docs.filter((doc) => chainOf(doc) === target.chain);

  const plan: Plan = { events: [], checkIns: [], rsvps: [], unlink: [], title: null };

  // The latest instance names the chain, for the same reason the projection
  // takes its template from there: a gathering renamed in March is called what
  // it is called now. Ties are broken by nothing in particular — two instances
  // on one day is not a thing a chain does.
  let latest = -Infinity;

  for (const doc of members) {
    const startAt = doc.data()?.startAt;
    const at =
      startAt instanceof Date
        ? startAt.getTime()
        : typeof (startAt as { toMillis?: () => number } | undefined)?.toMillis === 'function'
          ? (startAt as { toMillis: () => number }).toMillis()
          : -Infinity;
    if (at >= latest) {
      latest = at;
      plan.title = str(doc.data()?.title) ?? plan.title;
    }

    plan.events.push(`${EVENTS}/${doc.id}`);
    const children = await childrenOf(firestore, doc.id);
    plan.checkIns.push(...children.checkIns);
    plan.rsvps.push(...children.rsvps);
  }

  /*
   * Trips that borrowed these regulars.
   *
   * A one-off's `predictFromChain` is a pointer at a gathering, and the
   * gathering is about to stop existing. Left behind it is a dangling reference
   * that nothing in the app can render and nothing can clear from a screen —
   * the editor only offers chains that still have instances — so it is cleared
   * here, with the delete that caused it.
   */
  const going = new Set(members.map((doc) => doc.id));
  for (const doc of snapshot.docs) {
    if (going.has(doc.id)) continue;
    if (doc.data()?.predictFromChain === target.chain) plan.unlink.push(`${EVENTS}/${doc.id}`);
  }

  return plan;
}

/**
 * Runs the plan, children before parents.
 *
 * The order is the only interesting thing here. A run that dies halfway leaves
 * attendance under an event that still exists — untidy, visible, and fixed by
 * pressing the button again. The other order leaves attendance under an event
 * that does not, which is unreachable from every screen in the app and is
 * exactly the orphaning this whole module exists to avoid.
 */
async function apply(firestore: FirestoreLike, plan: Plan): Promise<void> {
  const deletions = [...plan.checkIns, ...plan.rsvps, ...plan.events];

  for (let index = 0; index < deletions.length; index += BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const path of deletions.slice(index, index + BATCH_LIMIT)) {
      batch.delete(firestore.doc(path));
    }
    await batch.commit();
  }

  for (let index = 0; index < plan.unlink.length; index += BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const path of plan.unlink.slice(index, index + BATCH_LIMIT)) {
      batch.update(firestore.doc(path), { predictFromChain: null });
    }
    await batch.commit();
  }
}

export interface DeleteOptions {
  /** False — the default — counts what would go without writing anything. */
  apply?: boolean;
}

/**
 * Deletes a gathering or a chain of them, or counts what that would remove.
 *
 * Returns null when `scope: 'event'` names an event that is not there, which
 * the callable turns into a refusal: it means the page somebody is looking at
 * describes a gathering the rules merely project, or one another device has
 * already removed. A chain with no documents is not an error — there is simply
 * nothing left to delete — and comes back as a summary of zeroes.
 *
 * The preview is the same code path deliberately. What the confirmation dialog
 * promises to delete has to be what the delete then deletes, and the only way
 * to guarantee that is for one function to answer both questions.
 */
export async function deleteEvents(
  firestore: FirestoreLike,
  target: DeletionTarget,
  logger: FunctionLogger,
  options: DeleteOptions = {},
): Promise<DeletionSummary | null> {
  const plan = await planDeletion(firestore, target);
  if (!plan) return null;

  if (options.apply) {
    await apply(firestore, plan);
    logger.info('Deleted gatherings', {
      scope: target.scope,
      events: plan.events.length,
      checkIns: plan.checkIns.length,
      rsvps: plan.rsvps.length,
      unlinked: plan.unlink.length,
    });
  }

  return {
    events: plan.events.length,
    checkIns: plan.checkIns.length,
    rsvps: plan.rsvps.length,
    unlinked: plan.unlink.length,
    title: plan.title,
  };
}
