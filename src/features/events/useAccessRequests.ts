/**
 * Who is asking to be put on one gathering, on the screens that can answer.
 *
 * The subscription is deliberately narrow and deliberately conditional: it is
 * one gathering's rows, opened only where somebody is actually looking at that
 * gathering. A roster is the busiest screen in the app on a Friday evening and
 * this is the least urgent thing on it — nothing waits on an ask, nobody is
 * notified, and a counselor who pressed the button is already walking over.
 *
 * Two readers, wanting opposite halves:
 *
 *   - **Somebody on the gathering** wants the *outstanding* asks: the rows they
 *     could act on. `outstanding` is that, already filtered for cleared and for
 *     age — an ask is about tonight.
 *   - **The person who asked** wants their *own* row, cleared or not. Without
 *     the cleared one their screen cannot tell "nobody has looked" from
 *     "somebody has said no", which is the difference between walking over and
 *     pressing again next week. `mine` is that.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/authContext';
import { isOutstanding, subscribeChainRequests } from '@/services/accessRequests';
import type { AccessRequest } from '@/types';

export interface ChainRequests {
  /** Unanswered and still about tonight. Empty while the read is in flight. */
  outstanding: AccessRequest[];
  /** The reader's own row, answered or not, or null when they have not asked. */
  mine: AccessRequest | null;
  /**
   * Whether a snapshot has actually arrived.
   *
   * The difference between "nobody is asking" and "nobody has told us yet",
   * which matters to exactly one reader: the nudge. A toast that took its
   * baseline from the first *ask* it saw would swallow that ask — the arriving
   * row would look like history — and the nudge would never fire for the case
   * it exists for. It takes its baseline from this instead.
   */
  settled: boolean;
}

const NONE: ChainRequests = { outstanding: [], mine: null, settled: false };

/**
 * `enabled` is the sheet being open, or the locked page being the screen — a
 * closed sheet holds no listener. A `false` answers the empty shape rather
 * than a previous gathering's rows, so a chip cannot keep a dot from a
 * gathering the reader has navigated away from.
 */
export function useChainRequests(chain: string | null, enabled: boolean): ChainRequests {
  const { profile } = useAuth();
  const [rows, setRows] = useState<AccessRequest[] | null>(null);

  useEffect(() => {
    if (!enabled || !chain) {
      setRows(null);
      return;
    }
    /*
     * A failure is swallowed to `[]` rather than surfaced. Everything this
     * drives is additive — a dot, a row, a toast — so a dropped listener
     * means the screen behaves exactly as it did before asks existed, which
     * is the right failure for a feature nothing depends on.
     */
    return subscribeChainRequests(chain, setRows, () => setRows([]));
  }, [chain, enabled]);

  const uid = profile?.id ?? '';
  return useMemo(() => {
    if (!rows) return NONE;
    const nowMs = Date.now();
    return {
      outstanding: rows
        .filter((row) => row.uid !== uid && isOutstanding(row, nowMs))
        .sort((a, b) => (a.askedAt?.getTime() ?? 0) - (b.askedAt?.getTime() ?? 0)),
      mine: rows.find((row) => row.uid === uid) ?? null,
      settled: true,
    };
  }, [rows, uid]);
}
