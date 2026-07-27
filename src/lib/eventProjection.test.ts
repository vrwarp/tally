/**
 * Unit tests for the merged calendar.
 *
 * `materialize.test.ts` covers which occurrences the rules describe. This is
 * about the seam every screen sits on: that a projected gathering is a
 * `TallyEvent` in every respect that matters, that a document always wins, and
 * that the array handed to the app is stable when nothing has changed.
 */
import { describe, expect, it } from 'vitest';
import { calendarSignature, projectEvents } from '@/lib/eventProjection';
import type { RecurrenceRule, TallyEvent } from '@/types';
import { makeEvent } from '../../tests/factories';

/** Fri 24 Jul 2026, 19:00 local. */
const FRIDAY = new Date(2026, 6, 24, 19, 0);

const WEEKLY: RecurrenceRule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [5],
  monthlyMode: 'dayOfMonth',
  until: null,
  count: null,
};

function friday(overrides: Partial<TallyEvent> = {}): TallyEvent {
  const startAt = overrides.startAt ?? FRIDAY;
  const endAt = overrides.endAt ?? new Date(startAt.getTime() + 2 * 3_600_000);
  return makeEvent({
    id: 'friday-fellowship-2026-07-24',
    title: 'Friday Fellowship',
    seriesId: 'friday-fellowship',
    recurrence: WEEKLY,
    location: 'Fellowship Hall',
    startAt,
    endAt,
    checkInOpensAt: new Date(startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(endAt.getTime() + 3_600_000),
    ...overrides,
  });
}

describe('projectEvents', () => {
  it('puts the rule’s gatherings on the calendar alongside the documents', () => {
    const calendar = projectEvents([friday()], FRIDAY);

    // The seed plus every Friday inside the horizon, newest first — the order
    // `subscribeEvents` delivers, so consumers reading the query are unchanged.
    expect(calendar).toHaveLength(9);
    expect(calendar[0]?.id).toBe('friday-fellowship-2026-09-18');
    expect(calendar.at(-1)?.id).toBe('friday-fellowship-2026-07-24');
  });

  it('marks which half a gathering came from', () => {
    const calendar = projectEvents([friday()], FRIDAY);

    expect(calendar.find((event) => event.id === 'friday-fellowship-2026-07-24')?.materialized).toBe(
      true,
    );
    expect(calendar.find((event) => event.id === 'friday-fellowship-2026-07-31')?.materialized).toBe(
      false,
    );
  });

  it('gives a projected gathering the shape of its chain', () => {
    const next = projectEvents([friday()], FRIDAY).find(
      (event) => event.id === 'friday-fellowship-2026-07-31',
    );

    expect(next?.title).toBe('Friday Fellowship');
    expect(next?.location).toBe('Fellowship Hall');
    expect(next?.seriesId).toBe('friday-fellowship');
    expect(next?.recurrence).toEqual(WEEKLY);
    // The chain's root, so `chainKey` groups it with its own history.
    expect(next?.recurrenceRootId).toBe('friday-fellowship-2026-07-24');
    expect(next?.startAt).toEqual(new Date(2026, 6, 31, 19, 0));
    expect(next?.checkInOpensAt).toEqual(new Date(2026, 6, 31, 18, 0));
    expect(next?.status).toBe('scheduled');
    // A recurring gathering is never an RSVP list.
    expect(next?.requiresRsvp).toBe(false);
  });

  it('inherits the bookkeeping fields rather than inventing them', () => {
    // `updatedAt` is load-bearing: the editor keys its form reset on it, and a
    // value that moved every render would reset the form under a leader.
    const template = friday({ updatedAt: new Date(2026, 5, 1, 9, 0), createdBy: 'leader-1' });
    const next = projectEvents([template], FRIDAY).find(
      (event) => event.id === 'friday-fellowship-2026-07-31',
    );

    expect(next?.updatedAt).toEqual(new Date(2026, 5, 1, 9, 0));
    expect(next?.createdBy).toBe('leader-1');
  });

  it('lets a document stand in for its own projection', () => {
    // Cancelled, moved, or simply materialised — all the same rule. The night
    // appears once, as the document.
    const cancelled = friday({
      id: 'friday-fellowship-2026-07-31',
      startAt: new Date(2026, 6, 31, 19, 0),
      status: 'cancelled',
    });

    const calendar = projectEvents([friday(), cancelled], FRIDAY);
    const thatNight = calendar.filter((event) => event.id === 'friday-fellowship-2026-07-31');

    expect(thatNight).toHaveLength(1);
    expect(thatNight[0]?.status).toBe('cancelled');
    expect(thatNight[0]?.materialized).toBe(true);
  });

  it('hands back the documents untouched when nothing repeats', () => {
    const retreat = friday({ id: 'retreat', mode: 'oneoff', seriesId: null, recurrence: null });
    expect(projectEvents([retreat], FRIDAY)).toEqual([retreat]);
  });
});

describe('calendarSignature', () => {
  it('is stable across a recomputation that changed nothing', () => {
    // The property the data provider leans on: the projection is rebuilt on
    // every clock tick, and an identical calendar must not re-render the app.
    const stored = [friday()];
    const first = projectEvents(stored, FRIDAY);
    const second = projectEvents(stored, new Date(FRIDAY.getTime() + 60_000));

    expect(first).not.toBe(second);
    expect(calendarSignature(first)).toBe(calendarSignature(second));
  });

  it('changes when a gathering is called off', () => {
    const before = projectEvents([friday()], FRIDAY);
    const after = projectEvents(
      [
        friday(),
        friday({
          id: 'friday-fellowship-2026-07-31',
          startAt: new Date(2026, 6, 31, 19, 0),
          status: 'cancelled',
        }),
      ],
      FRIDAY,
    );

    expect(calendarSignature(before)).not.toBe(calendarSignature(after));
  });

  it('changes when the schedule itself changes', () => {
    const weekly = projectEvents([friday()], FRIDAY);
    const monthly = projectEvents(
      [friday({ recurrence: { ...WEEKLY, frequency: 'monthly', weekdays: [] } })],
      FRIDAY,
    );

    expect(calendarSignature(weekly)).not.toBe(calendarSignature(monthly));
  });
});
