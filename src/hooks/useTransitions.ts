/**
 * The aging-out record, live, for the screens that read it.
 *
 * Mounted by the dashboard and the student page — the record's only readers —
 * and deliberately not by `DataProvider`: the check-in screen's promise is
 * that this feature adds nothing to what a door pays for, and a provider-wide
 * subscription would bill every counselor's phone for a dashboard concern.
 *
 * Fails open, jointly with everything that reads it: an error here means "no
 * releases", so the chain MIA row stays and the unseen shield stays — today's
 * behaviour, with nobody silenced. The chain row is the fallback for the row a
 * release would have resolved.
 */
import { useEffect, useState } from 'react';
import { subscribeTransitions } from '@/services/transitions';
import type { Transition } from '@/types';

const NONE: Transition[] = [];

export function useTransitions(): { transitions: Transition[]; error: string | null } {
  const [transitions, setTransitions] = useState<Transition[]>(NONE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeTransitions(
      (next) => {
        setTransitions(next);
        setError(null);
      },
      (cause) => {
        setTransitions(NONE);
        setError(cause.message);
      },
    );
    return unsubscribe;
    /*
     * Subscribes once and lives as long as the screen. Any *constant* array
     * does that, so a mutant that fills this one behaves identically: there is
     * no render at which the two differ, and no test can tell them apart.
     */
    // Stryker disable next-line ArrayDeclaration: equivalent, see above.
  }, []);

  return { transitions, error };
}
