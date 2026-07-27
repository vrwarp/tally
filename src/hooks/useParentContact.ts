/**
 * Which students on the roster have a parent Tally could actually ring.
 *
 * Tally holds none of this and the roster does not carry it: a roster read
 * reports `profileComplete: null` — "we did not look" — because finding a
 * parent means reading households, and that is a second sweep in front of the
 * first name a counselor sees at a door. So the question is asked separately,
 * by the one screen that needs it, and the answer is a boolean per student with
 * no contact details in it at all.
 *
 * Held for the session, because the insights screen is opened, left and come
 * back to, and a leader working a call list should not re-ask the church's
 * whole adult directory each time. `refresh` is the way to ask again after
 * somebody has gone and filled a number in.
 */
import { useCallback, useEffect, useState } from 'react';
import { getParentContactStatus } from '@/services/functions';

/** Empty rather than absent, so callers never have to branch on "not asked yet". */
const NOTHING: ReadonlyMap<string, boolean> = new Map();

let held: ReadonlyMap<string, boolean> | null = null;

/** Drops the session's answer — call after a push links a visitor upstream. */
export function invalidateParentContact(): void {
  held = null;
}

export interface ParentContactResult {
  /**
   * Student id -> whether somebody can be reached about them.
   *
   * A student missing from the map is one nobody has an answer for: a quick-add
   * that exists only in Tally, or a roster entry Planning Center could not
   * resolve. Neither is a student with no parent contact, and the lists that
   * read this must not report them as one.
   */
  reachable: ReadonlyMap<string, boolean>;
  /** True until a read has settled, so a list can say it is still counting. */
  loading: boolean;
  loaded: boolean;
  /** Plain language, for a screen that has to admit it could not check. */
  error: string | null;
  /** Asks Planning Center again, ignoring anything held. */
  refresh: () => void;
}

export function useParentContact(): ParentContactResult {
  const [reachable, setReachable] = useState<ReadonlyMap<string, boolean>>(() => held ?? NOTHING);
  const [loaded, setLoaded] = useState(() => held !== null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by `refresh`, purely to make the fetch effect run again. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (held && attempt === 0) return;

    // Covers an unmount as well as a superseded attempt: a late answer to a
    // question nobody is asking must not land.
    let stale = false;
    setLoading(true);

    getParentContactStatus({ force: attempt > 0 })
      .then((response) => {
        const next = new Map(Object.entries(response.data.reachable ?? {}));
        held = next;
        if (stale) return;
        setReachable(next);
        setLoaded(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (stale) return;
        // Not held: an outage must not be remembered as "nobody has a parent".
        const code = (cause as { code?: string })?.code ?? '';
        setError(
          code.includes('permission-denied')
            ? 'Only the core team can see which profiles are incomplete.'
            : 'Could not reach Planning Center to check which profiles are incomplete.',
        );
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [attempt]);

  const refresh = useCallback(() => {
    setError(null);
    setAttempt((count) => count + 1);
  }, []);

  return { reachable, loading, loaded: loaded || held !== null, error, refresh };
}
