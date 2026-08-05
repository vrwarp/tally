/**
 * A student's attendance, reaching past the calendar the app keeps loaded.
 *
 * Deliberately lazy: nothing is read until somebody asks. The profile already
 * answers the common question — the last few nights of each gathering, with
 * misses — from events that are in memory anyway, and that answer costs
 * nothing extra. This is the other question, "when *has* this student come",
 * and it is asked rarely enough that paying a page of reads for it on every
 * profile open would be a poor trade.
 *
 * Paged rather than whole for the same reason: a student with two years of
 * imported history has a hundred-odd records, and a leader looking for when
 * somebody started usually finds it in the first twenty.
 *
 * ## More than one id
 *
 * A student who absorbed a duplicate is one child with two document ids, and
 * attendance is never re-keyed when they are merged — deliberately, because
 * re-keying is a write per night against records that have already been
 * reported on. So the *read* is what puts the two halves back together: one
 * cursor per id, a page from each, merged newest-first.
 *
 * The consequence is worth stating plainly, because it is visible. Each stream
 * pages independently, so a later page of one can carry rows older than nothing
 * and newer than everything already shown — the list re-sorts and rows appear
 * in the middle rather than at the end. The alternative is a lookahead merge
 * that fetches ahead of what it shows, which costs reads to make the scroll
 * tidier. Showing every night, in order, in the fewest reads, is the trade
 * taken. "Show more" is exhausted only when every stream is.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchStudentHistory,
  type StudentHistoryCursor,
  type StudentHistoryEntry,
} from '@/services/attendance';

export interface StudentHistoryState {
  entries: StudentHistoryEntry[];
  /** True once anything has been asked for — the button becomes a list. */
  started: boolean;
  loading: boolean;
  /** False once every stream is exhausted. */
  hasMore: boolean;
  error: Error | null;
  loadMore: () => void;
}

function timeOf(entry: StudentHistoryEntry): number {
  return (entry.event?.startAt ?? entry.record.checkedInAt).getTime();
}

export function useStudentHistory(
  studentId: string | readonly string[] | null,
): StudentHistoryState {
  const ids = useMemo(() => {
    if (studentId === null) return [] as string[];
    const list = typeof studentId === 'string' ? [studentId] : [...studentId];
    return [...new Set(list.filter((id) => id.length > 0))];
  }, [studentId]);
  // The array identity changes on every render of a caller that builds it
  // inline; the *key* is what the effects below should turn on.
  const key = ids.join('|');

  const [entries, setEntries] = useState<StudentHistoryEntry[]>([]);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /** Per id: the next cursor, or `done` once that stream is exhausted. */
  const cursors = useRef<Map<string, StudentHistoryCursor | null | 'done'>>(new Map());
  /** Guards against a page landing for the student we just left. */
  const readingFor = useRef<string | null>(null);

  useEffect(() => {
    // A different student is a different history. Everything resets, including
    // the cursors, which would otherwise page one student's records into
    // another's list.
    cursors.current = new Map();
    readingFor.current = key;
    setEntries([]);
    setStarted(false);
    setLoading(false);
    setHasMore(true);
    setError(null);
  }, [key]);

  const loadMore = useCallback(() => {
    if (ids.length === 0) return;

    setStarted(true);
    setLoading(true);
    setError(null);

    const forKey = key;
    const live = ids.filter((id) => cursors.current.get(id) !== 'done');

    void Promise.all(
      live.map(async (id) => {
        const cursor = cursors.current.get(id);
        const page = await fetchStudentHistory(id, cursor === 'done' ? null : (cursor ?? null));
        return { id, page };
      }),
    )
      .then((pages) => {
        if (readingFor.current !== forKey) return;
        const fresh: StudentHistoryEntry[] = [];
        for (const { id, page } of pages) {
          cursors.current.set(id, page.hasMore && page.cursor ? page.cursor : 'done');
          fresh.push(...page.entries);
        }
        setEntries((current) => [...current, ...fresh].sort((a, b) => timeOf(b) - timeOf(a)));
        setHasMore(ids.some((id) => cursors.current.get(id) !== 'done'));
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (readingFor.current !== forKey) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setLoading(false);
      });
  }, [ids, key]);

  return { entries, started, loading, hasMore, error, loadMore };
}
