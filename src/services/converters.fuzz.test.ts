/**
 * The converters are the app's trust boundary.
 *
 * Every Firestore document is data somebody else wrote — an import script, the
 * console, an older version of the app, the Planning Center sync, or a bug.
 * Downstream code treats the result as a `Student` and dereferences it without
 * checking, so a converter that lets a malformed field through does not fail
 * here; it fails three screens later as "Invalid Date" or a crash mid-check-in.
 *
 * The property is therefore always the same: whatever goes in, what comes out
 * satisfies the type contract.
 */
import { describe, expect } from 'vitest';
import type { DocumentData, DocumentSnapshot } from 'firebase/firestore';
import { forAll } from '../../tests/fuzz/property';
import { arbitraryFirestoreData } from '../../tests/fuzz/arbitrary';
import {
  toAttendance,
  toEvent,
  toEventSeries,
  toRsvp,
  toSettings,
  toStudent,
  toUserProfile,
} from './converters';

interface FakeSnapshotInput {
  id: string;
  data: Record<string, unknown>;
  exists: boolean;
  hasPendingWrites: boolean;
}

function snapshot(input: FakeSnapshotInput): DocumentSnapshot<DocumentData> {
  return {
    id: input.id,
    exists: () => input.exists,
    data: () => (input.exists ? (input.data as DocumentData) : undefined),
    metadata: { hasPendingWrites: input.hasPendingWrites, fromCache: false },
  } as unknown as DocumentSnapshot<DocumentData>;
}

const arbitrarySnapshot = (rng: Parameters<typeof arbitraryFirestoreData>[0]) =>
  snapshot({
    id: rng.bool(0.9) ? 'doc-1' : '',
    data: arbitraryFirestoreData(rng),
    exists: rng.bool(0.9),
    hasPendingWrites: rng.bool(0.3),
  });

const isRealDate = (value: unknown): boolean =>
  value instanceof Date && Number.isFinite(value.getTime());

const isRealDateOrNull = (value: unknown): boolean => value === null || isRealDate(value);

