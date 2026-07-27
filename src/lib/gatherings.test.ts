import { describe, expect, it } from 'vitest';
import { gatheringOptions, predictionChain } from '@/lib/gatherings';
import type { EventSeries } from '@/types';
import { makeEvent } from '../../tests/factories';

const FRIDAY = 'friday-fellowship';

const makeSeries = (overrides: Partial<EventSeries>): EventSeries => ({
  id: FRIDAY,
  title: 'Friday Fellowship',
  dayOfWeek: 5,
  startTime: '19:00',
  endTime: '21:00',
  checkInOpensMinutesBefore: 60,
  checkInClosesMinutesAfter: 60,
  active: true,
  order: 1,
  ...overrides,
});

describe('predictionChain', () => {
  it('reads a recurring gathering’s own series', () => {
    expect(predictionChain(makeEvent({ id: 'e1', seriesId: FRIDAY }))).toBe(FRIDAY);
  });

  it('falls back to the recurrence root, then to the event itself', () => {
    const rooted = makeEvent({ id: 'e2', seriesId: null, recurrenceRootId: 'saturday-root' });
    const lone = makeEvent({ id: 'e3', seriesId: null, recurrenceRootId: null });

    expect(predictionChain(rooted)).toBe('saturday-root');
    expect(predictionChain(lone)).toBe('e3');
  });

  it('gives a one-off the gathering it borrows, and nothing otherwise', () => {
    const borrowing = makeEvent({ id: 'r1', mode: 'oneoff', predictFromChain: FRIDAY });
    // With a `seriesId` still on it, which a trip must never predict from: it
    // says which chain this event is *in*, and a trip is in none.
    const plain = makeEvent({ id: 'r2', mode: 'oneoff', predictFromChain: null });

    expect(predictionChain(borrowing)).toBe(FRIDAY);
    expect(predictionChain(plain)).toBeNull();
  });
});

describe('gatheringOptions', () => {
  const friday = (weeksAgo: number) =>
    makeEvent({
      id: `${FRIDAY}-${weeksAgo}`,
      seriesId: FRIDAY,
      title: 'Friday Fellowship',
      startAt: new Date(2026, 1, 13 - weeksAgo * 7, 19, 0),
    });

  const saturday = (weeksAgo: number, title = 'Saturday Small Group') =>
    makeEvent({
      id: `sat-${weeksAgo}`,
      seriesId: null,
      recurrenceRootId: 'saturday-root',
      title,
      startAt: new Date(2026, 1, 14 - weeksAgo * 7, 10, 0),
    });

  it('returns one entry per chain, not one per instance', () => {
    const options = gatheringOptions([friday(1), friday(2), friday(3), saturday(1)]);

    expect(options.map((option) => option.key).sort()).toEqual([FRIDAY, 'saturday-root']);
  });

  /*
   * The reason this reads events rather than the `eventSeries` collection:
   * nothing in the app creates a series document, so a gathering a leader
   * scheduled here would otherwise be missing from the list entirely.
   */
  it('includes a chain held together by a recurrence root alone', () => {
    const options = gatheringOptions([saturday(1)]);

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ key: 'saturday-root', title: 'Saturday Small Group' });
  });

  it('titles a chain from its series document, so a rename carries', () => {
    const options = gatheringOptions(
      [friday(1)],
      [makeSeries({ id: FRIDAY, title: 'Friday Night Live' })],
    );

    expect(options[0]!.title).toBe('Friday Night Live');
  });

  it('titles a chain with no series from its latest instance', () => {
    const options = gatheringOptions([saturday(3, 'The old name'), saturday(1, 'What it is now')]);

    expect(options[0]!.title).toBe('What it is now');
  });

  it('puts the most recently active gathering first', () => {
    const options = gatheringOptions([saturday(4), friday(1)]);

    expect(options.map((option) => option.key)).toEqual([FRIDAY, 'saturday-root']);
  });

  it('leaves one-off events out — a trip is not a gathering to borrow from', () => {
    const options = gatheringOptions([
      friday(1),
      makeEvent({ id: 'retreat', mode: 'oneoff', seriesId: null, predictFromChain: FRIDAY }),
    ]);

    expect(options.map((option) => option.key)).toEqual([FRIDAY]);
  });
});
