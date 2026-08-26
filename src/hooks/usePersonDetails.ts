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
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPersonDetails } from '@/services/functions';
import { backendLabelOf, personIdOfStudent, type PcoPersonDetails, type Student } from '@/types';

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
  /**
   * Drops the held answer and asks again — for after something has *changed*
   * upstream, which `retry` deliberately will not do.
   *
   * The distinction matters because the two are used in opposite situations. A
   * retry follows a failure, where the memo holds nothing and re-asking is free.
   * This follows a write, where the memo holds an answer that was true a second
   * ago and is now the one thing on screen that is wrong.
   */
  refresh: () => void;
}

export function usePersonDetails(student: Student | null): PersonDetailsResult {
  // Whichever backend holds them, not just Planning Center: the callable
  // dispatches on `studentId` and reads either, and gating on a Planning
  // Center person id told every Attendees student's screen there was nothing
  // to look up.
  const personId = student ? personIdOfStudent(student) : null;
  // Stryker disable next-line StringLiteral: with no student there is nobody
  // to look up, so this key is never handed to the cache or to the server. It
  // is a placeholder for a hook that is standing by.
  const key = student?.id ?? '';
  // A string, not the student object, so the fetch effect can depend on it
  // without re-running every time the roster hands down a new array.
  // Stryker disable next-line StringLiteral: only ever read into the failure
  // sentence, which needs a read, which needs a student.
  const backendLabel = student ? backendLabelOf(student) : 'the backend';

  // Stryker disable next-line ArrowFunction,LogicalOperator: what the caller
  // reads is `details ?? cache.get(key)`, so a session that already holds this
  // student answers from the memo whatever the state seeds. Seeding it anyway
  // is what stops the first frame being a render behind.
  const [details, setDetails] = useState<PcoPersonDetails | null>(() => cache.get(key) ?? null);
  /* Stryker disable next-line ArrowFunction: `loaded || cache.has(key)`, as above. */
  const [loaded, setLoaded] = useState(() => cache.has(key));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by `retry`, purely to make the fetch effect run again. */
  const [attempt, setAttempt] = useState(0);
  /*
   * Whether the next read must skip the server's held answer too.
   *
   * Set only by `refresh`, and that asymmetry is the point: a retry follows a
   * failure, where a few-seconds-old answer is a perfectly good one and cheaper
   * than asking again. A refresh follows a *write*, where the held answer is
   * the state from before the write and is the one thing on screen that is now
   * wrong. Dropping the browser's memo alone is not enough — the answer is held
   * on both sides of the wire.
   */
  const forceNext = useRef(false);

  // A different student means a different answer; anything held is not it.
  useEffect(() => {
    // Stryker disable next-line LogicalOperator: the getters below read the
    // memo too, so what this puts in state for a cached student is invisible.
    // It matters for the *uncached* one, where it is what clears the previous
    // student's answer off the screen.
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

    const force = forceNext.current;
    forceNext.current = false;

    // `studentId` is the shape the server dispatches on — it reads the
    // linkage and asks whichever backend holds the person. The bare id rides
    // along for compatibility; a server predating `studentId` reads only it,
    // and has always taken it to mean Planning Center.
    getPersonDetails({ studentId: key, pcoPersonId: personId, ...(force ? { force: true } : {}) })
      .then((response) => {
        if (stale) return;
        cache.set(key, response.data);
        // Stryker disable next-line CallExpression,BooleanLiteral: the memo was
        // filled on the line above and both getters read it, so none of these
        // three can be seen on its own. They are here because state is what
        // re-renders, and because a reader of this function should not have to
        // know that the getters cover for it.
        setDetails(response.data);
        setLoaded(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (stale) return;
        // Not cached: an outage must not become a permanent "no contact".
        // Stryker disable next-line StringLiteral,OptionalChaining: read only
        // by `includes`, which no sentinel matches.
        const code = (cause as { code?: string })?.code ?? '';
        setError(
          code.includes('permission-denied')
            ? 'Only the core team can see parent contact details.'
            : `Could not reach ${backendLabel} for these details.`,
        );
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [personId, key, attempt, backendLabel]);

  const retry = useCallback(() => {
    // Clearing the error here rather than in the effect is what lets the screen
    // show a spinner on the retry instead of the failure it is retrying.
    setError(null);
    // Stryker disable next-line ArithmeticOperator: a dependency of the fetch
    // effect and nothing else, so any change re-runs it.
    setAttempt((count) => count + 1);
  }, []);

  const refresh = useCallback(() => {
    // The memo is what the fetch effect checks before asking, so dropping it is
    // what turns the attempt bump below into a real read rather than a no-op.
    invalidatePersonDetails(key);
    forceNext.current = true;
    setError(null);
    /* Stryker disable next-line ArithmeticOperator: any change, as above. */
    setAttempt((count) => count + 1);
  }, [key]);

  return {
    details: details ?? cache.get(key) ?? null,
    loading,
    error,
    loaded: loaded || cache.has(key),
    unavailable: student !== null && personId === null,
    retry,
    refresh,
  };
}
