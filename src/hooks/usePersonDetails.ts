/**
 * Parent contact and allergies for one student, fetched when a screen asks.
 *
 * Tally holds none of this. It lives in Planning Center, and the only way to
 * see it is to ask for one person at a time — which is the point: a follow-up
 * list of twenty students does not put twenty parents' phone numbers on a
 * screen, it puts them one tap away for the ones a leader is actually calling.
 *
 * Results are memoised for the session because a leader working down the MIA
 * list opens the same student more than once, and because the Cloud Function's
 * own cache has a TTL measured in seconds.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPersonDetails } from '@/services/functions';
import { personIdFromStudentId, type PcoPersonDetails, type Student } from '@/types';

const cache = new Map<string, PcoPersonDetails | null>();

/** Drops memoised details — call after a push links a visitor upstream. */
export function invalidatePersonDetails(studentId?: string): void {
  if (studentId) cache.delete(studentId);
  else cache.clear();
}

export interface PersonDetailsResult {
  details: PcoPersonDetails | null;
  loading: boolean;
  error: string | null;
  /**
   * True when there is nothing to fetch: a quick-added visitor who does not
   * exist in Planning Center yet has no details to look up, and saying so is
   * more useful than an empty result that looks like a failure.
   */
  unavailable: boolean;
  /** Fetches, if it has not already. Safe to call more than once. */
  load: () => void;
}

/**
 * @param student the student to look up, or null
 * @param eager when true, fetches on mount instead of waiting for `load`. Use
 *        on a detail screen that exists to show these fields; leave it off in a
 *        list, where fetching per row is exactly what this design avoids.
 */
export function usePersonDetails(student: Student | null, eager = false): PersonDetailsResult {
  const personId = student ? (student.pcoPersonId ?? personIdFromStudentId(student.id)) : null;
  const key = student?.id ?? '';

  const [details, setDetails] = useState<PcoPersonDetails | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(eager);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // A different student means a different answer; anything held is not it.
  useEffect(() => {
    setDetails(cache.get(key) ?? null);
    setError(null);
    setRequested(eager);
  }, [key, eager]);

  useEffect(() => {
    if (!requested || !personId || cache.has(key)) return;

    let stale = false;
    setLoading(true);

    getPersonDetails({ pcoPersonId: personId })
      .then((response) => {
        if (stale || cancelled.current) return;
        cache.set(key, response.data);
        setDetails(response.data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (stale || cancelled.current) return;
        // Not cached: an outage must not become a permanent "no contact".
        const code = (cause as { code?: string })?.code ?? '';
        setError(
          code.includes('permission-denied')
            ? 'Only the core team can see parent contact details.'
            : 'Could not reach Planning Center for these details.',
        );
      })
      .finally(() => {
        if (!stale && !cancelled.current) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [requested, personId, key]);

  const load = useCallback(() => setRequested(true), []);

  return {
    details: details ?? cache.get(key) ?? null,
    loading,
    error,
    unavailable: student !== null && personId === null,
    load,
  };
}
