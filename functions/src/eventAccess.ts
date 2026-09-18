/**
 * Who may work a gathering, on the server.
 *
 * The predicate itself is shared — `generated/eventAccess.js` is a mechanical
 * copy of `src/lib/eventAccess.ts`, so the client, the callables and (restated,
 * because rules cannot import) `firestore.rules` all answer the question the
 * same way. What lives here is the reading: turning a chain key into the
 * document the predicate wants, without asking Firestore the same thing forty
 * times while paging one student's history.
 *
 * Deliberately *not* cached across invocations the way `readCaller` is. That
 * one holds a role and an `active` flag, which change when an admin edits the
 * team and are tolerable a few seconds stale. This is the fence itself: a
 * counselor removed from a gathering thirty seconds ago must not still be able
 * to page its register, and a *newly added* counselor must not be told no. The
 * memo below lives for one call and dies with it.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { canWorkChain, type ChainAccess } from './generated/eventAccess.js';

/** Mirrors `COLLECTIONS.eventAccess` in `src/lib/paths.ts`. */
const EVENT_ACCESS = 'eventAccess';

/**
 * One call's worth of access lookups.
 *
 * A page of history spans a handful of chains and dozens of nights, so the same
 * two or three documents would otherwise be read once per row.
 */
export class ChainAccessReader {
  private readonly seen = new Map<string, Promise<ChainAccess | undefined>>();

  constructor(
    private readonly firestore: Firestore,
    private readonly uid: string,
    private readonly isAdmin: boolean,
  ) {}

  private read(chain: string): Promise<ChainAccess | undefined> {
    const held = this.seen.get(chain);
    if (held) return held;

    const record = this.firestore
      .doc(`${EVENT_ACCESS}/${chain}`)
      .get()
      .then((snapshot) => {
        if (!snapshot.exists) return undefined;
        const data = snapshot.data() ?? {};
        return {
          restricted: data.restricted === true,
          members: Array.isArray(data.members)
            ? data.members.filter((uid: unknown): uid is string => typeof uid === 'string')
            : [],
        };
      });

    this.seen.set(chain, record);
    return record;
  }

  /**
   * `access` being undefined means no document, which means nobody has ever
   * restricted this gathering — the ordinary case, and the one every deployment
   * starts in.
   */
  async canWork(chain: string): Promise<boolean> {
    if (this.isAdmin) return true;
    return canWorkChain(await this.read(chain), this.uid, this.isAdmin);
  }

  /** Partitions a set of chains in one pass, for a caller that needs both halves. */
  async partition(chains: Iterable<string>): Promise<{ allowed: Set<string>; denied: Set<string> }> {
    const allowed = new Set<string>();
    const denied = new Set<string>();

    await Promise.all(
      [...new Set(chains)].map(async (chain) => {
        if (await this.canWork(chain)) allowed.add(chain);
        else denied.add(chain);
      }),
    );

    return { allowed, denied };
  }
}

/**
 * Which of a student's nights a caller may see, once the chains are in hand.
 *
 * Arithmetic on three arguments and nothing else: no reads, no callback that
 * might read. It lives here because `getStudentAttendance` cannot be tested
 * where it stands — that callable reaches for the raw `getFirestore()` to get
 * `collectionGroup`, which the narrowed fake the rest of the suite runs on
 * deliberately does not offer. The reading it does, and the "trust the event,
 * not the record" argument that justifies it, stay in the callable, because
 * that is what they are about.
 *
 * `eventIdsInOrder` is one entry per attendance document, newest first and with
 * repeats; the result keeps the first appearance of each event and drops the
 * rest, which is the order a profile draws its history in.
 *
 * `withheld` is rebuilt here in that same document order rather than taken from
 * `partition`'s `denied`, whose order is whichever read happened to finish
 * first. The caller only ever asks `withheld` whether it holds a chain, so the
 * order is not load-bearing either way, but document order costs nothing and is
 * what the one-read-per-record version used to return.
 *
 * An event id with no entry in `chainByEventId` stands for its own chain, the
 * same fallback the callable applies to an event document that does not exist.
 * A gap cannot quietly open the register: a chain nobody was granted is a chain
 * `allowed` does not hold, so the night is withheld rather than shown.
 */
export function partitionStudentHistory(
  eventIdsInOrder: Iterable<string>,
  chainByEventId: ReadonlyMap<string, string>,
  allowed: ReadonlySet<string>,
): { eventIds: string[]; withheld: string[] } {
  const eventIds: string[] = [];
  const shown = new Set<string>();
  const withheld: string[] = [];
  const refused = new Set<string>();

  for (const eventId of eventIdsInOrder) {
    const chain = chainByEventId.get(eventId) ?? eventId;

    if (allowed.has(chain)) {
      if (shown.has(eventId)) continue;
      shown.add(eventId);
      eventIds.push(eventId);
    } else if (!refused.has(chain)) {
      refused.add(chain);
      withheld.push(chain);
    }
  }

  return { eventIds, withheld };
}
