/**
 * How the Events tab cuts a band into "his" and "somebody else's".
 *
 * The claims are about the partition (restricted gatherings group by chain, not
 * by band), about the order in which groups and their heads read, and about
 * what a chain may state once on its head without hiding an exception.
 */
import { describe, expect, it } from 'vitest';
import { partitionBand, sharedDetail, sharedWeekday } from '@/features/events/lockedChains';
import type { TimeStrings } from '@/lib/time';
import { makeEvent } from '../../../tests/factories';

const strings: TimeStrings = {
  locale: 'en-US',
  t: (_key, values = {}) => `${values.start} to ${values.end}`,
};

const join = ({ window, location }: { window: string; location: string }) =>
  `${window} @ ${location}`;

/** A Friday evening in February 2026, `day` being the date of the month. */
function night(id: string, seriesId: string, day: number, overrides = {}) {
  return makeEvent({
    id,
    seriesId,
    title: seriesId,
    startAt: new Date(2026, 1, day, 19, 0),
    endAt: new Date(2026, 1, day, 21, 0),
    ...overrides,
  });
}

describe('partitionBand', () => {
  it('keeps the reader\'s own gatherings in the order they arrived', () => {
    const a = night('a', 'mine', 20);
    const b = night('b', 'mine', 13);
    const { own, locked } = partitionBand([a, b], () => true, 'asc');
    expect(own).toEqual([a, b]);
    expect(locked).toEqual([]);
  });

  it('groups what the reader cannot work by chain, not by band', () => {
    const youth1 = night('y1', 'youth', 13);
    const youth2 = night('y2', 'youth', 20);
    const choir = night('c1', 'choir', 14);
    const { own, locked } = partitionBand([youth1, choir, youth2], () => false, 'asc');
    expect(own).toEqual([]);
    expect(locked.map((group) => group.key)).toEqual(['youth', 'choir']);
    expect(locked[0]!.events).toEqual([youth1, youth2]);
  });

  it('reads ascending ahead of today: next up first, in groups and within them', () => {
    const later = night('y2', 'youth', 27);
    const sooner = night('y1', 'youth', 20);
    const choir = night('c1', 'choir', 13);
    const { locked } = partitionBand([later, sooner, choir], () => false, 'asc');
    expect(locked.map((group) => group.key)).toEqual(['choir', 'youth']);
    expect(locked[1]!.events).toEqual([sooner, later]);
  });

  it('reads descending behind today: latest first, in groups and within them', () => {
    const older = night('y1', 'youth', 6);
    const newer = night('y2', 'youth', 13);
    const choir = night('c1', 'choir', 20);
    const { locked } = partitionBand([older, choir, newer], () => false, 'desc');
    expect(locked.map((group) => group.key)).toEqual(['choir', 'youth']);
    expect(locked[1]!.events).toEqual([newer, older]);
  });

  it('labels a group with the gathering\'s title', () => {
    const { locked } = partitionBand([night('y1', 'youth', 13)], () => false, 'asc');
    expect(locked[0]!.label).toBe('youth');
  });
});

describe('sharedDetail', () => {
  it('says nothing about an empty chain', () => {
    expect(sharedDetail(strings, join, [])).toBeNull();
  });

  it('states the window and the room once when every night agrees', () => {
    const events = [
      night('a', 's', 13, { location: 'Hall' }),
      night('b', 's', 20, { location: 'Hall' }),
    ];
    expect(sharedDetail(strings, join, events)).toBe('7:00 PM to 9:00 PM @ Hall');
  });

  it('leaves the room off when it varies, so the exception stays on its row', () => {
    const events = [
      night('a', 's', 13, { location: 'Hall' }),
      night('b', 's', 20, { location: 'Gym' }),
    ];
    expect(sharedDetail(strings, join, events)).toBe('7:00 PM to 9:00 PM');
  });

  it('leaves the room off when there is none', () => {
    expect(sharedDetail(strings, join, [night('a', 's', 13)])).toBe('7:00 PM to 9:00 PM');
  });

  it('returns null when one night starts or ends at a different time', () => {
    const later = night('b', 's', 20, { startAt: new Date(2026, 1, 20, 20, 0) });
    expect(sharedDetail(strings, join, [night('a', 's', 13), later])).toBeNull();
    const longer = night('c', 's', 27, { endAt: new Date(2026, 1, 27, 21, 30) });
    expect(sharedDetail(strings, join, [night('a', 's', 13), longer])).toBeNull();
  });

  it('does not confuse windows whose digits run together', () => {
    // 1:23 and 12:3 would collide if the key had no separators.
    const a = night('a', 's', 13, {
      startAt: new Date(2026, 1, 13, 1, 23),
      endAt: new Date(2026, 1, 13, 5, 0),
    });
    const b = night('b', 's', 20, {
      startAt: new Date(2026, 1, 20, 12, 3),
      endAt: new Date(2026, 1, 20, 5, 0),
    });
    expect(sharedDetail(strings, join, [a, b])).toBeNull();
  });
});

describe('sharedWeekday', () => {
  it('is false for an empty chain', () => {
    expect(sharedWeekday([])).toBe(false);
  });

  it('is true when every night falls on the same weekday', () => {
    expect(sharedWeekday([night('a', 's', 13), night('b', 's', 20)])).toBe(true);
  });

  it('is false when any night moves to another weekday', () => {
    expect(sharedWeekday([night('a', 's', 13), night('b', 's', 21)])).toBe(false);
  });
});
