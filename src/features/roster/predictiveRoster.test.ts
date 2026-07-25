/**
 * Unit tests for the Predictive Roster (PRD 4.2).
 *
 * The headline behaviour — "attended 2 of the last 3 Fridays" — is easy to get
 * approximately right and hard to keep exactly right, so this suite pins the
 * boundaries: the threshold either side, the window edge, and above all *series
 * isolation*, because a bug there is invisible (the Recent block still looks
 * plausible) and it silently destroys the feature's value.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRoster,
  buildSeriesHistory,
  computeWarnings,
  countRecentHits,
  effectiveThreshold,
  isBlocking,
  isEligible,
  studentMatchesGroup,
  type BuildRosterInput,
  type RosterView,
} from '@/features/roster/predictiveRoster';
import type { EventAttendanceSnapshot, RosterEntry, Student, TallyEvent } from '@/types';
import {
  NOW,
  makeAttendance,
  makeEvent,
  makeRsvp,
  makeSettings,
  makeSmallGroup,
  makeSnapshot,
  makeStudent,
  makeWeeklyEvents,
} from '../../../tests/factories';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const FRIDAY = 'friday-fellowship';
const SUNDAY = 'sunday-school';

/** Tonight's gathering — the event a counselor is checking students into. */
const tonight = makeEvent({ id: 'tonight', seriesId: FRIDAY, title: 'Friday Fellowship' });

/** `count` past Fridays, oldest first; `[-1]` is last week. */
const pastFridays = (count: number) => makeWeeklyEvents({ count, seriesId: FRIDAY });

const pastSundays = (count: number) =>
  makeWeeklyEvents({ count, seriesId: SUNDAY, title: 'Sunday School' });

const ids = (entries: readonly RosterEntry[]) => entries.map((entry) => entry.student.id);

/**
 * A student who comes to everything, and who no test ever asks about.
 *
 * A past instance with an empty attendance list reads as a cancelled session, so
 * a Friday that none of a test's *own* students attended still needs somebody
 * through the door to count as a Friday that happened.
 */
const REGULAR = 'regular-who-never-misses';

/** A past instance that definitely happened, plus whoever the test cares about. */
const held = (event: TallyEvent, present: readonly string[] = []) =>
  makeSnapshot(event, [REGULAR, ...present]);

/**
 * `makeEvent` coalesces overrides with `??`, so it cannot express a null
 * `seriesId` — which is exactly what makes an event a one-off. Patch it after.
 */
const makeOneOff = (overrides: Partial<TallyEvent>): TallyEvent => ({
  ...makeEvent({ mode: 'oneoff', ...overrides }),
  seriesId: null,
});

/** buildRoster with everything defaulted to a plain recurring Friday. */
function roster(input: Partial<BuildRosterInput> & { students: readonly Student[] }): RosterView {
  return buildRoster({
    event: tonight,
    attendance: [],
    rsvps: [],
    history: [],
    settings: makeSettings(),
    ...input,
  });
}

/* -------------------------------------------------------------------------- */
/* countRecentHits                                                             */
/* -------------------------------------------------------------------------- */

