/**
 * Parent contact and allergies for one student, fetched as soon as a screen
 * that shows them mounts.
 *
 * Tally holds none of this. It lives in Planning Center, and it is read one
 * person at a time — a follow-up list of twenty students is twenty reads. That
 * used to be a reason to put each read behind a tap, on the grounds that a
 * leader only calls one or two of the twenty. It is not any more: the reads are
 * absorbed by a cache in front of Planning Center, so a screen whose whole job
 * is "who do I call, and how" can simply say so without asking first.
 *
 * Results are also memoised for the session, because a leader working down the
 * MIA list opens the same student more than once.
 */
import { useCallback, useEffect, useState } from 'react';
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
   * True once a read has settled.
   *
   * This is what separates "nobody has asked yet" from "we asked, and Planning
   * Center has no such person" — both of which leave `details` null, and only
   * one of which is worth putting on a screen. Without it, a person deleted or
   * merged upstream renders as a blank waiting-to-happen forever.
   */
  loaded: boolean;
  /**
   * True when there is nothing to fetch: a quick-added visitor who does not
   * exist in Planning Center yet has no details to look up, and saying so is
   * more useful than an empty result that looks like a failure.
   */
  unavailable: boolean;
  /** Asks again after a failure. Does nothing once an answer is held. */
  retry: () => void;
}

export function usePersonDetails(student: Student | null): PersonDetailsResult {
  const personId = student ? (student.pcoPersonId ?? personIdFromStudentId(student.id)) : null;
  const key = student?.id ?? '';

  const [details, setDetails] = useState<PcoPersonDetails | null>(() => cache.get(key) ?? null);
  const [loaded, setLoaded] = useState(() => cache.has(key));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by `retry`, purely to make the fetch effect run again. */
  const [attempt, setAttempt] = useState(0);

  // A different student means a different answer; anything held is not it.
  useEffect(() => {
    setDetails(cache.get(key) ?? null);
    setLoaded(cache.has(key));
    setError(null);
  }, [key]);

  useEffect(() => {
    if (!personId || cache.has(key)) return;

    // Covers both a superseded student and an unmount; the cleanup runs for
    // either, and a late answer to a question nobody is asking must not land.
    let stale = false;
    setLoading(true);

    getPersonDetails({ pcoPersonId: personId })
      .then((response) => {
        if (stale) return;
        cache.set(key, response.data);
        setDetails(response.data);
        setLoaded(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (stale) return;
        // Not cached: an outage must not become a permanent "no contact".
        const code = (cause as { code?: string })?.code ?? '';
        setError(
          code.includes('permission-denied')
            ? 'Only the core team can see parent contact details.'
            : 'Could not reach Planning Center for these details.',
        );
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [personId, key, attempt]);

  const retry = useCallback(() => {
    // Clearing the error here rather than in the effect is what lets the screen
    // show a spinner on the retry instead of the failure it is retrying.
    setError(null);
    setAttempt((count) => count + 1);
  }, []);

  return {
    details: details ?? cache.get(key) ?? null,
    loading,
    error,
    loaded: loaded || cache.has(key),
    unavailable: student !== null && personId === null,
    retry,
  };
}
