/**
 * Collecting a screenful of contact reads into one call.
 *
 * `getPersonDetails` keeps a callable's signature — every caller asks about the
 * one student it is rendering, and none of them knows this exists — but the
 * reads of one frame go out together. That indirection is only worth having if
 * it holds four things, and each of them is a way the dashboard breaks if it
 * does not:
 *
 *   - twenty rows are one call, or the burst this replaces is still there;
 *   - each row still gets *its own* student's answer, or a leader rings the
 *     wrong family;
 *   - one unreadable student does not blank the other nineteen;
 *   - a read that follows a write is never handed the answer from before it.
 *
 * The module wires itself at import time, so the callables are mocked before it
 * loads and the collector's own state is reset between scenarios.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PcoPersonDetails } from '@/types';

const callables = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  connectFunctionsEmulator: vi.fn(),
  httpsCallable: vi.fn((_functions: unknown, name: string) => {
    const existing = callables.get(name);
    if (existing) return existing;
    const callable = vi.fn(async () => ({ data: null }));
    callables.set(name, callable);
    return callable;
  }),
}));

vi.mock('@/lib/firebase', () => ({ USE_EMULATORS: false, firebaseApp: {} }));

const { getPersonDetails, resetPersonDetailsBatching } = await import('@/services/functions');

const batch = (): ReturnType<typeof vi.fn> => callables.get('getPersonDetailsBatch')!;
const single = (): ReturnType<typeof vi.fn> => callables.get('getPersonDetails')!;

function details(overrides: Partial<PcoPersonDetails> = {}): PcoPersonDetails {
  return {
    pcoPersonId: '101',
    contactName: 'Dana Rivera',
    contactPhone: '+15125550143',
    contactEmail: 'dana@example.org',
    allergies: null,
    birthdate: null,
    householdAdult: true,
    contactWritable: false,
    profileWritable: false,
    ...overrides,
  } as PcoPersonDetails;
}

/** The whole batch window, plus the microtasks its answer settles through. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(50);
}

/** What the last batch call asked about, in order. */
function askedFor(): Array<{ studentId: string; force?: boolean }> {
  const calls = batch().mock.calls;
  return (calls[calls.length - 1]?.[0] as { students: Array<{ studentId: string }> }).students;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetPersonDetailsBatching();
  for (const callable of callables.values()) callable.mockReset();
  batch().mockResolvedValue({ data: { details: {}, errors: {} } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('collecting a frame of reads', () => {
  it('sends twenty rows as one call', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `pco_${index}`);
    batch().mockResolvedValue({
      data: { details: Object.fromEntries(ids.map((id) => [id, details()])), errors: {} },
    });

    const reads = ids.map((studentId) => getPersonDetails({ studentId }));
    await settle();
    await Promise.all(reads);

    expect(batch()).toHaveBeenCalledTimes(1);
    expect(askedFor()).toHaveLength(20);
    expect(single()).not.toHaveBeenCalled();
  });

  it('gives each row its own student, not the first answer that landed', async () => {
    batch().mockResolvedValue({
      data: {
        details: {
          pco_1: details({ contactName: 'Chidi Okonkwo' }),
          pco_2: details({ contactName: 'Rosa Delgado' }),
        },
        errors: {},
      },
    });

    const first = getPersonDetails({ studentId: 'pco_1' });
    const second = getPersonDetails({ studentId: 'pco_2' });
    await settle();

    expect((await first).data?.contactName).toBe('Chidi Okonkwo');
    expect((await second).data?.contactName).toBe('Rosa Delgado');
  });

  it('carries a null answer through as an answer', async () => {
    // A student the backend no longer holds. The row says they were deleted or
    // merged upstream, which is not the sentence a failure gets.
    batch().mockResolvedValue({ data: { details: { pco_1: null }, errors: {} } });

    const read = getPersonDetails({ studentId: 'pco_1' });
    await settle();

    expect((await read).data).toBeNull();
  });

  it('asks once for a student who is on two lists at once', async () => {
    // A new visitor who has since missed three gatherings is on two of the
    // dashboard's three call lists. The memo in `usePersonDetails` cannot
    // collapse that: it is only written when an answer lands, which is after
    // both rows have already asked.
    batch().mockResolvedValue({ data: { details: { pco_1: details() }, errors: {} } });

    const first = getPersonDetails({ studentId: 'pco_1' });
    const second = getPersonDetails({ studentId: 'pco_1' });
    await settle();

    expect(askedFor()).toEqual([{ studentId: 'pco_1' }]);
    expect((await first).data?.contactName).toBe((await second).data?.contactName);
  });

  it('joins a read already in the air rather than opening a second', async () => {
    // The second row mounted a frame late — after the flush, before the answer.
    let release!: (value: unknown) => void;
    batch().mockReturnValue(new Promise((resolve) => (release = resolve)));

    const first = getPersonDetails({ studentId: 'pco_1' });
    await vi.advanceTimersByTimeAsync(20);
    const second = getPersonDetails({ studentId: 'pco_1' });

    release({ data: { details: { pco_1: details() }, errors: {} } });
    await settle();

    expect(batch()).toHaveBeenCalledTimes(1);
    expect((await second).data?.contactName).toBe((await first).data?.contactName);
  });

  it('opens a new call for a student read after the last one settled', async () => {
    batch().mockResolvedValue({ data: { details: { pco_1: details() }, errors: {} } });

    const first = getPersonDetails({ studentId: 'pco_1' });
    await settle();
    await first;

    const again = getPersonDetails({ studentId: 'pco_1' });
    await settle();
    await again;

    // Nothing here memoises: the hook holds the answer, and this must not
    // quietly become a second cache with no way to invalidate it.
    expect(batch()).toHaveBeenCalledTimes(2);
  });

  it('splits a burst bigger than one request into more than one', async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `pco_${index}`);
    batch().mockResolvedValue({
      data: { details: Object.fromEntries(ids.map((id) => [id, details()])), errors: {} },
    });

    const reads = ids.map((studentId) => getPersonDetails({ studentId }));
    await settle();
    await Promise.all(reads);

    expect(batch().mock.calls.length).toBeGreaterThan(1);
    for (const call of batch().mock.calls) {
      expect((call[0] as { students: unknown[] }).students.length).toBeLessThanOrEqual(50);
    }
  });
});

