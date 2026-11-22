import { describe, expect, it } from 'vitest';
import { chainTemplate, extraDateDefaults, suggestedExtraChain } from '@/features/events/extraDates';
import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';
import { chainKey } from '@/lib/materialize';
import type { TallyEvent } from '@/types';
import { makeEvent } from '../../../tests/factories';

const WEEKLY = {
  frequency: 'weekly' as const,
  interval: 1,
  weekdays: [5],
  monthlyMode: 'dayOfMonth' as const,
  until: null,
  count: null,
};

describe('extraDateDefaults', () => {
  it('joins the chain the night it was opened from belongs to', () => {
    const seeded = makeEvent({ id: 'friday-fellowship-2026-12-11', seriesId: 'friday-fellowship' });
    const root = makeEvent({ id: 'root-1', seriesId: null, recurrenceRootId: null });
    const instance = makeEvent({ id: 'root-1-2026-12-18', seriesId: null, recurrenceRootId: 'root-1' });

    // A seeded series, a root that is its own chain, and a later night of it.
    for (const source of [seeded, root, instance]) {
      const draft = extraDateDefaults(source);
      const asEvent = makeEvent({
        id: 'new-extra',
        seriesId: draft.seriesId ?? null,
        recurrenceRootId: draft.recurrenceRootId ?? null,
      });
      // `makeEvent` coalesces a null series to its default; patch it back.
      const event: TallyEvent = { ...asEvent, seriesId: draft.seriesId ?? null };
      expect(chainKey(event)).toBe(chainKey(source));
    }
  });

  it('is an extra date with no rule, carrying the gathering it belongs to', () => {
    const source = makeEvent({
      title: 'Sunday Nursery',
      recurrence: WEEKLY,
      requiresCheckOut: true,
      location: 'Room 4',
      labelTemplate: DEFAULT_LABEL_TEMPLATE,
    });

    const draft = extraDateDefaults(source);

    expect(draft).toMatchObject({
      extra: true,
      mode: 'recurring',
      recurrence: null,
      title: 'Sunday Nursery',
      requiresCheckOut: true,
      location: 'Room 4',
      labelTemplate: source.labelTemplate,
    });
  });

  it('starts the day after, keeping the gathering’s length and window', () => {
    const source = makeEvent({
      startAt: new Date(2026, 11, 11, 19, 0),
      endAt: new Date(2026, 11, 11, 21, 0),
      checkInOpensAt: new Date(2026, 11, 11, 18, 30),
      checkInClosesAt: new Date(2026, 11, 11, 22, 0),
    });

    const draft = extraDateDefaults(source);

    expect(draft.startAt).toEqual(new Date(2026, 11, 12, 19, 0));
    expect(draft.endAt).toEqual(new Date(2026, 11, 12, 21, 0));
    expect(draft.checkInOpensAt).toEqual(new Date(2026, 11, 12, 18, 30));
    expect(draft.checkInClosesAt).toEqual(new Date(2026, 11, 12, 22, 0));
  });
});

describe('suggestedExtraChain', () => {
  const options = [
    { key: 'fri', title: 'Friday Fellowship', lastStartAt: new Date() },
    { key: 'fri-jr', title: 'Friday Fellowship Juniors', lastStartAt: new Date() },
    { key: 'sun', title: 'Sunday School', lastStartAt: new Date() },
  ];

  it('names the gathering a one-off’s title mentions, longest name first', () => {
    expect(suggestedExtraChain({ title: 'friday fellowship Christmas party', predictFromChain: '' }, options)?.key).toBe('fri');
    expect(suggestedExtraChain({ title: 'Friday Fellowship Juniors lock-in', predictFromChain: '' }, options)?.key).toBe('fri-jr');
  });

  it('names the gathering a one-off already borrows its regulars from', () => {
    expect(suggestedExtraChain({ title: 'Winter retreat', predictFromChain: 'sun' }, options)?.key).toBe('sun');
  });

  it('says nothing about a trip that names nothing', () => {
    expect(suggestedExtraChain({ title: 'Winter retreat', predictFromChain: '' }, options)).toBeNull();
    expect(suggestedExtraChain({ title: '', predictFromChain: '' }, options)).toBeNull();
  });
});

describe('chainTemplate', () => {
  it('is the newest ordinary night of the chain, never an extra date', () => {
    const older = makeEvent({ id: 'a', startAt: new Date(2026, 11, 4, 19, 0) });
    const newer = makeEvent({ id: 'b', startAt: new Date(2026, 11, 11, 19, 0) });
    const party = makeEvent({ id: 'c', extra: true, startAt: new Date(2026, 11, 19, 14, 0) });
    const elsewhere = makeEvent({ id: 'd', seriesId: 'sunday-school', startAt: new Date(2026, 11, 20, 9, 0) });

    expect(chainTemplate([older, party, newer, elsewhere], 'friday-fellowship')?.id).toBe('b');
  });
});
