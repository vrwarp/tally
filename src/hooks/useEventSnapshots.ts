import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAttendanceByEvent, type EventAttendanceIds } from '@/services/attendance';
import type { EventAttendanceSnapshot, TallyEvent } from '@/types';

/**
 * Attendance history is read once, not streamed.
 *
 * A Friday from three weeks ago will not change while a counselor is standing
 * at the door, so paying for a live listener per past event would be waste. The
 * results are memoised for the session because the predictive roster and the
 * dashboard ask for overlapping windows.
 */
const cache = new Map<string, EventAttendanceIds>();

/**
 * Events this session has been refused, so it stops asking.
 *
 * Beside the cache rather than in it, because the two answer different
 * questions and must never be confused: `cache` holds registers, this holds the
 * absence of permission to have one. A refusal is a settled fact about who the
 * reader is — unlike a network failure, asking again produces the same answer,
 * and asking again on every render produces it forever.
 *
 * Cleared with the cache: the one thing that changes a refusal is somebody
 * adding you to the gathering, and the access stream firing is what clears it.
 */
const refused = new Set<string>();

/**
 * Counts the times this session has been told to forget what it read.
 *
 * A read is asked of the world as it was when the question went out, and it can
 * land long after `invalidateSnapshotCache` fired — somebody editing a past
 * register on another device is exactly that shape. Writing the registers such a
 * read is carrying would put the very rows the invalidation was meant to drop
 * straight back into the cache, where they would be believed for the rest of the
 * session. So the epoch is captured with the request and compared when the
 * answer lands: the same number means the answer is still about the world the
 * question was asked of.
 */
let epoch = 0;

/** Drops cached history — call after editing attendance for a past event. */
export function invalidateSnapshotCache(eventId?: string): void {
  if (eventId) {
    cache.delete(eventId);
    refused.delete(eventId);
    /* Stryker disable next-line AssignmentOperator: which way the number moves
     * does not matter — nothing reads it, only whether it is still the one the
     * request in flight was issued under. */
    epoch += 1;
  } else {
    cache.clear();
    refused.clear();
    /* Stryker disable next-line AssignmentOperator: any change, as above. */
    epoch += 1;
  }
}

export interface EventSnapshotsResult {
  snapshots: EventAttendanceSnapshot[];
  /**
   * The events in `events` whose registers the reader may not see.
   *
   * Callers must not treat these as gatherings with nobody at them. There is no
   * entry in `snapshots` for any of them — deliberately, because an
   * `EventAttendanceSnapshot` with an empty `presentStudentIds` is a claim that
   * nobody came, and every derivation downstream believes it.
   */
  denied: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
}

/** Shared so a caller with nothing to ask for does not allocate a new one. */
const NO_DENIALS: ReadonlySet<string> = new Set<string>();

/**
 * Loads "who attended" for each of `events`.
 *
 * Callers pass an already-narrowed list (one series' recent instances, or the
 * dashboard's recent recurring window) — this hook does no selection of its own.
 */