describe('a read that follows a write', () => {
  it('asks for force, and only for the student that asked', async () => {
    batch().mockResolvedValue({
      data: { details: { pco_1: details(), pco_2: details() }, errors: {} },
    });

    void getPersonDetails({ studentId: 'pco_1', force: true });
    void getPersonDetails({ studentId: 'pco_2' });
    await settle();

    expect(askedFor()).toEqual([{ studentId: 'pco_1', force: true }, { studentId: 'pco_2' }]);
  });

  it('upgrades a read already queued rather than sending a second', async () => {
    // Both rows want the same student, and one of them has just written. One
    // request, forced — which is fresh enough for the row that only read.
    batch().mockResolvedValue({ data: { details: { pco_1: details() }, errors: {} } });

    void getPersonDetails({ studentId: 'pco_1' });
    void getPersonDetails({ studentId: 'pco_1', force: true });
    await settle();

    expect(askedFor()).toEqual([{ studentId: 'pco_1', force: true }]);
  });

  it('never joins an unforced read already in the air', async () => {
    /*
     * The one case where sharing would be wrong. The answer being waited on was
     * asked for before the write, so handing it to the screen that just added a
     * parent is how "it did not work" appears on the one screen whose whole
     * subject is whether it did.
     */
    let release!: (value: unknown) => void;
    batch().mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

    void getPersonDetails({ studentId: 'pco_1' });
    await vi.advanceTimersByTimeAsync(20);

    batch().mockResolvedValue({
      data: { details: { pco_1: details({ contactName: 'Added just now' }) }, errors: {} },
    });
    const after = getPersonDetails({ studentId: 'pco_1', force: true });

    release({ data: { details: { pco_1: details({ contactName: 'Before the write' }) }, errors: {} } });
    await settle();

    expect(batch()).toHaveBeenCalledTimes(2);
    expect((await after).data?.contactName).toBe('Added just now');
  });
});

