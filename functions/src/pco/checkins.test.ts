/**
 * The import's pure planning layer, poked at the edges the fixture organisation
 * deliberately does not reach: rules for frequencies the church does not use,
 * windows when the kiosk recorded none, and upstream data that contradicts
 * itself. Everything here runs on hand-built histories — no simulator, no
 * client — because what is under test is a decision, not a request.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MINISTRY_TIME_ZONE } from '../occurrences.js';
import { planImport, recurrenceFor, checkInsRootEventId } from './checkins.js';
import type { JsonApiResource } from './types.js';

const NOW = new Date('2026-07-01T12:00:00Z');

/** The shape `fetchCheckInsHistory` produces, built by hand. */
function history(input: {
  periods?: JsonApiResource[];
  checkIns?: JsonApiResource[];
  eventTimes?: Map<string, JsonApiResource[]>;
  frequency?: string | null;
}) {
  return {
    eventId: 'E1',
    eventName: 'Friday Fellowship',
    frequency: input.frequency ?? 'Weekly',
    periods: input.periods ?? [],
    eventTimesByPeriod: input.eventTimes ?? new Map<string, JsonApiResource[]>(),
    checkIns: input.checkIns ?? [],
    persons: new Map(),
  };
}

function period(id: string, startsAt: string | null, endsAt: string | null = null): JsonApiResource {
  return { id, type: 'EventPeriod', attributes: { starts_at: startsAt, ends_at: endsAt } };
}

function checkIn(
  id: string,
  periodId: string,
  personId: string | null,
  createdAt: string,
  kind = 'Regular',
): JsonApiResource {
  return {
    id,
    type: 'CheckIn',
    attributes: { kind, created_at: createdAt },
    relationships: {
      event_period: { data: { type: 'EventPeriod', id: periodId } },
      person: { data: personId === null ? null : { type: 'Person', id: personId } },
    },
  };
}

const originalTz = process.env.TZ;

beforeEach(() => {
  process.env.TZ = MINISTRY_TIME_ZONE;
});

afterEach(() => {
  process.env.TZ = originalTz;
});

describe('recurrenceFor', () => {
  it('reads "Daily" as Tally does: weekly on every day', () => {
    const rule = recurrenceFor('Daily', new Date('2026-06-27T02:30:00Z'));
    expect(rule).toMatchObject({ frequency: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] });
  });

  it('anchors a weekly rule on the local weekday, not the UTC one', () => {
    // Saturday 02:30 UTC is Friday evening in the ministry's zone.
    const rule = recurrenceFor('Weekly', new Date('2026-06-27T02:30:00Z'));
    expect(rule?.weekdays).toEqual([5]);
  });

  it('reads anything unrecognised as "does not repeat"', () => {
    expect(recurrenceFor('None', NOW)).toBeNull();
    expect(recurrenceFor(null, NOW)).toBeNull();
    expect(recurrenceFor('Fortnightly-ish', NOW)).toBeNull();
  });
});

describe('planImport', () => {
  it('invents a window and an end for a period the kiosk recorded none for', () => {
    const plan = planImport(
      history({
        periods: [period('P1', '2026-06-06T02:30:00Z')],
        checkIns: [checkIn('C1', 'P1', '44', '2026-06-06T02:31:00Z')],
      }),
      NOW,
    );

    const event = plan.events[0]!;
    // Two hours long, opening half an hour before — the shape of a gathering,
    // not a guess anybody has to notice.
    expect(event.endAt.toISOString()).toBe('2026-06-06T04:30:00.000Z');
    expect(event.checkInOpensAt.toISOString()).toBe('2026-06-06T02:00:00.000Z');
    expect(event.checkInClosesAt.toISOString()).toBe('2026-06-06T04:30:00.000Z');
  });

  it('drops check-ins whose gathering has no date, and says so', () => {
    const plan = planImport(
      history({
        periods: [period('P1', null)],
        checkIns: [checkIn('C1', 'P1', '44', '2026-06-06T02:31:00Z')],
      }),
      NOW,
    );

    expect(plan.events).toHaveLength(0);
    expect(plan.attendance).toHaveLength(0);
    // Never silently: a dropped check-in is a student whose night vanished.
    expect(plan.warnings.join(' ')).toContain('no date');
  });

  it('keeps the first of two gatherings that share a local calendar day', () => {
    // Tally's id scheme admits one occurrence of a chain per day, on purpose.
    const plan = planImport(
      history({
        periods: [
          period('P1', '2026-06-06T02:30:00Z'),
          period('P2', '2026-06-06T04:00:00Z'),
          period('P3', '2026-06-13T02:30:00Z'),
        ],
        checkIns: [
          checkIn('C1', 'P1', '44', '2026-06-06T02:31:00Z'),
          checkIn('C2', 'P2', '55', '2026-06-06T04:01:00Z'),
          checkIn('C3', 'P3', '44', '2026-06-13T02:31:00Z'),
        ],
      }),
      NOW,
    );

    expect(plan.events.map((event) => event.pcoPeriodId)).toEqual(['P1', 'P3']);
    expect(plan.warnings.join(' ')).toContain('share');
    // And the skipped night's check-ins went with it rather than landing on
    // the survivor and inflating its head count.
    expect(plan.attendance.map((row) => row.studentId)).toEqual(['pco_44', 'pco_44']);
  });

  it('derives the root from the earliest attended night, not the earliest night', () => {
    const plan = planImport(
      history({
        periods: [
          // The chronologically first period was empty — it must not become
          // the root, because it is not imported at all.
          period('P1', '2026-05-30T02:30:00Z'),
          period('P2', '2026-06-06T02:30:00Z'),
          period('P3', '2026-06-13T02:30:00Z'),
        ],
        checkIns: [
          checkIn('C1', 'P2', '44', '2026-06-06T02:31:00Z'),
          checkIn('C2', 'P3', '44', '2026-06-13T02:31:00Z'),
        ],
      }),
      NOW,
    );

    const root = checkInsRootEventId('E1');
    expect(plan.events.map((event) => event.id)).toEqual([root, `${root}-2026-06-12`]);
    expect(plan.skipped.emptyPeriods).toBe(1);
  });

  it('spans a student’s dates across nights, not across check-in timestamps', () => {
    // Attendance was recorded a day late — real churches do this — but the
    // student's first-attended date is the night itself.
    const plan = planImport(
      history({
        periods: [period('P1', '2026-06-06T02:30:00Z', '2026-06-06T04:30:00Z')],
        checkIns: [checkIn('C1', 'P1', '44', '2026-06-07T18:00:00Z')],
      }),
      NOW,
    );

    expect(plan.students[0]!.firstAttendedAt.toISOString()).toBe('2026-06-06T02:30:00.000Z');
    // The row itself keeps the honest recorded time.
    expect(plan.attendance[0]!.checkedInAt.toISOString()).toBe('2026-06-07T18:00:00.000Z');
  });
});
