/**
 * How far back a student's attendance history reaches, and why it is a date.
 *
 * The counts this replaced — eight nights of each gathering, twenty-four in all
 * — were a read budget dressed as an answer. They made the depth of the history
 * depend on how often a gathering meets, so the same page under the same heading
 * showed two months of a weekly chain and two years of a monthly one. A year is
 * the span every neighbouring rule already uses.
 *
 * The other three assertions here are the ones that stop the grid inventing
 * absences: a night still running has not been missed, a night called off was
 * not skipped, and a night nobody attended is a night that did not happen rather
 * than one everybody missed.
 */
import { describe, expect, it } from 'vitest';
import { historyWindow } from '@/features/students/historyWindow';
import { makeEvent } from '../../../tests/factories';

const NOW = new Date('2026-08-02T12:00:00');

/** A finished night `daysAgo` back, of whichever chain. */
function night(daysAgo: number, overrides: Parameters<typeof makeEvent>[0] = {}) {
  const startAt = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return makeEvent({
    id: `night-${daysAgo}`,
    startAt,
    endAt: new Date(startAt.getTime() + 2 * 60 * 60_000),
    ...overrides,
  });
}

describe('historyWindow', () => {
  it('reaches a full year back', () => {
    const picked = historyWindow([night(364), night(30), night(1)], NOW);

    expect(picked.map((event) => event.id)).toEqual(['night-1', 'night-30', 'night-364']);
  });

  it('stops at the year, rather than at a count', () => {
    const picked = historyWindow([night(366), night(400), night(10)], NOW);

    expect(picked.map((event) => event.id)).toEqual(['night-10']);
  });

  /*
   * The point of the change. Fifty-two weekly nights used to be cut to eight,
   * and the cut was invisible: the page said "the last 8 finished nights" and a
   * leader read it as the student's history.
   */
  it('keeps every night of a weekly gathering, not the most recent handful', () => {
    const year = Array.from({ length: 52 }, (_, index) => night(index * 7 + 1));

    expect(historyWindow(year, NOW)).toHaveLength(52);
  });

  /*
   * The failure the per-gathering count existed to paper over, gone at the
   * source: two chains no longer compete for one budget, so a Sunday-only
   * student's history cannot be crowded out by a run of Fridays.
   */
  it('does not let a busy gathering crowd out a quiet one', () => {
    const fridays = Array.from({ length: 40 }, (_, index) =>
      night(index * 7 + 1, { id: `friday-${index}`, seriesId: 'friday' }),
    );
    const sundays = Array.from({ length: 6 }, (_, index) =>
      night(index * 56 + 3, { id: `sunday-${index}`, seriesId: 'sunday' }),
    );

    const picked = historyWindow([...fridays, ...sundays], NOW);

    expect(picked.filter((event) => event.seriesId === 'sunday')).toHaveLength(6);
    expect(picked.filter((event) => event.seriesId === 'friday')).toHaveLength(40);
  });

  it('leaves out a night that has not finished', () => {
    // The gathering somebody is standing in. Counting it would put every student
    // who has not been tapped yet onto a streak, mid-evening.
    const tonight = makeEvent({
      id: 'tonight',
      startAt: new Date(NOW.getTime() - 60 * 60_000),
      endAt: new Date(NOW.getTime() + 60 * 60_000),
      checkInClosesAt: new Date(NOW.getTime() + 2 * 60 * 60_000),
    });

    expect(historyWindow([tonight, night(7)], NOW).map((event) => event.id)).toEqual(['night-7']);
  });

  it('leaves out a night that was called off', () => {
    const picked = historyWindow([night(3, { status: 'cancelled' }), night(10)], NOW);

    expect(picked.map((event) => event.id)).toEqual(['night-10']);
  });

  /*
   * Not the same thing as cancelled, and it has to stay. A scheduled night with
   * nobody checked in is what the grid labels "No one" — evidence the gathering
   * did not happen, which is what keeps it from counting against the student.
   * Dropping it here would take that evidence away and make the streak skip a
   * row for no visible reason.
   */
  it('keeps a night nobody attended, for the grid to label', () => {
    expect(historyWindow([night(5)], NOW).map((event) => event.id)).toEqual(['night-5']);
  });

  it('orders newest first', () => {
    const picked = historyWindow([night(10), night(200), night(2), night(45)], NOW);

    expect(picked.map((event) => event.id)).toEqual([
      'night-2',
      'night-10',
      'night-45',
      'night-200',
    ]);
  });
});
