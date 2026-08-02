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
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** False once the history is exhausted. */
  hasMore: boolean;
  error: Error | null;
  loadMore: () => void;
}

export function useStudentHistory(studentId: string | null): StudentHistoryState {
  const [entries, setEntries] = useState<StudentHistoryEntry[]>([]);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const cursor = useRef<StudentHistoryCursor | null>(null);
  /** Guards against a second page landing for the student we just left. */
  const readingFor = useRef<string | null>(null);

  useEffect(() => {
    // A different student is a different history. Everything resets, including
    // the cursor, which would otherwise page one student's records into
    // another's list.
    cursor.current = null;
    readingFor.current = studentId;
    setEntries([]);
    setStarted(false);
    setLoading(false);
    setHasMore(true);
    setError(null);
  }, [studentId]);

  const loadMore = useCallback(() => {
    if (!studentId) return;

    setStarted(true);
    setLoading(true);
    setError(null);

    const forStudent = studentId;
    void fetchStudentHistory(forStudent, cursor.current)
      .then((page) => {
        if (readingFor.current !== forStudent) return;
        cursor.current = page.cursor;
        setEntries((current) => [...current, ...page.entries]);
        setHasMore(page.hasMore);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (readingFor.current !== forStudent) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setLoading(false);
      });
  }, [studentId]);

  return { entries, started, loading, hasMore, error, loadMore };
}
