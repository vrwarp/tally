/**
 * Unit tests for the cancelled-session rule.
 *
 * The interesting cases are the two that look identical in the data and mean the
 * same thing — a night somebody marked cancelled, and a night nobody was ever
 * checked into — against the one case that must never be confused with them: a
 * gathering with a single student at it is still a gathering.
 */
import { describe, expect, it } from 'vitest';
import {
  heldSessions,
  presumedCancelled,
  sessionOutcome,
  wasHeld,
} from '@/lib/sessionHistory';
import { makeEvent, makeSnapshot, makeWeeklyEvents } from '../../tests/factories';

const fridays = makeWeeklyEvents({ count: 3 });

describe('sessionOutcome', () => {
  it('is held as soon as one student was checked in', () => {
    expect(sessionOutcome(makeSnapshot(fridays[0]!, ['just-one']))).toBe('held');
  });

  it('is presumed cancelled when nobody was checked in', () => {
    expect(sessionOutcome(makeSnapshot(fridays[0]!, []))).toBe('presumed-cancelled');
  });

  it('distinguishes a night somebody marked from one they only forgot', () => {
    const marked = makeEvent({ ...fridays[0]!, status: 'cancelled' });

    expect(sessionOutcome(makeSnapshot(marked, []))).toBe('cancelled');
    expect(sessionOutcome(makeSnapshot(fridays[0]!, []))).toBe('presumed-cancelled');
  });

  /*
   * Attendance that survives a cancellation is a real record — somebody turned
   * up before the call was made, or the event was cancelled by mistake. The
   * explicit status still wins: a leader saying "this did not happen" outranks
   * an inference, and the alternative is that un-cancelling would be the only way
   * to stop a cancelled night counting as everyone else's absence.
   */
  it('trusts an explicit cancellation even when a record exists', () => {
    const marked = makeEvent({ ...fridays[0]!, status: 'cancelled' });
    expect(sessionOutcome(makeSnapshot(marked, ['showed-up-anyway']))).toBe('cancelled');
  });
});

describe('wasHeld', () => {
  it('admits only gatherings there is evidence for', () => {
    expect(wasHeld(makeSnapshot(fridays[0]!, ['a']))).toBe(true);
    expect(wasHeld(makeSnapshot(fridays[0]!, []))).toBe(false);
    expect(wasHeld(makeSnapshot(makeEvent({ ...fridays[0]!, status: 'cancelled' }), ['a']))).toBe(
      false,
    );
  });
});

describe('heldSessions', () => {
  it('drops what did not happen and preserves the caller’s order', () => {
    const snapshots = [
      makeSnapshot(fridays[2]!, ['a']),
      makeSnapshot(fridays[1]!, []),
      makeSnapshot(fridays[0]!, ['b']),
    ];

    expect(heldSessions(snapshots).map((snapshot) => snapshot.event.id)).toEqual([
      fridays[2]!.id,
      fridays[0]!.id,
    ]);
  });

  it('does not mutate the input', () => {
    const snapshots = [makeSnapshot(fridays[0]!, []), makeSnapshot(fridays[1]!, ['a'])];
    heldSessions(snapshots);

    expect(snapshots).toHaveLength(2);
  });
});

describe('presumedCancelled', () => {
  it('is only the nights nobody marked and nobody attended', () => {
    const snapshots = [
      makeSnapshot(fridays[0]!, ['a']),
      makeSnapshot(fridays[1]!, []),
      makeSnapshot(makeEvent({ ...fridays[2]!, status: 'cancelled' }), []),
    ];

    // The marked one is excluded: a screen explaining what it inferred should
    // count only the inferences.
    expect(presumedCancelled(snapshots).map((snapshot) => snapshot.event.id)).toEqual([
      fridays[1]!.id,
    ]);
  });
});
