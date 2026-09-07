/**
 * A student's whole attendance, paged, across however many ids they have.
 *
 * A student who absorbed a duplicate is one child with two document ids, and
 * attendance is deliberately never re-keyed when they are merged. So the read
 * is what puts the halves back together: one cursor per id, a page from each,
 * merged newest-first — and "show more" is exhausted only when every stream is.
 *
 * The other half of what is asserted here is laziness. Nothing is read until
 * somebody asks, and switching students throws everything away — a page landing
 * for the student a leader has just navigated away from must not appear under
 * the one they are looking at now.
 */
import { act, renderHook, waitFor } from '@/test/rtl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudentHistory } from '@/hooks/useStudentHistory';
import { makeAttendance, makeEvent } from '../../tests/factories';
import type { StudentHistoryEntry, StudentHistoryPage } from '@/services/attendance';

const fetchStudentHistory = vi.hoisted(() => vi.fn());

vi.mock('@/services/attendance', () => ({ fetchStudentHistory }));

/** One night, dated so the merge order is visible. */
function entry(id: string, day: number): StudentHistoryEntry {
  const startAt = new Date(2026, 1, day, 19, 0);
  return {
    record: makeAttendance({ id, checkedInAt: startAt }),
    event: makeEvent({ id: `event-${id}`, startAt }),
  };
}

function page(entries: StudentHistoryEntry[], hasMore: boolean): StudentHistoryPage {
  return {
    entries,
    cursor: hasMore ? { checkedInAt: 0, path: `after-${entries.at(-1)?.record.id}` } : null,
    hasMore,
    withheld: new Set<string>(),
  };
}

const ids = (result: { entries: StudentHistoryEntry[] }) =>
  result.entries.map((held) => held.record.id);

beforeEach(() => {
  fetchStudentHistory.mockReset();
});