describe('converter properties', () => {
  forAll('no converter throws on an arbitrary document', arbitrarySnapshot, (snap) => {
    expect(() => toStudent(snap)).not.toThrow();
    expect(() => toEvent(snap)).not.toThrow();
    expect(() => toAttendance(snap, 'e1')).not.toThrow();
    expect(() => toRsvp(snap, 'e1')).not.toThrow();
    expect(() => toUserProfile(snap)).not.toThrow();
    expect(() => toEventSeries(snap)).not.toThrow();
    expect(() => toSettings(snap)).not.toThrow();
  });

  forAll('toStudent always yields a student the rest of the app can trust', arbitrarySnapshot, (snap) => {
    const student = toStudent(snap);

    // Grade indexes into UI and into the grade filter; out of band it would
    // silently misplace a child.
    expect(student.grade).toBeGreaterThanOrEqual(6);
    expect(student.grade).toBeLessThanOrEqual(12);
    expect(['active', 'inactive']).toContain(student.status);
    expect(typeof student.firstName).toBe('string');
    expect(typeof student.searchName).toBe('string');
    expect(isRealDate(student.createdAt)).toBe(true);
    expect(isRealDate(student.updatedAt)).toBe(true);
    expect(isRealDateOrNull(student.firstAttendedAt)).toBe(true);
    expect(isRealDateOrNull(student.lastAttendedAt)).toBe(true);
  });

  /**
   * A Firestore student document is Tally's own annotation, never a copy of a
   * Planning Center person. Whatever a stored document claims — including a
   * leftover `profileComplete: true` from before this collection stopped being a
   * mirror — the converter must not assert a fact only Planning Center can know.
   */
  forAll('toStudent never claims to speak for Planning Center', arbitrarySnapshot, (snap) => {
    const student = toStudent(snap);

    expect(student.fromPlanningCenter).toBe(false);
    expect(student.profileComplete).toBe(false);
    expect(student.hasAllergies).toBe(false);
  });

  forAll('toEvent always yields real dates and a valid mode', arbitrarySnapshot, (snap) => {
    const event = toEvent(snap);

    expect(['recurring', 'oneoff']).toContain(event.mode);
    expect(['scheduled', 'cancelled']).toContain(event.status);
    expect(isRealDate(event.startAt)).toBe(true);
    expect(isRealDate(event.endAt)).toBe(true);
    expect(isRealDate(event.checkInOpensAt)).toBe(true);
    expect(isRealDate(event.checkInClosesAt)).toBe(true);
  });

  /**
   * A pending `serverTimestamp()` reads back as null in the optimistic snapshot
   * that `onSnapshot` delivers first. Rendering that as 1970 — or as "Invalid
   * Date" — right after a counselor taps a name is the most visible possible
   * failure.
   */
  forAll('toAttendance never renders an in-flight check-in as an invalid time', arbitrarySnapshot, (snap) => {
    const record = toAttendance(snap, 'e1');

    expect(isRealDate(record.checkedInAt)).toBe(true);
    expect(['tap', 'search', 'quick-add', 'manual']).toContain(record.method);
    expect(record.studentId.length).toBeGreaterThanOrEqual(0);
  });

  forAll('toRsvp always yields a valid status', arbitrarySnapshot, (snap) => {
    const rsvp = toRsvp(snap, 'e1');

    expect(['yes', 'no', 'maybe']).toContain(rsvp.status);
    expect(isRealDate(rsvp.updatedAt)).toBe(true);
  });

  /**
   * Least privilege on unknown input. A document with a garbage `role` must not
   * become an admin, and one with a garbage `active` must not become authorised.
   */
  forAll('toUserProfile never invents privilege', arbitrarySnapshot, (snap) => {
    const profile = toUserProfile(snap);

    expect(['counselor', 'core', 'admin']).toContain(profile.role);
    expect(typeof profile.active).toBe('boolean');
    if (typeof snap.data()?.role !== 'string') expect(profile.role).toBe('counselor');
    if (typeof snap.data()?.active !== 'boolean') expect(profile.active).toBe(false);
  });



  /**
   * `predictiveOfLastN` of 0 would make the Recent filter silently vanish, and a
   * minimum above the window would do the same. Both read to a counselor as
   * "the app is broken", so the converter clamps rather than trusting.
   */
  forAll('toSettings always yields a usable predictive window', arbitrarySnapshot, (snap) => {
    const settings = toSettings(snap);

    expect(settings.predictiveOfLastN).toBeGreaterThanOrEqual(1);
    expect(settings.predictiveOfLastN).toBeLessThanOrEqual(12);
    expect(settings.predictiveMinAttended).toBeGreaterThanOrEqual(1);
    expect(settings.predictiveMinAttended).toBeLessThanOrEqual(settings.predictiveOfLastN);
    expect(settings.miaConsecutiveMisses).toBeGreaterThanOrEqual(1);
    expect(settings.newVisitorWindowDays).toBeGreaterThanOrEqual(1);
  });

  forAll('toEventSeries yields a usable weekly template', arbitrarySnapshot, (snap) => {
    const series = toEventSeries(snap);

    expect(Number.isFinite(series.dayOfWeek)).toBe(true);
    expect(typeof series.startTime).toBe('string');
  });

  /**
   * A document with `__proto__` as a key must not reach `Object.prototype`.
   * `arbitraryFirestoreData` emits that key deliberately; this asserts the
   * blast radius stayed at zero.
   */
  forAll('no document can pollute Object.prototype', arbitrarySnapshot, (snap) => {
    toStudent(snap);
    toEvent(snap);
    toSettings(snap);
    toUserProfile(snap);

    const polluted = {} as Record<string, unknown>;
    expect(polluted.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });
});
