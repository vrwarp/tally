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