export function useEventSnapshots(events: readonly TallyEvent[]): EventSnapshotsResult {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(events.length > 0);
  const [error, setError] = useState<string | null>(null);
  // Stryker disable next-line StringLiteral: this is only ever compared with a
  // request key, and no key is empty — a request is at least one event id — so
  // what the sentinel says does not matter, only that it is not a key.
  const inFlight = useRef<string>('');
  /** The request that already spent its one retry. See the catch below. */
  /* Stryker disable next-line StringLiteral: a sentinel, as above. */
  const failedKey = useRef<string>('');

  // Identity of the request, so re-renders with an equivalent list do not refetch.
  const key = useMemo(
    () =>
      events
        .map((event) => event.id)
        .sort()
        .join(','),
    [events],
  );

  useEffect(() => {
    if (events.length === 0) {
      setLoading(false);
      setError(null);
      return;
    }

    const missing = events
      .map((event) => event.id)
      .filter((id) => !cache.has(id) && !refused.has(id));
    if (missing.length === 0) {
      setLoading(false);
      return;
    }

    if (inFlight.current === key) return;
    inFlight.current = key;

    let cancelled = false;
    const startedAt = epoch;
    setLoading(true);

    fetchAttendanceByEvent(missing)
      .then((result) => {
        /*
         * Written down even when nobody is waiting for it any more.
         *
         * `cancelled` says the caller's list moved on, which is not the same
         * question as whether what landed is true. Treating it as if it were
         * threw away a register that had already been paid for, so the next
         * screen to ask about that night — the same one scrolling back, or the
         * grid reopened — paid for it a second time. What actually makes an
         * answer stale is the cache having been dropped underneath it, and the
         * epoch is what says that: see the note on it above.
         */
        let wrote = false;
        if (epoch === startedAt) {
          for (const [eventId, ids] of result.byEvent) {
            cache.set(eventId, ids);
            wrote = true;
          }
          // Remembered so the next render does not ask again. Nothing is written
          // to `cache` for these: an absent register and an empty one must not
          // become the same thing.
          for (const eventId of result.denied) {
            refused.add(eventId);
            wrote = true;
          }
        }
        if (cancelled) return;
        // Stryker disable next-line StringLiteral: anything that is not a
        // request key lets the next failure have its retry, which is the point.
        failedKey.current = '';
        setError(null);
        /*
         * When the answer moved something, or when it was thrown away.
         *
         * The bump is a dependency of the effect, so it puts this straight back
         * on the same question. Two very different cases want that and one
         * badly does not, so the condition has to tell them apart.
         *
         * A discarded answer — the epoch moved while it was out — has left the
         * cache exactly as it was, so the night is still unread and nobody is
         * going to ask again on its behalf: `key` has not changed, and the
         * effect only re-runs when `key` or `version` does. Without the bump
         * the hook sits at `loading: false` with no snapshots for the rest of
         * the session, which is the very wedge the sentinel fix above exists to
         * prevent. It is reachable from an ordinary tap: `forgetCachedHistory`
         * on the check-in screen invalidates tonight's gathering, and the epoch
         * is one number for the whole cache, so a history read for *past*
         * nights that happens to be in the air is discarded with it.
         *
         * An answer that moved nothing while the epoch held still is the case
         * that must not bump. `missing` is worked out from the cache, so it
         * comes back identical and the effect asks the same question again
         * immediately, at Firestore's expense, on a screen nobody is watching.
         * `fetchAttendanceByEvent` answers every id with a register or a
         * refusal so nothing in this app produces it, but the right response to
         * being told nothing is to stop asking rather than to ask faster — and
         * a stub that answers nothing reads five hundred times in fifty
         * milliseconds without this.
         */
        // Stryker disable next-line ArithmeticOperator: this is a dependency
        // of the effect and the memo below and nothing else, so any change
        // re-runs them and the direction is arbitrary.
        if (wrote || epoch !== startedAt) setVersion((current) => current + 1);
      })
      .catch((cause: Error) => {
        if (cancelled) return;
        setError(cause.message);

        /*
         * One automatic retry per request, and then it stops.
         *
         * This used to be none at all, by accident: `version` was bumped only
         * on success, `inFlight` was cleared in `finally`, and the effect
         * depends on `[key, version]` — so a single failed batch left the hook
         * wedged for the rest of the session, with no path back short of
         * navigating somewhere that asked for a different set of events. On a
         * phone walking into a church hall, one dropped request is ordinary.
         *
         * It stays at one because bumping unconditionally is a hot loop
         * against Firestore, on a screen nobody is watching. After that the
         * error is surfaced and the hook waits for the caller's list to change.
         *
         * A refusal never lands here — `fetchAttendanceByEvent` returns those
         * in `denied` — so what is being retried really is a failure.
         */
        if (failedKey.current !== key) {
          failedKey.current = key;
          /* Stryker disable next-line ArithmeticOperator: any change, as above. */
          setVersion((current) => current + 1);
        }
      })
      .finally(() => {
        /*
         * Released for a read whose caller moved on as well, which it was not.
         *
         * The sentinel says a read for this question is genuinely out, and this
         * is the moment it stops being out. Returning above this left it set
         * for the rest of the session, so asking the same question again — the
         * attendance grid shut mid-read and opened again is one mis-tap — was
         * dropped on the floor: no read, no spinner, and a screen that sits
         * empty while claiming to have finished.
         *
         * Only if it is still this request's, because a later run may have
         * claimed it for a question that is still in flight, and clearing that
         * one would send the same read out twice.
         */
        if (inFlight.current === key) {
          /* Stryker disable next-line StringLiteral: a sentinel, as above. */
          inFlight.current = '';
        }
        if (cancelled) {
          /*
           * And run the effect again now that it is free, because by here the
           * caller may well have come back to this very question and been
           * turned away at the sentinel. This is the only bump that can happen
           * while another read is out, and it is safe: the run it wakes asks
           * the sentinel first, so a question still being read is not read
           * twice. On a hook that has since unmounted it is a no-op in React
           * 18 and later.
           */
          /* Stryker disable next-line ArithmeticOperator: any change, as above. */
          setVersion((current) => current + 1);
          return;
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `key` is the stable identity of `events`; `version` re-runs after a cache fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  /*
   * The previous answer, handed back whenever the new one says the same thing.
   *
   * `events` is in the dependency list because the snapshots wrap its members,
   * but several callers derive that array from a ticking clock, so its identity
   * can change while its contents do not — and each entry here is a fresh
   * wrapper object either way. Republishing an equivalent list makes every
   * consumer recompute: the check-in screen rebuilds its entire roster from it.
   */
  // Stryker disable next-line ArrayDeclaration: whatever this starts as, the
  // first comparison below finds it different from a real answer and replaces
  // it. Empty is what is true before anything has been read.
  const last = useRef<EventAttendanceSnapshot[]>([]);

  const snapshots = useMemo(() => {
    const next = events
      .map((event) => ({ event, ids: cache.get(event.id) }))
      .filter((entry): entry is { event: TallyEvent; ids: EventAttendanceIds } =>
        entry.ids !== undefined,
      )
      // This hook reads whole registers, so the set is the register and an empty
      // one really does mean nobody came. `held` stays keyed to who was checked
      // *in*: a gathering nobody remembered to check out of still happened.
      .map<EventAttendanceSnapshot>((entry) => ({
        event: entry.event,
        presentStudentIds: entry.ids.present,
        checkedOutStudentIds: entry.ids.checkedOut,
        held: entry.ids.present.size > 0,
      }));

    const unchanged =
      next.length === last.current.length &&
      next.every(
        (entry, index) =>
          entry.event === last.current[index].event &&
          entry.presentStudentIds === last.current[index].presentStudentIds &&
          entry.checkedOutStudentIds === last.current[index].checkedOutStudentIds,
      );

    if (!unchanged) last.current = next;
    return last.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, events]);

  /*
   * Narrowed to what this caller asked about, so a screen showing Friday is not
   * handed a refusal about Sunday it has no way to interpret. Identity is kept
   * stable when empty, which is the case on every screen in a deployment where
   * nobody has restricted anything.
   */
  const denied = useMemo(() => {
    // Stryker disable next-line ConditionalExpression: the line below answers
    // `NO_DENIALS` for an empty set too. This is the fast path to it, on every
    // screen in a deployment where nobody has restricted anything.
    if (refused.size === 0) return NO_DENIALS;
    const mine = new Set(events.map((event) => event.id).filter((id) => refused.has(id)));
    return mine.size === 0 ? NO_DENIALS : mine;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, events]);

  return { snapshots, denied, loading, error };
}