describe('countRecentHits', () => {
  const [weekC, weekB, weekA] = pastFridays(3);

  it('counts the instances a student was present at', () => {
    const student = makeStudent();
    const history = [
      makeSnapshot(weekA!, [student.id]),
      makeSnapshot(weekB!, []),
      makeSnapshot(weekC!, [student.id]),
    ];
    expect(countRecentHits(student.id, history)).toBe(2);
  });

  it('is zero for a student who appears nowhere, and for empty history', () => {
    expect(countRecentHits('ghost', [makeSnapshot(weekA!, ['someone-else'])])).toBe(0);
    expect(countRecentHits('ghost', [])).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* effectiveThreshold                                                          */
/* -------------------------------------------------------------------------- */

describe('effectiveThreshold', () => {
  const settings = makeSettings({ predictiveMinAttended: 2, predictiveOfLastN: 3 });

  it('uses the configured minimum when enough history exists', () => {
    expect(effectiveThreshold(settings, 3)).toBe(2);
    expect(effectiveThreshold(settings, 10)).toBe(2);
  });

  it('clamps down to the available window on a young series', () => {
    expect(effectiveThreshold(settings, 2)).toBe(2);
    expect(effectiveThreshold(settings, 1)).toBe(1);
  });

  it('never drops below one, even with a nonsensical setting', () => {
    expect(effectiveThreshold(makeSettings({ predictiveMinAttended: 0 }), 3)).toBe(1);
    expect(effectiveThreshold(makeSettings({ predictiveMinAttended: -5 }), 3)).toBe(1);
  });

  it('is unreachable with no history at all, so nothing is predicted', () => {
    expect(effectiveThreshold(settings, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(0 >= effectiveThreshold(settings, 0)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* buildSeriesHistory                                                          */
/* -------------------------------------------------------------------------- */

describe('buildSeriesHistory', () => {
  const settings = makeSettings({ predictiveOfLastN: 3 });

  it('returns the most recent instances of the same series, newest first', () => {
    const fridays = pastFridays(5);
    const snapshots = fridays.map((event) => held(event));

    const history = buildSeriesHistory(tonight, snapshots, settings);

    expect(history.map((snapshot) => snapshot.event.id)).toEqual([
      `${FRIDAY}-1`,
      `${FRIDAY}-2`,
      `${FRIDAY}-3`,
    ]);
  });

  it('excludes the event being checked into — an event never predicts itself', () => {
    const snapshots = [
      makeSnapshot(tonight, ['someone']),
      ...pastFridays(2).map((event) => held(event)),
    ];

    const history = buildSeriesHistory(tonight, snapshots, settings);

    expect(history.map((snapshot) => snapshot.event.id)).not.toContain(tonight.id);
    expect(history).toHaveLength(2);
  });

  it('excludes instances of other series', () => {
    const snapshots = [
      ...pastFridays(2).map((event) => held(event)),
      ...pastSundays(2).map((event) => held(event)),
    ];

    const history = buildSeriesHistory(tonight, snapshots, settings);

    expect(history.every((snapshot) => snapshot.event.seriesId === FRIDAY)).toBe(true);
    expect(history).toHaveLength(2);
  });

  it('excludes cancelled instances', () => {
    const [older, newest] = pastFridays(2);
    const snapshots = [
      // With attendance on it — somebody turned up before the call was made — so
      // the exclusion is the status and nothing else.
      makeSnapshot(makeEvent({ ...newest!, status: 'cancelled' }), [REGULAR]),
      held(older!),
    ];

    const history = buildSeriesHistory(tonight, snapshots, settings);

    expect(history.map((snapshot) => snapshot.event.id)).toEqual([older!.id]);
  });

  /*
   * The cancelled-session rule. A Friday nobody was checked into did not happen,
   * whether or not anybody remembered to mark it, so it cannot be evidence about
   * who is a regular.
   */
  it('excludes an instance nobody was ever checked into', () => {
    const [older, newest] = pastFridays(2);
    const snapshots = [makeSnapshot(newest!, []), held(older!)];

    const history = buildSeriesHistory(tonight, snapshots, settings);

    expect(history.map((snapshot) => snapshot.event.id)).toEqual([older!.id]);
  });

  it('reaches further back rather than letting a cancelled week shrink the window', () => {
    const fridays = pastFridays(5); // oldest first: -5 … -1
    const snapshots = [
      ...fridays.slice(0, 4).map((event) => held(event)),
      makeSnapshot(fridays[4]!, []), // last week, called off
    ];

    const history = buildSeriesHistory(tonight, snapshots, settings);

    // Three instances, not two: the filter runs before the slice, so the storm
    // night costs the window nothing instead of eating one of its slots.
    expect(history.map((snapshot) => snapshot.event.id)).toEqual([
      `${FRIDAY}-2`,
      `${FRIDAY}-3`,
      `${FRIDAY}-4`,
    ]);
  });

  it('returns nothing for an event with no series (a one-off)', () => {
    const retreat = makeOneOff({ id: 'retreat' });
    const snapshots = pastFridays(3).map((event) => held(event));

    expect(buildSeriesHistory(retreat, snapshots, settings)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* studentMatchesGroup                                                         */
/* -------------------------------------------------------------------------- */

describe('studentMatchesGroup', () => {
  const eighthGradeBoys = makeSmallGroup({ id: 'g-8b', grades: [8], gender: 'male' });

  it('lets an explicit assignment win over grade and gender', () => {
    const assigned = makeStudent({ smallGroupId: 'g-8b', grade: 11, gender: 'female' });
    expect(studentMatchesGroup(assigned, eighthGradeBoys)).toBe(true);
  });

  it('excludes a student assigned elsewhere even when grade and gender fit', () => {
    const elsewhere = makeStudent({ smallGroupId: 'g-9g', grade: 8, gender: 'male' });
    expect(studentMatchesGroup(elsewhere, eighthGradeBoys)).toBe(false);
  });

  it('falls back to grade and gender only when the student has no group id', () => {
    expect(
      studentMatchesGroup(makeStudent({ smallGroupId: null, grade: 8, gender: 'male' }), eighthGradeBoys),
    ).toBe(true);
    expect(
      studentMatchesGroup(makeStudent({ smallGroupId: null, grade: 9, gender: 'male' }), eighthGradeBoys),
    ).toBe(false);
    expect(
      studentMatchesGroup(
        makeStudent({ smallGroupId: null, grade: 8, gender: 'female' }),
        eighthGradeBoys,
      ),
    ).toBe(false);
  });

  it('accepts any gender for a mixed group and any grade for an open group', () => {
    const mixed = makeSmallGroup({ id: 'g-mixed', grades: [8], gender: 'mixed' });
    expect(
      studentMatchesGroup(makeStudent({ smallGroupId: null, grade: 8, gender: 'female' }), mixed),
    ).toBe(true);

    const allGrades = makeSmallGroup({ id: 'g-all', grades: [], gender: 'male' });
    expect(
      studentMatchesGroup(makeStudent({ smallGroupId: null, grade: 12, gender: 'male' }), allGrades),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* isEligible                                                                  */
/* -------------------------------------------------------------------------- */

describe('isEligible', () => {
  const recurring = { mode: 'recurring' as const, requiresRsvp: false };
  const retreat = { mode: 'oneoff' as const, requiresRsvp: true };

  it('admits every active student to a recurring event', () => {
    expect(isEligible(makeStudent(), recurring, undefined, false)).toBe(true);
  });

  it('excludes an inactive student from a recurring event', () => {
    expect(isEligible(makeStudent({ status: 'inactive' }), recurring, undefined, false)).toBe(false);
  });

  it('restricts an RSVP event to students who said yes or maybe', () => {
    const student = makeStudent();
    expect(isEligible(student, retreat, makeRsvp({ status: 'yes' }), false)).toBe(true);
    expect(isEligible(student, retreat, makeRsvp({ status: 'maybe' }), false)).toBe(true);
    expect(isEligible(student, retreat, makeRsvp({ status: 'no' }), false)).toBe(false);
    expect(isEligible(student, retreat, undefined, false)).toBe(false);
  });

  it('always admits someone already checked in, so the undo path stays reachable', () => {
    expect(isEligible(makeStudent({ status: 'inactive' }), recurring, undefined, true)).toBe(true);
    expect(isEligible(makeStudent(), retreat, undefined, true)).toBe(true);
    expect(isEligible(makeStudent({ status: 'inactive' }), retreat, makeRsvp({ status: 'no' }), true)).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* computeWarnings / isBlocking                                                */
/* -------------------------------------------------------------------------- */

describe('computeWarnings', () => {
  const noPaperwork = { requiresWaiver: false, requiresPayment: false };
  const fullPaperwork = { requiresWaiver: true, requiresPayment: true };
  const clean = makeStudent({ hasAllergies: false, profileComplete: true });

  it('stays quiet about paperwork the event does not require', () => {
    expect(computeWarnings(clean, noPaperwork, undefined)).toEqual([]);
    expect(computeWarnings(clean, noPaperwork, makeRsvp({ waiverSigned: false }))).toEqual([]);
  });

  it('flags a missing waiver and payment when the event requires them', () => {
    expect(computeWarnings(clean, fullPaperwork, undefined)).toEqual([
      'missing-waiver',
      'missing-payment',
    ]);
    expect(
      computeWarnings(clean, fullPaperwork, makeRsvp({ waiverSigned: true, paymentReceived: false })),
    ).toEqual(['missing-payment']);
    expect(
      computeWarnings(clean, fullPaperwork, makeRsvp({ waiverSigned: true, paymentReceived: true })),
    ).toEqual([]);
  });

  it('flags allergies and incomplete profiles regardless of the event', () => {
    const needsCare = makeStudent({ hasAllergies: true, profileComplete: false });
    expect(computeWarnings(needsCare, noPaperwork, undefined)).toEqual([
      'allergy',
      'incomplete-profile',
    ]);
    expect(computeWarnings(needsCare, fullPaperwork, undefined)).toEqual([
      'missing-waiver',
      'missing-payment',
      'allergy',
      'incomplete-profile',
    ]);
  });
});

describe('isBlocking', () => {
  it('blocks only on paperwork that would stop a student boarding', () => {
    expect(isBlocking('missing-waiver')).toBe(true);
    expect(isBlocking('missing-payment')).toBe(true);
    expect(isBlocking('allergy')).toBe(false);
    expect(isBlocking('incomplete-profile')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* buildRoster — prediction                                                    */
/* -------------------------------------------------------------------------- */

describe('buildRoster: the 2-of-3 rule', () => {
  const [weekC, weekB, weekA] = pastFridays(3);
  const regular = makeStudent({ id: 'regular', firstName: 'Ada', lastName: 'Abbott' });
  const occasional = makeStudent({ id: 'occasional', firstName: 'Ben', lastName: 'Baker' });

  const history = [
    held(weekA!, [regular.id]),
    held(weekB!, [regular.id, occasional.id]),
    held(weekC!),
  ];

  it('surfaces a student who attended 2 of the last 3, and not one who attended 1', () => {
    const view = roster({ students: [regular, occasional], history });

    expect(ids(view.recent)).toEqual([regular.id]);
    expect(ids(view.roster)).toEqual([occasional.id]);
    expect(view.counts.historyWindow).toBe(3);
  });

  it('reports hits and window on every entry, in both blocks', () => {
    const view = roster({ students: [regular, occasional], history });

    expect(view.recent[0]).toMatchObject({ recentHits: 2, recentWindow: 3, section: 'recent' });
    expect(view.roster[0]).toMatchObject({ recentHits: 1, recentWindow: 3, section: 'roster' });
  });
});

describe('buildRoster: series isolation', () => {
  const fridays = pastFridays(3);
  const sundays = pastSundays(3);

  const fridayRegular = makeStudent({ id: 'friday-regular', firstName: 'Fay', lastName: 'Fields' });
  const sundayRegular = makeStudent({ id: 'sunday-regular', firstName: 'Sam', lastName: 'Stone' });
  const students = [fridayRegular, sundayRegular];

  // One mixed pile of history, exactly as the hook hands it over.
  const snapshots: EventAttendanceSnapshot[] = [
    ...fridays.map((event) => makeSnapshot(event, [fridayRegular.id])),
    ...sundays.map((event) => makeSnapshot(event, [sundayRegular.id])),
  ];

  const sundayEvent = makeEvent({
    id: 'sunday-today',
    title: 'Sunday School',
    seriesId: SUNDAY,
    startAt: new Date(2026, 1, 15, 9, 0),
    endAt: new Date(2026, 1, 15, 10, 30),
  });

  it('does not surface a perfect Sunday attender on the Friday roster', () => {
    const view = roster({ students, history: snapshots });

    expect(ids(view.recent)).toEqual([fridayRegular.id]);
    expect(ids(view.roster)).toEqual([sundayRegular.id]);
    expect(view.roster[0]!.recentHits).toBe(0);
  });

  it('does not surface a perfect Friday attender on the Sunday roster', () => {
    const view = roster({ event: sundayEvent, students, history: snapshots });

    expect(ids(view.recent)).toEqual([sundayRegular.id]);
    expect(ids(view.roster)).toEqual([fridayRegular.id]);
    expect(view.roster[0]!.recentHits).toBe(0);
  });

  it('counts only same-series instances toward the history window', () => {
    const view = roster({ students, history: snapshots });
    expect(view.counts.historyWindow).toBe(3);
  });
});

describe('buildRoster: the history window', () => {
  it('never counts the event being checked into as its own history', () => {
    const student = makeStudent({ id: 'eager' });
    // The only snapshot is tonight's own — which must leave nothing to predict from.
    const view = roster({ students: [student], history: [makeSnapshot(tonight, [student.id])] });

    expect(view.counts.historyWindow).toBe(0);
    expect(view.recent).toEqual([]);
    expect(ids(view.roster)).toEqual([student.id]);
  });

  it('excludes cancelled past instances from the window', () => {
    const [older, newest] = pastFridays(2);
    const stormNight = makeEvent({ ...newest!, status: 'cancelled' });

    const onlyCameToTheCancelledOne = makeStudent({ id: 'snowed-in', lastName: 'Snow' });
    const cameToTheRealOne = makeStudent({ id: 'showed-up', lastName: 'Ames' });

    const view = roster({
      students: [onlyCameToTheCancelledOne, cameToTheRealOne],
      history: [
        makeSnapshot(stormNight, [onlyCameToTheCancelledOne.id]),
        makeSnapshot(older!, [cameToTheRealOne.id]),
      ],
    });

    // One usable instance left, so the threshold clamps to 1.
    expect(view.counts.historyWindow).toBe(1);
    expect(ids(view.recent)).toEqual([cameToTheRealOne.id]);
    expect(ids(view.roster)).toEqual([onlyCameToTheCancelledOne.id]);
  });

  it('does not let a week nobody attended demote a regular out of Recent', () => {
    const fridays = pastFridays(4); // oldest first: -4 … -1
    const regular = makeStudent({ id: 'every-week' });

    const view = roster({
      students: [regular],
      history: [
        held(fridays[0]!, [regular.id]),
        held(fridays[1]!, [regular.id]),
        held(fridays[2]!, [regular.id]),
        // Last week was called off, and nobody marked it.
        makeSnapshot(fridays[3]!, []),
      ],
      settings: makeSettings({ predictiveMinAttended: 3, predictiveOfLastN: 3 }),
    });

    // Perfect attendance at the three Fridays that happened. Counting the storm
    // night as an instance would make this "3 of 3" unreachable for everybody in
    // the ministry at once — the Recent block would simply empty out.
    expect(view.counts.historyWindow).toBe(3);
    expect(view.recent[0]).toMatchObject({ student: regular, recentHits: 3 });
  });

  it('looks only at the most recent predictiveOfLastN instances', () => {
    const fridays = pastFridays(5); // oldest first: -5, -4, -3, -2, -1
    const lapsed = makeStudent({ id: 'lapsed', lastName: 'Lapsed' });
    const current = makeStudent({ id: 'current', lastName: 'Current' });

    const view = roster({
      students: [lapsed, current],
      history: fridays.map((event, index) =>
        // `lapsed` was a regular two months ago; `current` comes every week now.
        makeSnapshot(event, index < 2 ? [lapsed.id, current.id] : [current.id]),
      ),
    });

    expect(view.counts.historyWindow).toBe(3);
    expect(ids(view.recent)).toEqual([current.id]);
    expect(view.roster[0]).toMatchObject({ student: lapsed, recentHits: 0 });
  });
});

describe('buildRoster: threshold clamping on a young series', () => {
  it('surfaces a student from the single instance that has happened', () => {
    const [onlyFriday] = pastFridays(1);
    const student = makeStudent({ id: 'pioneer' });

    const view = roster({
      students: [student],
      history: [makeSnapshot(onlyFriday!, [student.id])],
      settings: makeSettings({ predictiveMinAttended: 2, predictiveOfLastN: 3 }),
    });

    expect(view.counts.historyWindow).toBe(1);
    expect(ids(view.recent)).toEqual([student.id]);
  });

  it('still excludes a student who missed that single instance', () => {
    const [onlyFriday] = pastFridays(1);
    const student = makeStudent({ id: 'absent' });

    const view = roster({ students: [student], history: [held(onlyFriday!)] });

    expect(view.recent).toEqual([]);
    expect(ids(view.roster)).toEqual([student.id]);
  });

  it('leaves the Recent block empty when the series has no history at all', () => {
    const student = makeStudent({ id: 'brand-new' });
    const view = roster({ students: [student], history: [] });

    expect(view.counts.historyWindow).toBe(0);
    expect(view.recent).toEqual([]);
    expect(ids(view.roster)).toEqual([student.id]);
  });
});

describe('buildRoster: custom thresholds', () => {
  it('honours a 3-of-5 configuration', () => {
    const fridays = pastFridays(5);
    const three = makeStudent({ id: 'three', lastName: 'Three' });
    const two = makeStudent({ id: 'two', lastName: 'Two' });

    const view = roster({
      students: [three, two],
      history: fridays.map((event, index) => {
        const present = [REGULAR];
        if (index >= 2) present.push(three.id); // the 3 newest
        if (index >= 3) present.push(two.id); //   the 2 newest
        return makeSnapshot(event, present);
      }),
      settings: makeSettings({ predictiveMinAttended: 3, predictiveOfLastN: 5 }),
    });

    expect(view.counts.historyWindow).toBe(5);
    expect(ids(view.recent)).toEqual([three.id]);
    expect(ids(view.roster)).toEqual([two.id]);
  });

  it('honours a 1-of-2 configuration, window and all', () => {
    const fridays = pastFridays(3); // -3, -2, -1
    const showedUpLastWeek = makeStudent({ id: 'recent-one', lastName: 'Ames' });
    const showedUpLongAgo = makeStudent({ id: 'stale-one', lastName: 'Zane' });

    const view = roster({
      students: [showedUpLastWeek, showedUpLongAgo],
      history: [
        held(fridays[0]!, [showedUpLongAgo.id]), // outside the 2-week window
        held(fridays[1]!),
        held(fridays[2]!, [showedUpLastWeek.id]),
      ],
      settings: makeSettings({ predictiveMinAttended: 1, predictiveOfLastN: 2 }),
    });

    expect(view.counts.historyWindow).toBe(2);
    expect(ids(view.recent)).toEqual([showedUpLastWeek.id]);
    expect(ids(view.roster)).toEqual([showedUpLongAgo.id]);
  });
});

/* -------------------------------------------------------------------------- */
/* buildRoster — eligibility                                                   */
/* -------------------------------------------------------------------------- */

describe('buildRoster: recurring eligibility', () => {
  it('excludes inactive students', () => {
    const active = makeStudent({ id: 'active', lastName: 'Active' });
    const inactive = makeStudent({ id: 'inactive', lastName: 'Gone', status: 'inactive' });

    const view = roster({ students: [active, inactive] });

    expect(ids(view.roster)).toEqual([active.id]);
    expect(view.counts.eligible).toBe(1);
  });

  it('keeps an inactive student who is already checked in, so a mistake can be undone', () => {
    const inactive = makeStudent({ id: 'inactive', status: 'inactive' });
    const view = roster({
      students: [inactive],
      attendance: [makeAttendance({ studentId: inactive.id, eventId: tonight.id })],
    });

    expect(ids(view.checkedIn)).toEqual([inactive.id]);
    expect(view.counts).toMatchObject({ present: 1, eligible: 1, absent: 0 });
  });
});

describe('buildRoster: one-off events', () => {
  const retreat = makeOneOff({
    id: 'retreat',
    title: 'Winter Retreat',
    requiresRsvp: true,
    requiresWaiver: true,
    requiresPayment: true,
    feeCents: 5000,
  });

  const yes = makeStudent({ id: 'yes', lastName: 'Ames' });
  const maybe = makeStudent({ id: 'maybe', lastName: 'Brook' });
  const no = makeStudent({ id: 'no', lastName: 'Crane' });
  const silent = makeStudent({ id: 'silent', lastName: 'Doyle' });

  const rsvps = [
    makeRsvp({ studentId: yes.id, eventId: retreat.id, status: 'yes' }),
    makeRsvp({ studentId: maybe.id, eventId: retreat.id, status: 'maybe' }),
    makeRsvp({ studentId: no.id, eventId: retreat.id, status: 'no' }),
  ];

  it('restricts the roster to students who did not decline', () => {
    const view = roster({ event: retreat, students: [yes, maybe, no, silent], rsvps });

    expect(ids(view.roster)).toEqual([yes.id, maybe.id]);
    expect(view.counts.eligible).toBe(2);
  });

  it('includes a student who turned up despite having no RSVP, once checked in', () => {
    const view = roster({
      event: retreat,
      students: [yes, silent],
      rsvps,
      attendance: [makeAttendance({ studentId: silent.id, eventId: retreat.id })],
    });

    expect(ids(view.checkedIn)).toEqual([silent.id]);
    expect(ids(view.roster)).toEqual([yes.id]);
    expect(view.counts).toMatchObject({ present: 1, eligible: 2 });
  });

  it('includes a student who declined but was checked in anyway', () => {
    const view = roster({
      event: retreat,
      students: [no],
      rsvps,
      attendance: [makeAttendance({ studentId: no.id, eventId: retreat.id })],
    });

    expect(ids(view.checkedIn)).toEqual([no.id]);
    expect(view.checkedIn[0]!.rsvp?.status).toBe('no');
  });

  it('flashes the blocking paperwork warnings and attaches the RSVP', () => {
    const view = roster({ event: retreat, students: [yes], rsvps });

    expect(view.roster[0]!.warnings).toEqual(['missing-waiver', 'missing-payment']);
    expect(view.roster[0]!.warnings.every(isBlocking)).toBe(true);
    expect(view.roster[0]!.rsvp?.studentId).toBe(yes.id);
  });

  it('predicts nothing — a one-off has no series history', () => {
    const view = roster({
      event: retreat,
      students: [yes],
      rsvps,
      history: pastFridays(3).map((event) => makeSnapshot(event, [yes.id])),
    });

    expect(view.counts.historyWindow).toBe(0);
    expect(view.recent).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* buildRoster — search                                                        */
/* -------------------------------------------------------------------------- */

describe('buildRoster: search', () => {
  const marcus = makeStudent({ id: 'marcus', firstName: 'Marcus', lastName: 'Lee' });
  const ana = makeStudent({ id: 'ana', firstName: 'Ana', lastName: 'Martinez' });
  const jose = makeStudent({ id: 'jose', firstName: 'José', lastName: 'García' });
  const students = [marcus, ana, jose];

  // Marcus is a regular; without a query he sits in the Recent block.
  const [weekC, weekB, weekA] = pastFridays(3);
  const history = [
    held(weekA!, [marcus.id]),
    held(weekB!, [marcus.id]),
    held(weekC!),
  ];

  it('is not "filtered" for an empty or whitespace query', () => {
    expect(roster({ students }).isFiltered).toBe(false);
    expect(roster({ students, filters: { query: '' } }).isFiltered).toBe(false);
    expect(roster({ students, filters: { query: '   ' } }).isFiltered).toBe(false);
  });

  it('matches on first name', () => {
    const view = roster({ students, filters: { query: 'marcus' } });
    expect(view.isFiltered).toBe(true);
    expect(ids(view.roster)).toEqual([marcus.id]);
  });

  it('matches on last name', () => {
    expect(ids(roster({ students, filters: { query: 'martinez' } }).roster)).toEqual([ana.id]);
  });

  it('matches a two-letter prefix against either name part', () => {
    expect(ids(roster({ students, filters: { query: 'ma' } }).roster)).toEqual([marcus.id, ana.id]);
    expect(ids(roster({ students, filters: { query: 'le' } }).roster)).toEqual([marcus.id]);
    expect(ids(roster({ students, filters: { query: 'jo' } }).roster)).toEqual([jose.id]);
  });

  it('collapses the Recent block into the roster while a query is active', () => {
    const unfiltered = roster({ students, history });
    expect(ids(unfiltered.recent)).toEqual([marcus.id]);

    const filtered = roster({ students, history, filters: { query: 'marcus' } });
    expect(filtered.recent).toEqual([]);
    expect(ids(filtered.roster)).toEqual([marcus.id]);
  });

  it('keeps the header counts describing the whole roster, not the search result', () => {
    const attendance = [makeAttendance({ studentId: ana.id, eventId: tonight.id })];
    const unfiltered = roster({ students, history, attendance });
    const filtered = roster({ students, history, attendance, filters: { query: 'marcus' } });

    expect(unfiltered.counts).toMatchObject({ present: 1, eligible: 3, absent: 2 });
    // Ana is checked in but does not match "marcus" — the tally must not move.
    expect(filtered.counts).toMatchObject({ present: 1, eligible: 3, absent: 2 });
    expect(filtered.checkedIn).toEqual([]);
  });

  it('returns empty blocks but intact counts when nothing matches', () => {
    const view = roster({ students, history, filters: { query: 'zzz' } });

    expect(view.recent).toEqual([]);
    expect(view.roster).toEqual([]);
    expect(view.checkedIn).toEqual([]);
    expect(view.counts.eligible).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* buildRoster — scoping filters                                               */
/* -------------------------------------------------------------------------- */

describe('buildRoster: group scoping', () => {
  const eighthGradeBoys = makeSmallGroup({ id: 'g-8b', grades: [8], gender: 'male' });

  const assigned = makeStudent({ id: 'assigned', lastName: 'Ames', smallGroupId: 'g-8b', grade: 11, gender: 'female' });
  const byGradeAndGender = makeStudent({ id: 'derived', lastName: 'Brook', smallGroupId: null, grade: 8, gender: 'male' });
  const wrongGrade = makeStudent({ id: 'wrong-grade', lastName: 'Crane', smallGroupId: null, grade: 9, gender: 'male' });
  const assignedElsewhere = makeStudent({ id: 'elsewhere', lastName: 'Doyle', smallGroupId: 'g-9g', grade: 8, gender: 'male' });

  const students = [assigned, byGradeAndGender, wrongGrade, assignedElsewhere];

  it('scopes to the counselor group, explicit assignment winning over the fallback', () => {
    const view = roster({ students, group: eighthGradeBoys });

    expect(ids(view.roster)).toEqual([assigned.id, byGradeAndGender.id]);
    expect(view.counts.eligible).toBe(2);
  });

  it('takes the whole ministry when no group is passed', () => {
    expect(roster({ students }).counts.eligible).toBe(4);
    expect(roster({ students, group: null }).counts.eligible).toBe(4);
  });

  it('filters by explicit small group id without the grade/gender fallback', () => {
    const view = roster({ students, filters: { smallGroupId: 'g-8b' } });
    expect(ids(view.roster)).toEqual([assigned.id]);
  });

  it('filters by grade', () => {
    const view = roster({ students, filters: { grade: 8 } });
    expect(ids(view.roster)).toEqual([byGradeAndGender.id, assignedElsewhere.id]);
  });

  it('filters to incomplete profiles only', () => {
    const missing = makeStudent({ id: 'missing', lastName: 'Nolan', profileComplete: false });
    const view = roster({ students: [...students, missing], filters: { incompleteOnly: true } });

    expect(ids(view.roster)).toEqual([missing.id]);
    expect(view.counts.eligible).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* buildRoster — ordering                                                      */
/* -------------------------------------------------------------------------- */

describe('buildRoster: ordering', () => {
  it('sorts Recent by hits descending, then by name', () => {
    const fridays = pastFridays(3);
    const perfect = makeStudent({ id: 'perfect', firstName: 'Ada', lastName: 'Abbott' });
    const twoLate = makeStudent({ id: 'two-z', firstName: 'Ben', lastName: 'Zimmer' });
    const twoEarly = makeStudent({ id: 'two-b', firstName: 'Cara', lastName: 'Baker' });

    const view = roster({
      students: [twoLate, perfect, twoEarly],
      history: [
        makeSnapshot(fridays[0]!, [perfect.id]),
        makeSnapshot(fridays[1]!, [perfect.id, twoLate.id, twoEarly.id]),
        makeSnapshot(fridays[2]!, [perfect.id, twoLate.id, twoEarly.id]),
      ],
    });

    expect(ids(view.recent)).toEqual([perfect.id, twoEarly.id, twoLate.id]);
    expect(view.recent.map((entry) => entry.recentHits)).toEqual([3, 2, 2]);
  });

  it('sorts the main roster by name', () => {
    const students = [
      makeStudent({ id: 'c', firstName: 'Zoe', lastName: 'Crane' }),
      makeStudent({ id: 'a', firstName: 'Zoe', lastName: 'Ames' }),
      makeStudent({ id: 'b', firstName: 'Abe', lastName: 'Brook' }),
    ];
    expect(ids(roster({ students }).roster)).toEqual(['a', 'b', 'c']);
  });

  it('sorts Checked-in by most recent tap first', () => {
    const first = makeStudent({ id: 'first', lastName: 'Ames' });
    const second = makeStudent({ id: 'second', lastName: 'Brook' });
    const third = makeStudent({ id: 'third', lastName: 'Crane' });

    const view = roster({
      students: [first, second, third],
      attendance: [
        makeAttendance({ studentId: first.id, checkedInAt: new Date(NOW.getTime() + 60_000) }),
        makeAttendance({ studentId: second.id, checkedInAt: new Date(NOW.getTime() + 180_000) }),
        makeAttendance({ studentId: third.id, checkedInAt: new Date(NOW.getTime() + 120_000) }),
      ],
    });

    expect(ids(view.checkedIn)).toEqual([second.id, third.id, first.id]);
    expect(view.roster).toEqual([]);
    expect(view.counts).toMatchObject({ present: 3, eligible: 3, absent: 0 });
  });

  it('never lets a checked-in student linger in Recent', () => {
    const fridays = pastFridays(3);
    const regular = makeStudent({ id: 'regular' });

    const view = roster({
      students: [regular],
      history: fridays.map((event) => makeSnapshot(event, [regular.id])),
      attendance: [makeAttendance({ studentId: regular.id, eventId: tonight.id })],
    });

    expect(view.recent).toEqual([]);
    expect(ids(view.checkedIn)).toEqual([regular.id]);
    expect(view.checkedIn[0]!.section).toBe('checkedIn');
    // The prediction is still reported, for the row's "3 of 3" hint.
    expect(view.checkedIn[0]!.recentHits).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* buildRoster — degenerate inputs                                             */
/* -------------------------------------------------------------------------- */

describe('buildRoster: empty inputs', () => {
  it('returns an empty view rather than throwing', () => {
    const view = roster({ students: [] });

    expect(view).toMatchObject({
      recent: [],
      roster: [],
      checkedIn: [],
      isFiltered: false,
      counts: { present: 0, eligible: 0, absent: 0, historyWindow: 0 },
    });
  });

  it('does not report a negative absent count', () => {
    // The only student is inactive, so they count as eligible solely because
    // they are checked in — `eligible - present` must not go below zero.
    const student = makeStudent({ id: 'only', status: 'inactive' });
    const view = roster({
      students: [student],
      attendance: [makeAttendance({ studentId: student.id, eventId: tonight.id })],
    });

    expect(view.counts.absent).toBe(0);
  });
});
