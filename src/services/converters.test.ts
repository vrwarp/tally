/**
 * Unit tests for the Firestore -> domain mappers.
 *
 * These run against a hand-rolled snapshot stub rather than the emulator: the
 * behaviour worth pinning is what the mappers do with *bad or in-flight* data —
 * a stale denormalised flag, a `serverTimestamp()` that has not landed yet, a
 * role nobody recognises — and none of that needs a real database.
 */
import { describe, expect, it } from 'vitest';
import { Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import {
  toAttendance,
  toDate,
  toDateOrNull,
  toEvent,
  toEventSeries,
  toRsvp,
  toSettings,
  toStudent,
  toUserProfile,
} from '@/services/converters';
import { DEFAULT_SETTINGS } from '@/types';

/**
 * The minimum of `DocumentSnapshot` the converters actually touch. Cast rather
 * than mocked, so a converter reaching for anything else fails loudly.
 */
function fakeSnapshot(options: {
  id?: string;
  data?: DocumentData;
  exists?: boolean;
  hasPendingWrites?: boolean;
} = {}): DocumentSnapshot<DocumentData> {
  const { id = 'doc-1', data = {}, exists = true, hasPendingWrites = false } = options;
  return {
    id,
    data: () => (exists ? data : undefined),
    exists: () => exists,
    metadata: { hasPendingWrites, fromCache: hasPendingWrites },
  } as unknown as DocumentSnapshot<DocumentData>;
}

const ts = (date: Date) => Timestamp.fromDate(date);

/* -------------------------------------------------------------------------- */
/* Primitive coercion                                                          */
/* -------------------------------------------------------------------------- */

describe('toDate / toDateOrNull', () => {
  const when = new Date(2026, 1, 13, 19, 0);

  it('accepts Timestamps, Dates and epoch millis', () => {
    expect(toDate(ts(when), new Date(0))).toEqual(when);
    expect(toDate(when, new Date(0))).toEqual(when);
    expect(toDate(when.getTime(), new Date(0))).toEqual(when);
  });

  it('falls back for anything else', () => {
    const fallback = new Date(2020, 0, 1);
    expect(toDate(null, fallback)).toBe(fallback);
    expect(toDate(undefined, fallback)).toBe(fallback);
    expect(toDate('2026-02-13', fallback)).toBe(fallback);
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull('nope')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* toStudent                                                                   */
/* -------------------------------------------------------------------------- */

describe('toStudent', () => {
  it('never claims a profile is complete', () => {
    // Only Planning Center knows whether a parent can be reached, and a Tally
    // document is not Planning Center. A leftover `profileComplete: true` from
    // before this collection stopped being a mirror must not be believed —
    // it would hide a student from the list the core team uses to chase
    // missing contact details.
    const understated = toStudent(
      fakeSnapshot({
        data: { profileComplete: true, parentPhone: '555-0100', parentEmail: 'a@b.org' },
      }),
    );

    expect(understated.profileComplete).toBe(false);
    expect(understated.fromPlanningCenter).toBe(false);
  });

  it('stops answering for a visitor once their push has landed', () => {
    /*
     * `false` means "nobody can be reached about them", and a document is only
     * entitled to say that while there is nowhere upstream for a parent to
     * live. After the push there is: the answer belongs to Planning Center, and
     * `null` — nobody asked — is what lets it be given.
     *
     * Said `false` regardless once, on the reasoning that a roster entry wins
     * as soon as Planning Center knows them. It does, while the roster is
     * carrying them; it is not in the gap after a push, nor for anybody the
     * roster read could not resolve. In that gap a contact Tally had just
     * written upstream could not clear the flag, so the student stayed on the
     * "incomplete profiles" list permanently.
     */
    const pushed = toStudent(fakeSnapshot({ data: { pcoPersonId: '4200099' } }));

    expect(pushed.profileComplete).toBeNull();
    // Still Tally's document, whatever it now points at.
    expect(pushed.fromPlanningCenter).toBe(false);
  });

  it('answers for a visitor who exists nowhere else', () => {
    const own = toStudent(fakeSnapshot({ data: { pcoPersonId: null } }));

    expect(own.profileComplete).toBe(false);
  });

  it('leaves attendance markers null until the student has been checked in', () => {
    const student = toStudent(fakeSnapshot({ data: {} }));
    expect(student.firstAttendedAt).toBeNull();
    expect(student.lastAttendedAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* toAttendance — the pending serverTimestamp case                             */
/* -------------------------------------------------------------------------- */

describe('toAttendance', () => {
  it('dates a locally-pending check-in to now, not to the epoch', () => {
    // What `onSnapshot` delivers between the tap and the server ack.
    const before = Date.now();
    const record = toAttendance(
      fakeSnapshot({
        id: 'student-7',
        data: { studentId: 'student-7', checkedInAt: null, method: 'tap' },
        hasPendingWrites: true,
      }),
      'event-1',
    );
    const after = Date.now();

    expect(record.checkedInAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(record.checkedInAt.getTime()).toBeLessThanOrEqual(after);
    expect(Number.isNaN(record.checkedInAt.getTime())).toBe(false);
    expect(record.checkedInAt.getTime()).toBeGreaterThan(0);
  });

  it('does not invent a time for a confirmed record that is genuinely missing one', () => {
    const record = toAttendance(
      fakeSnapshot({ data: { studentId: 'student-7' }, hasPendingWrites: false }),
      'event-1',
    );
    expect(record.checkedInAt.getTime()).toBe(0);
  });

  it('uses the server timestamp once it lands', () => {
    const checkedInAt = new Date(2026, 1, 13, 19, 32);
    const record = toAttendance(
      fakeSnapshot({ data: { checkedInAt: ts(checkedInAt) } }),
      'event-1',
    );
    expect(record.checkedInAt).toEqual(checkedInAt);
  });

  it('falls back to the document id for studentId and to the argument for eventId', () => {
    const record = toAttendance(fakeSnapshot({ id: 'student-7', data: {} }), 'event-99');
    expect(record.id).toBe('student-7');
    expect(record.studentId).toBe('student-7');
    expect(record.eventId).toBe('event-99');
  });

  it('coerces an unrecognised check-in method to "tap"', () => {
    expect(toAttendance(fakeSnapshot({ data: { method: 'telepathy' } }), 'e').method).toBe('tap');
    expect(toAttendance(fakeSnapshot({ data: {} }), 'e').method).toBe('tap');
    expect(toAttendance(fakeSnapshot({ data: { method: 'quick-add' } }), 'e').method).toBe(
      'quick-add',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* toEvent                                                                     */
/* -------------------------------------------------------------------------- */

describe('toEvent', () => {
  it('defaults a one-off to requiring RSVPs when the flag is absent', () => {
    expect(toEvent(fakeSnapshot({ data: { mode: 'oneoff' } })).requiresRsvp).toBe(true);
  });

  it('does not default a recurring event to requiring RSVPs', () => {
    expect(toEvent(fakeSnapshot({ data: { mode: 'recurring' } })).requiresRsvp).toBe(false);
    expect(toEvent(fakeSnapshot({ data: {} })).requiresRsvp).toBe(false);
  });

  it('honours an explicit flag in either direction', () => {
    expect(
      toEvent(fakeSnapshot({ data: { mode: 'oneoff', requiresRsvp: false } })).requiresRsvp,
    ).toBe(false);
    expect(
      toEvent(fakeSnapshot({ data: { mode: 'recurring', requiresRsvp: true } })).requiresRsvp,
    ).toBe(true);
  });

  it('reads a description, and treats an empty one as absent', () => {
    expect(toEvent(fakeSnapshot({ data: { description: 'Pizza and a talk.' } })).description).toBe(
      'Pizza and a talk.',
    );
    expect(toEvent(fakeSnapshot({ data: { description: '' } })).description).toBeNull();
    expect(toEvent(fakeSnapshot({ data: {} })).description).toBeNull();
  });

  it('keeps an icon the app can actually draw', () => {
    expect(toEvent(fakeSnapshot({ data: { icon: 'church' } })).icon).toBe('church');
  });

  it('drops an icon that is not in the catalogue', () => {
    // A name from a future version, or one somebody typed into the console. An
    // empty tile in a list of full ones reads as a bug; no tile reads as "this
    // gathering has no icon", which is true.
    expect(toEvent(fakeSnapshot({ data: { icon: 'rocket_launch_2000' } })).icon).toBeNull();
    expect(toEvent(fakeSnapshot({ data: { icon: 42 } })).icon).toBeNull();
    expect(toEvent(fakeSnapshot({ data: {} })).icon).toBeNull();
  });

  it('coerces an unknown mode to recurring', () => {
    expect(toEvent(fakeSnapshot({ data: { mode: 'festival' } })).mode).toBe('recurring');
  });

  it('cascades missing window boundaries off the start time', () => {
    const startAt = new Date(2026, 1, 13, 19, 0);
    const event = toEvent(fakeSnapshot({ data: { startAt: ts(startAt) } }));

    expect(event.startAt).toEqual(startAt);
    expect(event.endAt).toEqual(startAt);
    expect(event.checkInOpensAt).toEqual(startAt);
    expect(event.checkInClosesAt).toEqual(startAt);
  });

  it('names an untitled event rather than rendering a blank row', () => {
    expect(toEvent(fakeSnapshot({ data: {} })).title).toBe('Untitled event');
  });

  it('normalises a stored recurrence against the event’s own start', () => {
    const startAt = new Date(2026, 6, 24, 19, 0); // a Friday
    const event = toEvent(
      fakeSnapshot({
        data: {
          startAt: ts(startAt),
          recurrence: { frequency: 'weekly', interval: 0, weekdays: [5, 5, 9], count: 13 },
        },
      }),
    );

    expect(event.recurrence).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [5],
      monthlyMode: 'dayOfMonth',
      until: null,
      count: 13,
    });
  });

  it('reads anything that is not a recurrence rule as "does not repeat"', () => {
    const cases = [undefined, null, 'weekly', 42, [], {}, { frequency: 'fortnightly' }];
    for (const recurrence of cases) {
      expect(toEvent(fakeSnapshot({ data: { recurrence } })).recurrence).toBeNull();
    }
  });

  it('drops a malformed end date rather than making a live series look finished', () => {
    const event = toEvent(
      fakeSnapshot({ data: { recurrence: { frequency: 'weekly', until: '2026-02-31' } } }),
    );
    expect(event.recurrence?.until).toBeNull();
  });

  it('reads a legacy "daily" rule as the every-weekday rule it always meant', () => {
    const event = toEvent(
      fakeSnapshot({ data: { recurrence: { frequency: 'daily', interval: 1 } } }),
    );

    expect(event.recurrence?.frequency).toBe('weekly');
    expect(event.recurrence?.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('ignores a recurrence on a one-off, which happens once by definition', () => {
    expect(
      toEvent(fakeSnapshot({ data: { mode: 'oneoff', recurrence: { frequency: 'weekly' } } }))
        .recurrence,
    ).toBeNull();
  });

  it('only honours an explicit "cancelled" status', () => {
    expect(toEvent(fakeSnapshot({ data: {} })).status).toBe('scheduled');
    expect(toEvent(fakeSnapshot({ data: { status: 'postponed' } })).status).toBe('scheduled');
    expect(toEvent(fakeSnapshot({ data: { status: 'cancelled' } })).status).toBe('cancelled');
  });

  it('leaves seriesId null for a one-off', () => {
    expect(toEvent(fakeSnapshot({ data: { mode: 'oneoff' } })).seriesId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* toRsvp                                                                      */
/* -------------------------------------------------------------------------- */

describe('toRsvp', () => {
  it('coerces an unrecognised status to "yes" and preserves the real ones', () => {
    expect(toRsvp(fakeSnapshot({ data: { status: 'perhaps' } }), 'e').status).toBe('yes');
    expect(toRsvp(fakeSnapshot({ data: { status: 'no' } }), 'e').status).toBe('no');
    expect(toRsvp(fakeSnapshot({ data: { status: 'maybe' } }), 'e').status).toBe('maybe');
  });

  it('takes the student id from the document id, and the event id from the path', () => {
    const rsvp = toRsvp(fakeSnapshot({ id: 'student-3', data: {} }), 'retreat');
    expect(rsvp).toMatchObject({
      id: 'student-3',
      studentId: 'student-3',
      eventId: 'retreat',
      notes: null,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* toUserProfile                                                               */
/* -------------------------------------------------------------------------- */

describe('toUserProfile', () => {
  it('falls back to the least-privileged role for an unknown value', () => {
    expect(toUserProfile(fakeSnapshot({ data: { role: 'superuser' } })).role).toBe('counselor');
    expect(toUserProfile(fakeSnapshot({ data: { role: 'owner' } })).role).toBe('counselor');
    expect(toUserProfile(fakeSnapshot({ data: { role: null } })).role).toBe('counselor');
    expect(toUserProfile(fakeSnapshot({ data: {} })).role).toBe('counselor');
  });

  it('preserves the roles it does recognise', () => {
    expect(toUserProfile(fakeSnapshot({ data: { role: 'admin' } })).role).toBe('admin');
    expect(toUserProfile(fakeSnapshot({ data: { role: 'core' } })).role).toBe('core');
  });

  it('defaults `active` to false, so a malformed doc grants nothing', () => {
    expect(toUserProfile(fakeSnapshot({ data: {} })).active).toBe(false);
    expect(toUserProfile(fakeSnapshot({ data: { active: true } })).active).toBe(true);
  });

  it('uses the document id as the auth uid', () => {
    expect(toUserProfile(fakeSnapshot({ id: 'uid-abc', data: {} })).id).toBe('uid-abc');
  });
});



/* -------------------------------------------------------------------------- */
/* toEventSeries                                                               */
/* -------------------------------------------------------------------------- */

describe('toEventSeries', () => {
  it('supplies workable defaults for a half-written series', () => {
    expect(toEventSeries(fakeSnapshot({ id: 'friday', data: {} }))).toEqual({
      id: 'friday',
      title: 'friday',
      dayOfWeek: 0,
      startTime: '19:00',
      endTime: '21:00',
      checkInOpensMinutesBefore: 60,
      checkInClosesMinutesAfter: 60,
      active: true,
      order: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* toSettings                                                                  */
/* -------------------------------------------------------------------------- */

describe('toSettings', () => {
  it('returns the defaults for a document that does not exist yet', () => {
    expect(toSettings(fakeSnapshot({ exists: false }))).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps predictiveOfLastN into 1..12', () => {
    expect(toSettings(fakeSnapshot({ data: { predictiveOfLastN: 0 } })).predictiveOfLastN).toBe(1);
    expect(toSettings(fakeSnapshot({ data: { predictiveOfLastN: -4 } })).predictiveOfLastN).toBe(1);
    expect(toSettings(fakeSnapshot({ data: { predictiveOfLastN: 99 } })).predictiveOfLastN).toBe(12);
    expect(toSettings(fakeSnapshot({ data: { predictiveOfLastN: 5 } })).predictiveOfLastN).toBe(5);
  });

  it('never lets predictiveMinAttended exceed the window it is measured against', () => {
    const settings = toSettings(
      fakeSnapshot({ data: { predictiveOfLastN: 3, predictiveMinAttended: 9 } }),
    );
    expect(settings.predictiveMinAttended).toBe(3);

    // The clamp follows the *clamped* window, not the raw one.
    const overshoot = toSettings(
      fakeSnapshot({ data: { predictiveOfLastN: 99, predictiveMinAttended: 50 } }),
    );
    expect(overshoot).toMatchObject({ predictiveOfLastN: 12, predictiveMinAttended: 12 });
  });

  it('keeps predictiveMinAttended at one or above', () => {
    expect(
      toSettings(fakeSnapshot({ data: { predictiveMinAttended: 0 } })).predictiveMinAttended,
    ).toBe(1);
    expect(
      toSettings(fakeSnapshot({ data: { predictiveMinAttended: -2 } })).predictiveMinAttended,
    ).toBe(1);
  });

  it('keeps the MIA and visitor windows at one or above', () => {
    const settings = toSettings(
      fakeSnapshot({ data: { miaConsecutiveMisses: 0, newVisitorWindowDays: -3 } }),
    );
    expect(settings.miaConsecutiveMisses).toBe(1);
    expect(settings.newVisitorWindowDays).toBe(1);
  });

  it('falls back to the defaults for non-numeric values', () => {
    const settings = toSettings(
      fakeSnapshot({
        data: {
          predictiveOfLastN: 'three',
          predictiveMinAttended: null,
          miaConsecutiveMisses: NaN,
          newVisitorWindowDays: undefined,
        },
      }),
    );
    expect(settings).toMatchObject({
      predictiveOfLastN: DEFAULT_SETTINGS.predictiveOfLastN,
      predictiveMinAttended: DEFAULT_SETTINGS.predictiveMinAttended,
      miaConsecutiveMisses: DEFAULT_SETTINGS.miaConsecutiveMisses,
      newVisitorWindowDays: DEFAULT_SETTINGS.newVisitorWindowDays,
    });
  });

  it('maps the audit fields, leaving them null on an unedited document', () => {
    const updatedAt = new Date(2026, 1, 1, 10, 0);
    expect(
      toSettings(fakeSnapshot({ data: { updatedAt: ts(updatedAt), updatedBy: 'uid-1' } })),
    ).toMatchObject({ updatedAt, updatedBy: 'uid-1' });
    expect(toSettings(fakeSnapshot({ data: {} }))).toMatchObject({
      updatedAt: null,
      updatedBy: null,
    });
  });
});
