/**
 * Parent contact and allergies for one student, and the four different kinds of
 * "nothing to show" it has to keep apart.
 *
 * `details: null` is the answer to all four, and only one of them is a problem:
 *
 * - **Nobody has asked yet.** `loaded` is false; the screen waits.
 * - **We asked, and the backend has no such person.** `loaded` is true and
 *   `details` is null. A merged or deleted person renders as a permanent
 *   spinner without this distinction.
 * - **There is nothing to ask.** A quick-added visitor exists in Tally alone,
 *   so `unavailable` says so rather than showing a failure.
 * - **The read failed.** `error` carries a sentence naming the backend that did
 *   not answer, and nothing is memoised — an outage must not become a permanent
 *   "no contact for this child".
 *
 * The other half is the memo, which is process-wide and therefore the thing
 * most likely to be wrong. `retry` re-asks *through* it, because a retry
 * follows a failure and the memo holds nothing. `refresh` drops it on both
 * sides of the wire, because a refresh follows a write and the held answer is
 * the state from before that write.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidatePersonDetails, usePersonDetails } from '@/hooks/usePersonDetails';
import { makeStudent } from '../../tests/factories';
import type { PcoPersonDetails, Student } from '@/types';

const getPersonDetails = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({ getPersonDetails }));

function details(overrides: Partial<PcoPersonDetails> = {}): PcoPersonDetails {
  return {
    pcoPersonId: '101',
    parentName: 'Dana Rivera',
    parentPhone: '+15125550143',
    parentEmail: 'dana@example.org',
    allergies: 'Peanuts',
    birthdate: '2011-03-14',
    householdAdult: true,
    contactWritable: false,
    profileWritable: false,
    canCreateContact: false,
    ...overrides,
  } as PcoPersonDetails;
}

/** A student Planning Center holds, whose id carries the person id. */
function linked(overrides: Partial<Student> = {}): Student {
  return makeStudent({ id: 'pco_101', ...overrides });
}

beforeEach(() => {
  invalidatePersonDetails();
  getPersonDetails.mockReset();
  getPersonDetails.mockResolvedValue({ data: details() });
});

describe('reading a linked student', () => {
  it('asks the moment the screen mounts, without waiting for a tap', async () => {
    const { result } = renderHook(() => usePersonDetails(linked()));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.details?.parentPhone).toBe('+15125550143');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.unavailable).toBe(false);
  });

  it('asks about the student by id, and carries the person id along', async () => {
    const { result } = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // `studentId` is what the server dispatches on; the bare person id rides
    // along for a server that predates it.
    expect(getPersonDetails).toHaveBeenCalledWith({ studentId: 'pco_101', pcoPersonId: '101' });
  });

  it('prefers the linkage field over the id for a pushed visitor', async () => {
    const pushed = makeStudent({ id: 'tally-9', pcoPersonId: '777' });

    const { result } = renderHook(() => usePersonDetails(pushed));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(getPersonDetails).toHaveBeenCalledWith({ studentId: 'tally-9', pcoPersonId: '777' });
  });

  it('does not ask for `force` on an ordinary read', async () => {
    const { result } = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const [request] = getPersonDetails.mock.calls[0] as [Record<string, unknown>];
    expect(request).not.toHaveProperty('force');
  });

  it('separates "asked, and there is nobody" from "nobody has asked"', async () => {
    // A person merged away upstream answers null. Without `loaded`, that is
    // indistinguishable from the first frame and the screen spins forever.
    getPersonDetails.mockResolvedValue({ data: null });

    const { result } = renderHook(() => usePersonDetails(linked()));
    expect(result.current.loaded).toBe(false);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.details).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe('a student no backend holds', () => {
  it('says there is nothing to look up rather than failing', () => {
    const visitor = makeStudent({ id: 'tally-9', pcoPersonId: null, isVisitor: true });

    const { result } = renderHook(() => usePersonDetails(visitor));

    expect(result.current.unavailable).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(getPersonDetails).not.toHaveBeenCalled();
  });

  it('is not "unavailable" when there is no student at all', () => {
    // No student is a screen with nothing selected, which is not the same
    // claim as a student who cannot be looked up.
    const { result } = renderHook(() => usePersonDetails(null));

    expect(result.current.unavailable).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(getPersonDetails).not.toHaveBeenCalled();
  });
});

describe('when the read fails', () => {
  it('names the backend that did not answer', async () => {
    getPersonDetails.mockRejectedValue(new Error('unavailable'));

    const { result } = renderHook(() => usePersonDetails(linked()));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toBe('Could not reach Planning Center for these details.');
    expect(result.current.loading).toBe(false);
  });

  it('names Attendees for a student Attendees holds', async () => {
    // Attendees ids are UUIDs, and this read exists for them exactly as much as
    // for Planning Center: `personIdFromStudentId` answers null for one of
    // these, which used to make the whole screen say "nothing to look up".
    getPersonDetails.mockRejectedValue(new Error('unavailable'));

    const { result } = renderHook(() => usePersonDetails(makeStudent({ id: 'a32_9f0c' })));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toBe('Could not reach Attendees for these details.');
  });

  it('reads an Attendees student rather than calling them unavailable', async () => {
    const { result } = renderHook(() => usePersonDetails(makeStudent({ id: 'a32_9f0c' })));

    expect(result.current.unavailable).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(getPersonDetails).toHaveBeenCalledWith({
      studentId: 'a32_9f0c',
      pcoPersonId: '9f0c',
    });
  });

  it('reads a visitor linked by the fields rather than by their id', async () => {
    // The push wrote the linkage onto a Tally-owned document; the id still
    // says nothing.
    const pushed = makeStudent({
      id: 'tally-9',
      pcoPersonId: null,
      upstreamBackend: 'a32',
      upstreamPersonId: '9f0c',
    });

    const { result } = renderHook(() => usePersonDetails(pushed));

    expect(result.current.unavailable).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(getPersonDetails).toHaveBeenCalledWith({ studentId: 'tally-9', pcoPersonId: '9f0c' });
  });

  it('says who may see this when the rules refuse', async () => {
    // The distinction is worth the branch: one of these is worth retrying and
    // the other is a leader being told to stop pressing the button.
    getPersonDetails.mockRejectedValue({ code: 'functions/permission-denied' });

    const { result } = renderHook(() => usePersonDetails(linked()));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toBe('Only the core team can see parent contact details.');
  });

  it('does not memoise a failure', async () => {
    getPersonDetails.mockRejectedValueOnce(new Error('unavailable'));

    const first = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(first.result.current.error).toBeTruthy());
    expect(first.result.current.loaded).toBe(false);
    first.unmount();

    // An outage must not become a permanent "no contact for this child".
    const second = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(second.result.current.details?.parentPhone).toBe('+15125550143');
    expect(getPersonDetails).toHaveBeenCalledTimes(2);
  });
});