describe('when a student cannot be read', () => {
  it('fails that row and answers the rest', async () => {
    batch().mockResolvedValue({
      data: {
        details: { pco_2: details() },
        errors: { pco_1: { code: 'not-found', message: 'Not linked to a people backend.' } },
      },
    });

    const failed = getPersonDetails({ studentId: 'pco_1' });
    const answered = getPersonDetails({ studentId: 'pco_2' });
    await settle();

    await expect(failed).rejects.toMatchObject({ code: 'not-found' });
    expect((await answered).data?.contactName).toBe('Dana Rivera');
  });

  it('fails a row the answer simply forgot', async () => {
    // Rather than leaving its promise pending for the life of the tab, which
    // renders as a spinner nobody can clear.
    batch().mockResolvedValue({ data: { details: {}, errors: {} } });

    const orphaned = getPersonDetails({ studentId: 'pco_1' });
    await settle();

    await expect(orphaned).rejects.toThrow();
  });

  it('fails the whole batch when the call itself does', async () => {
    batch().mockRejectedValue(Object.assign(new Error('rate limited'), {
      code: 'functions/resource-exhausted',
    }));

    const first = getPersonDetails({ studentId: 'pco_1' });
    const second = getPersonDetails({ studentId: 'pco_2' });
    await settle();

    await expect(first).rejects.toMatchObject({ code: 'functions/resource-exhausted' });
    await expect(second).rejects.toMatchObject({ code: 'functions/resource-exhausted' });
    // Never re-issued one at a time: that turns one refusal into twenty.
    expect(single()).not.toHaveBeenCalled();
  });
});

describe('a deployment whose functions have not caught up', () => {
  /*
   * `firebase deploy` publishes hosting before the new function finishes being
   * created, so for a minute after a release a browser holding the new bundle
   * talks to a backend that has no `getPersonDetailsBatch`. Without the
   * fallback the entire dashboard reads "could not reach Planning Center" for
   * that minute.
   */
  it('falls back to one call per student', async () => {
    batch().mockRejectedValue(Object.assign(new Error('NOT FOUND'), {
      code: 'functions/not-found',
    }));
    single().mockResolvedValue({ data: details() });

    const first = getPersonDetails({ studentId: 'pco_1' });
    const second = getPersonDetails({ studentId: 'pco_2' });
    await settle();

    expect((await first).data?.contactName).toBe('Dana Rivera');
    expect((await second).data?.contactName).toBe('Dana Rivera');
    expect(single()).toHaveBeenCalledTimes(2);
  });

  it('carries the person id along, for a server old enough to need it', async () => {
    // The deployment this exists for is an old one, and an old enough server
    // reads only `pcoPersonId` and has always taken it to mean Planning Center.
    batch().mockRejectedValue(Object.assign(new Error('NOT FOUND'), {
      code: 'functions/not-found',
    }));
    single().mockResolvedValue({ data: details() });

    const read = getPersonDetails({ studentId: 'pco_1', pcoPersonId: '101' });
    await settle();
    await read;

    expect(single()).toHaveBeenCalledWith({ studentId: 'pco_1', pcoPersonId: '101' });
  });

  it('stops trying the batch once it knows', async () => {
    batch().mockRejectedValue(Object.assign(new Error('NOT FOUND'), {
      code: 'functions/not-found',
    }));
    single().mockResolvedValue({ data: details() });

    const first = getPersonDetails({ studentId: 'pco_1' });
    await settle();
    await first;

    const second = getPersonDetails({ studentId: 'pco_2' });
    await settle();
    await second;

    // One wasted call for the life of the tab, not one per burst.
    expect(batch()).toHaveBeenCalledTimes(1);
    expect(single()).toHaveBeenCalledTimes(2);
  });
});

describe('the bare person id request', () => {
  it('goes out on its own, because the batch does not speak it', async () => {
    // The server dispatches a batch entry on the student id and the linkage
    // behind it; there is no student to dispatch on here.
    single().mockResolvedValue({ data: details() });

    const read = getPersonDetails({ pcoPersonId: '101' });
    await settle();

    expect((await read).data?.contactName).toBe('Dana Rivera');
    expect(single()).toHaveBeenCalledWith({ pcoPersonId: '101' });
    expect(batch()).not.toHaveBeenCalled();
  });
});
