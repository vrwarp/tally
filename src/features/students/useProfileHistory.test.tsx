/**
 * What a year of a student's history is allowed to cost, and what it must still
 * get right.
 *
 * Two claims, and they pull against each other. The cheap one: when the registry
 * already covers a chain, no night's register is read at all — that is the whole
 * reason the registry exists. The careful one: a night nobody has examined is
 * never guessed at, because guessing "held" turns it into an absence and
 * absences are what this app phones families about.
 *
 * `outcomeOf` is deliberately not mocked. It is the rule under test; only the
 * reads and writes around it are stubbed.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileHistory } from '@/features/students/useProfileHistory';
import type * as SkippedNights from '@/services/skippedNights';
import { makeEvent, makeStudent } from '../../../tests/factories';

const fetchAttendanceByEvent = vi.hoisted(() => vi.fn());
const fetchStudentAttendanceSince = vi.hoisted(() => vi.fn());
const fetchSkippedNights = vi.hoisted(() => vi.fn());
const recordExamination = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/services/attendance', () => ({ fetchAttendanceByEvent, fetchStudentAttendanceSince }));

// `importActual` below reaches the real skippedNights module, which opens a
// Firestore handle at import time. Only `outcomeOf` — pure — is wanted from it.
vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/services/skippedNights', async (importActual) => {
  const actual = await importActual<typeof SkippedNights>();
  return { ...actual, fetchSkippedNights, recordExamination };
});

const STUDENT = makeStudent({ id: 'ada' });
const WINDOW_START = new Date('2025-08-02T00:00:00');

/** A finished night of `seriesId`, on the given date. */
const night = (id: string, date: string, seriesId = 'friday') =>
  makeEvent({ id, seriesId, startAt: new Date(`${date}T19:00:00`) });

const CAME = night('came', '2026-01-09');
const MISSED = night('missed', '2026-01-16');
const NOBODY = night('nobody', '2026-01-23');

beforeEach(() => {
  fetchAttendanceByEvent.mockReset();
  fetchAttendanceByEvent.mockResolvedValue(new Map());
  fetchStudentAttendanceSince.mockReset();
  fetchStudentAttendanceSince.mockResolvedValue(new Set(['came']));
  fetchSkippedNights.mockReset();
  recordExamination.mockClear();
});

/** A registry that has examined the whole window and found `skipped` empty. */
const covering = (skipped: string[] = []) =>
  new Map([
    [
      'friday',
      { chainKey: 'friday', skipped: new Set(skipped), examinedFrom: WINDOW_START },
    ],
  ]);

describe('useProfileHistory, when the registry covers the chain', () => {
  it('reads no registers at all', async () => {
    fetchSkippedNights.mockResolvedValue(covering(['nobody']));

    const { result } = renderHook(() =>
      useProfileHistory(STUDENT, [CAME, MISSED, NOBODY], WINDOW_START),
    );

    await waitFor(() => expect(result.current.snapshots).toHaveLength(3));
    // The point of the whole design: one document per chain and one query for
    // the student, instead of one read per night.
    expect(fetchAttendanceByEvent).not.toHaveBeenCalled();
    expect(fetchStudentAttendanceSince).toHaveBeenCalledTimes(1);
  });

  it('tells the three kinds of night apart', async () => {
    fetchSkippedNights.mockResolvedValue(covering(['nobody']));

    const { result } = renderHook(() =>
      useProfileHistory(STUDENT, [CAME, MISSED, NOBODY], WINDOW_START),
    );

    await waitFor(() => expect(result.current.snapshots).toHaveLength(3));
    const [came, missed, nobody] = result.current.snapshots;

    expect(came.presentStudentIds.has('ada')).toBe(true);
    expect(came.held).toBe(true);

    // Absent from a night that happened. The distinction below is the one that
    // decides whether this counts against them.
    expect(missed.presentStudentIds.has('ada')).toBe(false);
    expect(missed.held).toBe(true);

    expect(nobody.presentStudentIds.has('ada')).toBe(false);
    expect(nobody.held).toBe(false);
  });

  it('writes nothing back when it learned nothing new', async () => {
    fetchSkippedNights.mockResolvedValue(covering(['nobody']));

    const { result } = renderHook(() => useProfileHistory(STUDENT, [CAME, MISSED], WINDOW_START));

    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
    expect(recordExamination).not.toHaveBeenCalled();
  });
});

describe('useProfileHistory, when the registry has not examined a night', () => {
  it('reads the nights it does not know, and only those', async () => {
    // Covered from January, so December is beyond the watermark.
    fetchSkippedNights.mockResolvedValue(
      new Map([
        [
          'friday',
          {
            chainKey: 'friday',
            skipped: new Set<string>(),
            examinedFrom: new Date('2026-01-01T00:00:00'),
          },
        ],
      ]),
    );
    const december = night('december', '2025-12-12');
    fetchAttendanceByEvent.mockResolvedValue(new Map([['december', { present: new Set(['bo']), checkedOut: new Set() }]]));

    const { result } = renderHook(() =>
      useProfileHistory(STUDENT, [CAME, december], WINDOW_START),
    );

    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
    expect(fetchAttendanceByEvent).toHaveBeenCalledWith(['december']);
  });

  it('writes down what it found so nobody pays for it again', async () => {
    fetchSkippedNights.mockResolvedValue(new Map());
    fetchAttendanceByEvent.mockResolvedValue(
      new Map([
        ['came', { present: new Set(['ada']), checkedOut: new Set() }],
        ['nobody', { present: new Set(), checkedOut: new Set() }],
      ]),
    );

    const { result } = renderHook(() => useProfileHistory(STUDENT, [CAME, NOBODY], WINDOW_START));

    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
    expect(recordExamination).toHaveBeenCalledWith(
      expect.objectContaining({
        chainKey: 'friday',
        examinedFrom: WINDOW_START,
        skipped: ['nobody'],
        held: ['came'],
      }),
    );
  });

  it('does not let a failed write break a page whose numbers are right', async () => {
    fetchSkippedNights.mockResolvedValue(new Map());
    fetchAttendanceByEvent.mockResolvedValue(new Map([['came', { present: new Set(['ada']), checkedOut: new Set() }]]));
    recordExamination.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useProfileHistory(STUDENT, [CAME], WINDOW_START));

    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(result.current.snapshots[0].held).toBe(true);
  });
});

describe('useProfileHistory, on a one-off', () => {
  it('reads it directly rather than inventing a chain for it', async () => {
    // `chainKey` falls back to the event's own id for a one-off, so a registry
    // would be one document per event and would save nothing.
    fetchSkippedNights.mockResolvedValue(new Map());
    const retreat = makeEvent({
      id: 'retreat',
      mode: 'oneoff',
      seriesId: null,
      startAt: new Date('2026-01-30T19:00:00'),
    });
    fetchAttendanceByEvent.mockResolvedValue(new Map([['retreat', { present: new Set(['ada']), checkedOut: new Set() }]]));

    const { result } = renderHook(() => useProfileHistory(STUDENT, [retreat], WINDOW_START));

    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
    expect(fetchAttendanceByEvent).toHaveBeenCalledWith(['retreat']);
    expect(recordExamination).not.toHaveBeenCalled();
  });
});