describe('retry', () => {
  it('asks again after a failure', async () => {
    getPersonDetails.mockRejectedValueOnce(new Error('unavailable'));

    const { result } = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.details?.parentName).toBe('Dana Rivera');
  });

  it('clears the failure straight away, so the retry shows a spinner', async () => {
    getPersonDetails.mockRejectedValueOnce(new Error('unavailable'));
    const { result } = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    // Never mind what happens next: the frame after the press must not still
    // be showing the failure being retried.
    getPersonDetails.mockReturnValueOnce(new Promise(() => {}));
    act(() => result.current.retry());

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('does nothing once an answer is held', async () => {
    const { result } = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.retry());
    await act(async () => {});

    // The memo is checked before asking, so a retry over a held answer is free.
    expect(getPersonDetails).toHaveBeenCalledTimes(1);
  });
});

describe('refresh', () => {
  it('drops the held answer and reads again', async () => {
    const { result } = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(result.current.details?.allergies).toBe('Peanuts'));

    getPersonDetails.mockResolvedValue({ data: details({ allergies: 'Peanuts, shellfish' }) });
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.details?.allergies).toBe('Peanuts, shellfish'));
    expect(getPersonDetails).toHaveBeenCalledTimes(2);
  });

  it('asks the server to drop its held answer too', async () => {
    const { result } = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.refresh());
    await waitFor(() => expect(getPersonDetails).toHaveBeenCalledTimes(2));

    // The answer is held on both sides of the wire, and a refresh follows a
    // write: a cached read would hand back the state from before it.
    expect(getPersonDetails).toHaveBeenLastCalledWith({
      studentId: 'pco_101',
      pcoPersonId: '101',
      force: true,
    });
  });

  it('forces the next read only, not the one after it', async () => {
    const { result } = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.refresh());
    await waitFor(() => expect(getPersonDetails).toHaveBeenCalledTimes(2));

    invalidatePersonDetails('pco_101');
    act(() => result.current.retry());
    await waitFor(() => expect(getPersonDetails).toHaveBeenCalledTimes(3));

    const third = getPersonDetails.mock.calls[2] as [Record<string, unknown>];
    expect(third[0]).not.toHaveProperty('force');
  });
});