describe('useStudentHistory', () => {
  it('reads nothing until somebody asks', () => {
    const { result } = renderHook(() => useStudentHistory('pco_1'));

    expect(fetchStudentHistory).not.toHaveBeenCalled();
    expect(result.current.started).toBe(false);
    expect(result.current.entries).toEqual([]);
    expect(result.current.hasMore).toBe(true);
  });

  it('reads the first page when asked and marks itself started', async () => {
    fetchStudentHistory.mockResolvedValue(page([entry('a', 6), entry('b', 13)], false));

    const { result } = renderHook(() => useStudentHistory('pco_1'));
    act(() => result.current.loadMore());

    expect(result.current.started).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Newest first, whatever order the page arrived in.
    expect(ids(result.current)).toEqual(['b', 'a']);
    expect(result.current.hasMore).toBe(false);
    expect(fetchStudentHistory).toHaveBeenCalledWith('pco_1', null);
  });

  it('carries the cursor into the next page', async () => {
    fetchStudentHistory
      .mockResolvedValueOnce(page([entry('a', 13)], true))
      .mockResolvedValueOnce(page([entry('b', 6)], false));

    const { result } = renderHook(() => useStudentHistory('pco_1'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });

    expect(ids(result.current)).toEqual(['a', 'b']);
    expect(fetchStudentHistory).toHaveBeenLastCalledWith('pco_1', {
      checkedInAt: 0,
      path: 'after-a',
    });
  });

  it('merges two ids into one list, newest first', async () => {
    fetchStudentHistory.mockImplementation(async (id: string) =>
      id === 'pco_1' ? page([entry('first', 13)], false) : page([entry('second', 20)], false),
    );

    const { result } = renderHook(() => useStudentHistory(['pco_1', 'tally_2']));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(ids(result.current)).toEqual(['second', 'first']);
    expect(fetchStudentHistory).toHaveBeenCalledTimes(2);
  });

  it('keeps asking while any stream still has pages', async () => {
    // Exhausted only when every stream is: a child whose second id ran out
    // first still has nights to show under the first.
    fetchStudentHistory.mockImplementation(async (id: string) =>
      id === 'pco_1' ? page([entry('first', 13)], true) : page([entry('second', 20)], false),
    );

    const { result } = renderHook(() => useStudentHistory(['pco_1', 'tally_2']));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasMore).toBe(true);
  });

  it('stops asking the stream that is done', async () => {
    fetchStudentHistory
      .mockImplementationOnce(async () => page([entry('first', 13)], true))
      .mockImplementationOnce(async () => page([entry('second', 20)], false))
      .mockImplementationOnce(async () => page([entry('third', 6)], false));

    const { result } = renderHook(() => useStudentHistory(['pco_1', 'tally_2']));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });

    // Three calls in all: two on the first round, one on the second.
    expect(fetchStudentHistory).toHaveBeenCalledTimes(3);
    expect(fetchStudentHistory).toHaveBeenLastCalledWith('pco_1', expect.anything());
    expect(result.current.hasMore).toBe(false);
  });

  it('does nothing at all for a student with no id', () => {
    const { result } = renderHook(() => useStudentHistory(null));
    act(() => result.current.loadMore());

    expect(fetchStudentHistory).not.toHaveBeenCalled();
    expect(result.current.started).toBe(false);
  });

  it('ignores an empty id and a repeated one', async () => {
    fetchStudentHistory.mockResolvedValue(page([entry('a', 13)], false));

    const { result } = renderHook(() => useStudentHistory(['pco_1', '', 'pco_1']));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchStudentHistory).toHaveBeenCalledTimes(1);
  });

  it('reports a failure and keeps the list it had', async () => {
    fetchStudentHistory.mockRejectedValueOnce(new Error('refused'));

    const { result } = renderHook(() => useStudentHistory('pco_1'));
    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.error?.message).toBe('refused'));
    expect(result.current.loading).toBe(false);
  });

  it('wraps a rejection that was not an Error', async () => {
    fetchStudentHistory.mockRejectedValueOnce('permission-denied');

    const { result } = renderHook(() => useStudentHistory('pco_1'));
    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.error?.message).toBe('permission-denied');
  });

  it('clears the error when the next page is asked for', async () => {
    fetchStudentHistory
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(page([entry('a', 13)], false));

    const { result } = renderHook(() => useStudentHistory('pco_1'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      result.current.loadMore();
    });

    expect(result.current.error).toBeNull();
    expect(ids(result.current)).toEqual(['a']);
  });

  it('throws away everything when the student changes', async () => {
    fetchStudentHistory.mockResolvedValue(page([entry('a', 13)], true));

    const { result, rerender } = renderHook(({ id }) => useStudentHistory(id), {
      initialProps: { id: 'pco_1' },
    });
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    rerender({ id: 'pco_2' });

    expect(result.current.entries).toEqual([]);
    expect(result.current.started).toBe(false);
    expect(result.current.hasMore).toBe(true);
  });

  it('starts the new student from the top rather than the old cursor', async () => {
    fetchStudentHistory.mockResolvedValue(page([entry('a', 13)], true));

    const { result, rerender } = renderHook(({ id }) => useStudentHistory(id), {
      initialProps: { id: 'pco_1' },
    });
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    rerender({ id: 'pco_2' });
    await act(async () => {
      result.current.loadMore();
    });

    expect(fetchStudentHistory).toHaveBeenLastCalledWith('pco_2', null);
  });

  it('drops a page that lands for the student we just left', async () => {
    let release: (value: StudentHistoryPage) => void = () => {};
    fetchStudentHistory.mockImplementationOnce(
      () =>
        new Promise<StudentHistoryPage>((resolve) => {
          release = resolve;
        }),
    );

    const { result, rerender } = renderHook(({ id }) => useStudentHistory(id), {
      initialProps: { id: 'pco_1' },
    });
    act(() => result.current.loadMore());

    rerender({ id: 'pco_2' });
    await act(async () => {
      release(page([entry('stale', 13)], false));
    });

    expect(result.current.entries).toEqual([]);
  });

  it('drops a failure that lands for the student we just left', async () => {
    let reject: (cause: unknown) => void = () => {};
    fetchStudentHistory.mockImplementationOnce(
      () =>
        new Promise<StudentHistoryPage>((_resolve, no) => {
          reject = no;
        }),
    );

    const { result, rerender } = renderHook(({ id }) => useStudentHistory(id), {
      initialProps: { id: 'pco_1' },
    });
    act(() => result.current.loadMore());

    rerender({ id: 'pco_2' });
    await act(async () => {
      reject(new Error('stale failure'));
    });

    expect(result.current.error).toBeNull();
  });

  it('is not reset by a caller that rebuilds the id array each render', async () => {
    // The array identity changes on every render of a caller that builds it
    // inline; the ids are what a reset should turn on.
    fetchStudentHistory.mockResolvedValue(page([entry('a', 13)], true));

    const { result, rerender } = renderHook(({ ids: given }) => useStudentHistory(given), {
      initialProps: { ids: ['pco_1'] },
    });
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    rerender({ ids: ['pco_1'] });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.started).toBe(true);
  });

  it('takes a failure down when the student changes', async () => {
    // A leader who backs out of a profile that could not be read must not find
    // the next child's page already wearing the last one's error.
    fetchStudentHistory.mockRejectedValueOnce(new Error('refused'));

    const { result, rerender } = renderHook(({ id }) => useStudentHistory(id), {
      initialProps: { id: 'pco_1' },
    });
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    rerender({ id: 'pco_2' });

    expect(result.current.error).toBeNull();
  });

  it('tells two students apart when their ids run together', async () => {
    // The ids are joined into one key, and the separator is the whole of what
    // stops `['pco_1', '2']` and `['pco_12']` being the same student — which
    // would page one child's nights into the other's list.
    fetchStudentHistory.mockResolvedValue(page([entry('a', 13)], true));

    const { result, rerender } = renderHook(({ ids: given }) => useStudentHistory(given), {
      initialProps: { ids: ['pco_1', '2'] },
    });
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    rerender({ ids: ['pco_12'] });

    expect(result.current.entries).toEqual([]);
    expect(result.current.started).toBe(false);
  });

  it('believes a page that says it is the last one, cursor or no cursor', async () => {
    fetchStudentHistory.mockResolvedValue({
      entries: [entry('a', 13)],
      cursor: { checkedInAt: 0, path: 'after-a' },
      hasMore: false,
      withheld: new Set<string>(),
    });

    const { result } = renderHook(() => useStudentHistory('pco_1'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasMore).toBe(false);
  });

  it('stops at a page with nowhere to go next, whatever it claims is left', async () => {
    // Without a cursor the next read would start from the top again, which is
    // the same twenty nights over and over.
    fetchStudentHistory.mockResolvedValue({
      entries: [entry('a', 13)],
      cursor: null,
      hasMore: true,
      withheld: new Set<string>(),
    });

    const { result } = renderHook(() => useStudentHistory('pco_1'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasMore).toBe(false);
  });

  it('dates a night by its gathering, falling back to the check-in', async () => {
    // A record whose event document is gone still stands, and still has to sort
    // into the right place in the list.
    const orphan: StudentHistoryEntry = {
      record: makeAttendance({ id: 'orphan', checkedInAt: new Date(2026, 1, 27, 19, 0) }),
      event: null,
    };
    fetchStudentHistory.mockResolvedValue(page([entry('older', 13), orphan], false));

    const { result } = renderHook(() => useStudentHistory('pco_1'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(ids(result.current)).toEqual(['orphan', 'older']);
  });
});
