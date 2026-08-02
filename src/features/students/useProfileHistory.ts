/**
 * A year of one student's attendance, without reading a year of registers.
 *
 * The profile asks two different questions of every night, and they have
 * different shapes. "Was this student here?" is a fact about the student, and
 * their own attendance documents answer it for a whole year in one indexed
 * query. "Did this gathering happen at all?" is a fact about the gathering, and
 * `skippedNights` answers it for a whole chain in one document.
 *
 * Neither of those is per-night, which is the point: the old path read every
 * finished night's register to derive both, so a year across a few gatherings
 * cost a few hundred reads on every profile, on every device, to learn a handful
 * of dates that never change.
 *
 * What is left over is nights no registry covers yet — a chain nobody has
 * examined, or one examined over a shorter window than this one. Those are read
 * directly, exactly as before, and then written down so the next person does not
 * pay for them. The first profile opened after a deploy pays; nobody else does.
 *
 * The snapshots this produces are projections: `presentStudentIds` holds at most
 * the subject student, and `held` — not the size of that set — is what says
 * whether the night happened. See the note on `EventAttendanceSnapshot`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAttendanceByEvent, fetchStudentAttendanceSince } from '@/services/attendance';
import {
  fetchSkippedNights,
  outcomeOf,
  recordExamination,
  type SkippedNights,
} from '@/services/skippedNights';
import { chainKey } from '@/lib/materialize';
import type { EventAttendanceSnapshot, Student, TallyEvent } from '@/types';

export interface ProfileHistoryResult {
  snapshots: EventAttendanceSnapshot[];
  loading: boolean;
  error: string | null;
}

/**
 * A one-off has no chain to summarise — `chainKey` falls back to its own id, so
 * a registry for it would be one document per event and save nothing. The few
 * of them in a year are read directly.
 */
function isChained(event: TallyEvent): boolean {
  return event.mode !== 'oneoff';
}

interface Resolved {
  /** Nights the student was checked into. */
  attended: ReadonlySet<string>;
  /** Nights known to have happened, whatever this student did. */
  held: ReadonlySet<string>;
}

/**
 * Works out, for every night in `events`, whether it happened and whether the
 * student was there — reading as little as it can get away with.
 */
async function resolve(
  student: Student,
  events: readonly TallyEvent[],
  windowStart: Date,
): Promise<Resolved> {
  const chained = events.filter(isChained);
  const chains = [...new Set(chained.map(chainKey))];

  const [registries, attended] = await Promise.all([
    chains.length > 0 ? fetchSkippedNights(chains) : Promise.resolve(new Map<string, SkippedNights>()),
    fetchStudentAttendanceSince(student.id, windowStart),
  ]);

  const held = new Set<string>();
  const unexamined: TallyEvent[] = [];

  for (const event of events) {
    if (!isChained(event)) {
      unexamined.push(event);
      continue;
    }

    switch (outcomeOf(registries.get(chainKey(event)), event)) {
      case 'held':
        held.add(event.id);
        break;
      case 'skipped':
        break;
      case 'unknown':
        unexamined.push(event);
        break;
    }
  }

  if (unexamined.length === 0) return { attended, held };

  // The nights nobody has looked at yet. Read as they always were, then written
  // down so this is the last time anybody pays for them.
  const registers = await fetchAttendanceByEvent(unexamined.map((event) => event.id));
  for (const [eventId, ids] of registers) {
    if (ids.size > 0) held.add(eventId);
  }

  await recordExaminations(unexamined, registers, registries, windowStart);

  return { attended, held };
}

/**
 * Writes down what the direct reads found, one document write per chain.
 *
 * The watermark claims `windowStart`, and that claim is sound because every
 * night of the window is known by the time this runs: the ones the registry
 * already covered, plus the ones just read. A failure here is deliberately
 * swallowed — the answer on screen is already correct, and a profile must not
 * break because a derived cache could not be updated.
 */
async function recordExaminations(
  unexamined: readonly TallyEvent[],
  registers: ReadonlyMap<string, ReadonlySet<string>>,
  registries: ReadonlyMap<string, SkippedNights>,
  windowStart: Date,
): Promise<void> {
  const byChain = new Map<string, { skipped: string[]; held: string[] }>();

  for (const event of unexamined) {
    if (!isChained(event)) continue;
    const key = chainKey(event);
    const bucket = byChain.get(key) ?? { skipped: [], held: [] };
    (registers.get(event.id)?.size ? bucket.held : bucket.skipped).push(event.id);
    byChain.set(key, bucket);
  }

  await Promise.all(
    [...byChain].map(async ([key, { skipped, held }]) => {
      try {
        await recordExamination({
          chainKey: key,
          examinedFrom: windowStart,
          skipped,
          held,
          known: registries.get(key),
        });
      } catch {
        // Derived data. Worth retrying next time somebody looks, not worth a
        // banner on a page whose numbers are already right.
      }
    }),
  );
}

export function useProfileHistory(
  student: Student | null,
  events: readonly TallyEvent[],
  windowStart: Date,
): ProfileHistoryResult {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef('');

  // The stable identity of the question, so a ticking clock does not re-ask it.
  // `windowStart` moves every minute by construction and is deliberately absent:
  // a year's worth of history does not change because the far edge slid by sixty
  // seconds, and including it would re-read everything once a minute.
  const key = useMemo(
    () =>
      student
        ? `${student.id}:${events
            .map((event) => event.id)
            .sort()
            .join(',')}`
        : '',
    [student, events],
  );

  const latestWindowStart = useRef(windowStart);
  latestWindowStart.current = windowStart;

  useEffect(() => {
    if (!student || events.length === 0) {
      setResolved(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (inFlight.current === key) return;
    inFlight.current = key;

    let cancelled = false;
    setLoading(true);

    resolve(student, events, latestWindowStart.current)
      .then((next) => {
        if (cancelled) return;
        setResolved(next);
        setError(null);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (cancelled) return;
        inFlight.current = '';
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /*
   * The previous answer, handed back whenever the new one says the same thing —
   * the same reason `useEventSnapshots` does it. The events arrive from a
   * ticking clock, so this array is rebuilt once a minute out of unchanged
   * parts, and republishing it makes the whole page recompute its groups.
   */
  const last = useRef<EventAttendanceSnapshot[]>([]);

  const snapshots = useMemo(() => {
    if (!student || !resolved) return last.current.length === 0 ? last.current : (last.current = []);

    const next = events.map<EventAttendanceSnapshot>((event) => ({
      event,
      // At most the subject student. This is a projection, not a register.
      presentStudentIds: resolved.attended.has(event.id) ? new Set([student.id]) : new Set(),
      held: resolved.held.has(event.id),
    }));

    const unchanged =
      next.length === last.current.length &&
      next.every(
        (entry, index) =>
          entry.event === last.current[index].event &&
          entry.held === last.current[index].held &&
          entry.presentStudentIds.has(student.id) ===
            last.current[index].presentStudentIds.has(student.id),
      );

    if (!unchanged) last.current = next;
    return last.current;
  }, [events, resolved, student]);

  return { snapshots, loading, error };
}