describe('the memo', () => {
  it('holds an answer across mounts rather than re-reading', async () => {
    const first = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    // A leader working down the MIA list opens the same student twice.
    const second = renderHook(() => usePersonDetails(linked()));
    expect(second.result.current.loaded).toBe(true);
    expect(second.result.current.details?.parentName).toBe('Dana Rivera');
    expect(second.result.current.loading).toBe(false);
    expect(getPersonDetails).toHaveBeenCalledTimes(1);
  });

  it('holds "there is nobody" too', async () => {
    getPersonDetails.mockResolvedValue({ data: null });

    const first = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const second = renderHook(() => usePersonDetails(linked()));
    expect(second.result.current.loaded).toBe(true);
    expect(getPersonDetails).toHaveBeenCalledTimes(1);
  });

  it('is per student', async () => {
    const { result, rerender } = renderHook(({ student }) => usePersonDetails(student), {
      initialProps: { student: linked() },
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    getPersonDetails.mockResolvedValue({ data: details({ pcoPersonId: '202', parentName: 'Sam' }) });
    rerender({ student: makeStudent({ id: 'pco_202' }) });

    await waitFor(() => expect(result.current.details?.parentName).toBe('Sam'));
    expect(getPersonDetails).toHaveBeenCalledTimes(2);
  });

  it('shows the new student nothing while its read is in flight', async () => {
    const { result, rerender } = renderHook(({ student }) => usePersonDetails(student), {
      initialProps: { student: linked() },
    });
    await waitFor(() => expect(result.current.details?.parentName).toBe('Dana Rivera'));

    // Anything held belongs to the previous child. Showing it under the new
    // name is the one failure worse than showing nothing.
    getPersonDetails.mockReturnValue(new Promise(() => {}));
    rerender({ student: makeStudent({ id: 'pco_202' }) });

    expect(result.current.details).toBeNull();
    expect(result.current.loaded).toBe(false);
  });

  it('forgets one student without forgetting the rest', async () => {
    const first = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    getPersonDetails.mockResolvedValue({ data: details({ parentName: 'Sam' }) });
    const other = renderHook(() => usePersonDetails(makeStudent({ id: 'pco_202' })));
    await waitFor(() => expect(other.result.current.loaded).toBe(true));
    other.unmount();

    invalidatePersonDetails('pco_202');

    const again = renderHook(() => usePersonDetails(linked()));
    expect(again.result.current.loaded).toBe(true);
    expect(getPersonDetails).toHaveBeenCalledTimes(2);
  });

  it('forgets everybody when asked for nobody in particular', async () => {
    const first = renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    invalidatePersonDetails();

    renderHook(() => usePersonDetails(linked()));
    await waitFor(() => expect(getPersonDetails).toHaveBeenCalledTimes(2));
  });

  it('carries an error message clearing over to the new student', async () => {
    getPersonDetails.mockRejectedValueOnce(new Error('unavailable'));
    const { result, rerender } = renderHook(({ student }) => usePersonDetails(student), {
      initialProps: { student: linked() },
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());

    // The previous child's failure is not this child's.
    rerender({ student: makeStudent({ id: 'pco_202' }) });

    expect(result.current.error).toBeNull();
  });
});

describe('a late answer', () => {
  it('does not land after the student has changed', async () => {
    let answerFirst: (value: { data: PcoPersonDetails | null }) => void = () => {};
    getPersonDetails.mockReturnValueOnce(
      new Promise((resolve) => {
        answerFirst = resolve;
      }),
    );
    getPersonDetails.mockResolvedValueOnce({ data: details({ parentName: 'Sam' }) });

    const { result, rerender } = renderHook(({ student }) => usePersonDetails(student), {
      initialProps: { student: linked() },
    });
    rerender({ student: makeStudent({ id: 'pco_202' }) });
    await waitFor(() => expect(result.current.details?.parentName).toBe('Sam'));

    await act(async () => {
      answerFirst({ data: details({ parentName: 'Dana Rivera' }) });
    });

    // The first read resolving after the second must not repaint the screen
    // with the previous child's parent.
    expect(result.current.details?.parentName).toBe('Sam');
  });

  it('does not leave a spinner running after an unmount', async () => {
    let answer: (value: { data: PcoPersonDetails | null }) => void = () => {};
    getPersonDetails.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const { unmount } = renderHook(() => usePersonDetails(linked()));
    unmount();

    // Nothing to assert on the hook — this is here because setting state after
    // an unmount is what the `stale` flag exists to stop.
    await act(async () => {
      answer({ data: details() });
    });
  });
});
