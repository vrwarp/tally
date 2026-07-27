/**
 * Unit tests for occurrence planning.
 *
 * The interesting assertions are all about *not* writing: the horizon is topped
 * up on every app open, so "there is nothing missing" is by far the most common
 * answer and the one that has to be right.
 */
import { describe, expect, it } from 'vitest';
import {
  HORIZON_DAYS,
  chainKey,
  missingOccurrenceNow,
  occurrenceId,
  pendingOccurrences,
  reconcileChain,
} from '@/lib/materialize';
import type { OccurrenceDraft } from '@/lib/materialize';
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
    startAt,
    endAt,
    checkInOpensAt: new Date(startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(endAt.getTime() + 3_600_000),
    ...overrides,
  });
}

function ids(events: readonly { id: string }[]): string[] {
  return events.map((event) => event.id);
}

/**
 * Applies drafts the way `materializeOccurrences` does, so a second pass sees
 * what the first one wrote. Carrying `recurrence` forward is the part that
 * matters: an occurrence that lost its rule would stop the chain dead.
 */
function applied(events: readonly TallyEvent[], drafts: readonly OccurrenceDraft[]): TallyEvent[] {
  return [
    ...events,
    ...drafts.map((draft) =>
      friday({
        id: draft.id,
        seriesId: draft.source.seriesId,
        recurrence: draft.source.recurrence,
        recurrenceRootId: draft.source.recurrenceRootId ?? draft.source.id,
        startAt: draft.startAt,
        endAt: draft.endAt,
        checkInOpensAt: draft.checkInOpensAt,
        checkInClosesAt: draft.checkInClosesAt,
      }),
    ),
  ];
}

describe('chainKey', () => {
  it('prefers the series, which is the chain and reads like one', () => {
    expect(chainKey(friday())).toBe('friday-fellowship');
    expect(occurrenceId(chainKey(friday()), FRIDAY)).toBe('friday-fellowship-2026-07-24');
  });

  it('falls back to the root, then to the event itself', () => {
    expect(chainKey(friday({ seriesId: null, recurrenceRootId: 'root-1' }))).toBe('root-1');
    expect(chainKey(friday({ seriesId: null, recurrenceRootId: null, id: 'ev-9' }))).toBe('ev-9');
  });
});

describe('pendingOccurrences', () => {
  it('fills the horizon from a single seeded instance', () => {
    const drafts = pendingOccurrences([friday()], FRIDAY);

    // Every Friday inside the 60-day horizon, which runs out before the
    // ten-per-chain cap does.
    expect(ids(drafts)).toEqual([
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-07',
      'friday-fellowship-2026-08-14',
      'friday-fellowship-2026-08-21',
      'friday-fellowship-2026-08-28',
      'friday-fellowship-2026-09-04',
      'friday-fellowship-2026-09-11',
      'friday-fellowship-2026-09-18',
    ]);
  });

  it('is idempotent — a full horizon asks for nothing', () => {
    const seed = friday();
    const materialized = applied([seed], pendingOccurrences([seed], FRIDAY));

    expect(pendingOccurrences(materialized, FRIDAY)).toEqual([]);
  });

  it('writes nothing for an event that does not repeat', () => {
    expect(pendingOccurrences([friday({ recurrence: null })], FRIDAY)).toEqual([]);
    expect(pendingOccurrences([friday({ mode: 'oneoff', recurrence: null })], FRIDAY)).toEqual([]);
  });

  it('carries the gathering’s shape forward, not just its date', () => {
    const source = friday({
      startAt: new Date(2026, 6, 24, 22, 0),
      endAt: new Date(2026, 6, 25, 1, 0), // a lock-in, past midnight
      checkInOpensAt: new Date(2026, 6, 24, 20, 30), // a window somebody widened
      checkInClosesAt: new Date(2026, 6, 25, 1, 30),
      location: 'Fellowship Hall',
      defaultGroupingMode: 'smallGroup',
    });

    const [next] = pendingOccurrences([source], new Date(2026, 6, 24, 22, 0));

    expect(next?.startAt).toEqual(new Date(2026, 6, 31, 22, 0));
    expect(next?.endAt).toEqual(new Date(2026, 7, 1, 1, 0));
    expect(next?.checkInOpensAt).toEqual(new Date(2026, 6, 31, 20, 30));
    expect(next?.checkInClosesAt).toEqual(new Date(2026, 7, 1, 1, 30));
    expect(next?.source.location).toBe('Fellowship Hall');
  });

  it('copies forward from the latest instance, so an edit carries', () => {
    const original = friday();
    // Somebody moved the coming Friday to 19:30 and to a new room.
    const moved = friday({
      id: 'friday-fellowship-2026-07-31',
      startAt: new Date(2026, 6, 31, 19, 30),
      endAt: new Date(2026, 6, 31, 21, 30),
      location: 'Youth room',
    });

    const [next] = pendingOccurrences([original, moved], FRIDAY);

    expect(next?.id).toBe('friday-fellowship-2026-08-07');
    expect(next?.startAt).toEqual(new Date(2026, 7, 7, 19, 30));
    expect(next?.source.location).toBe('Youth room');
  });

  it('does not duplicate a Friday that was scheduled by hand', () => {
    // A document from before ids were derived — seeded, or created through the
    // editor. Same series, same evening, unrelated id.
    const byHand = friday({ id: 'evt-legacy-7', startAt: new Date(2026, 6, 31, 19, 0) });
    const drafts = pendingOccurrences([friday(), byHand], FRIDAY);

    expect(ids(drafts)).not.toContain('friday-fellowship-2026-07-31');
    expect(ids(drafts)[0]).toBe('friday-fellowship-2026-08-07');
  });

  it('does not put a moved gathering back on its original date', () => {
    // Materialised for the 31st, then dragged to the Saturday.
    const moved = friday({
      id: 'friday-fellowship-2026-07-31',
      startAt: new Date(2026, 7, 1, 19, 0),
      endAt: new Date(2026, 7, 1, 21, 0),
    });
    const drafts = pendingOccurrences([friday(), moved], FRIDAY);

    expect(ids(drafts)).not.toContain('friday-fellowship-2026-07-31');
    expect(ids(drafts)).not.toContain('friday-fellowship-2026-08-01');
  });

  it('does not resurrect a Friday somebody called off', () => {
    const cancelled = friday({ id: 'friday-fellowship-2026-07-31', status: 'cancelled' });
    const drafts = pendingOccurrences([friday(), cancelled], FRIDAY);

    expect(ids(drafts)).not.toContain('friday-fellowship-2026-07-31');
    expect(ids(drafts)).toContain('friday-fellowship-2026-08-07');
  });

  it('keeps two series in their own chains', () => {
    const sunday = friday({
      id: 'sunday-school-2026-07-26',
      title: 'Sunday School',
      seriesId: 'sunday-school',
      startAt: new Date(2026, 6, 26, 9, 30),
      endAt: new Date(2026, 6, 26, 10, 45),
      recurrence: { ...WEEKLY, weekdays: [0] },
    });

    const drafts = pendingOccurrences([friday(), sunday], FRIDAY, { maxPerChain: 2 });

    expect(ids(drafts)).toEqual([
      'friday-fellowship-2026-07-31',
      'sunday-school-2026-08-02',
      'friday-fellowship-2026-08-07',
      'sunday-school-2026-08-09',
    ]);
  });

  it('stops when the rule itself runs out', () => {
    const bounded = friday({ recurrence: { ...WEEKLY, count: 3 } });
    expect(ids(pendingOccurrences([bounded], FRIDAY))).toEqual([
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-07',
    ]);
  });

  it('respects an end date', () => {
    const bounded = friday({ recurrence: { ...WEEKLY, until: '2026-08-07' } });
    expect(ids(pendingOccurrences([bounded], FRIDAY))).toEqual([
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-07',
    ]);
  });

  it('caps a daily rule rather than writing out the whole horizon at once', () => {
    const daily = friday({ recurrence: { ...WEEKLY, weekdays: [0, 1, 2, 3, 4, 5, 6] } });
    const drafts = pendingOccurrences([daily], FRIDAY);

    expect(drafts).toHaveLength(10);
    // Self-healing: the next top-up picks up where this one stopped.
    expect(pendingOccurrences(applied([daily], drafts), FRIDAY)).toHaveLength(10);
  });

  it('never reaches past the horizon', () => {
    const monthly = friday({
      recurrence: { ...WEEKLY, frequency: 'monthly', weekdays: [] },
    });
    const drafts = pendingOccurrences([monthly], FRIDAY);
    const limit = new Date(FRIDAY.getTime() + HORIZON_DAYS * 86_400_000);

    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) expect(draft.startAt.getTime()).toBeLessThanOrEqual(limit.getTime());
  });

  it('does not backfill gatherings that came and went', () => {
    // Three weeks on from the only instance, at noon. Every Friday in between
    // is finished and must stay unwritten — an empty gathering nobody recorded
    // would land in the dashboard's denominator as one that happened.
    const drafts = pendingOccurrences([friday()], new Date(2026, 7, 14, 12, 0));

    // Today's is still ahead of its check-in window, so it counts.
    expect(ids(drafts)[0]).toBe('friday-fellowship-2026-08-14');
    expect(ids(drafts)).not.toContain('friday-fellowship-2026-07-31');
    expect(ids(drafts)).not.toContain('friday-fellowship-2026-08-07');
  });

  it('includes a gathering already under way', () => {
    // 19:30 on a Friday whose 19:00 start nobody wrote down.
    const drafts = pendingOccurrences([friday()], new Date(2026, 6, 31, 19, 30));
    expect(ids(drafts)[0]).toBe('friday-fellowship-2026-07-31');
  });
});

describe('reconcileChain', () => {
  const MONTHLY: RecurrenceRule = {
    frequency: 'monthly',
    interval: 1,
    weekdays: [],
    monthlyMode: 'dayOfMonth',
    until: null,
    count: null,
  };

  /** The seed plus the Fridays the horizon had already written down for it. */
  const chain = applied([friday()], pendingOccurrences([friday()], FRIDAY));

  /** The seed as it stands after an edit, still the earliest of the chain. */
  function edited(overrides: Partial<TallyEvent> = {}): TallyEvent {
    return friday(overrides);
  }

  it('drops the Fridays a monthly rule no longer lands on', () => {
    // The reported bug: turning a weekly gathering monthly left every Friday
    // the old rule had already materialised sitting in Upcoming.
    const { superseded, restated } = reconcileChain(chain, edited({ recurrence: MONTHLY }));

    // 24 July is the 24th; monthly on the 24th lands on 24 August, which the
    // weekly rule never wrote — so every one of them goes.
    expect(ids(superseded)).toEqual([
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-07',
      'friday-fellowship-2026-08-14',
      'friday-fellowship-2026-08-21',
      'friday-fellowship-2026-08-28',
      'friday-fellowship-2026-09-04',
      'friday-fellowship-2026-09-11',
      'friday-fellowship-2026-09-18',
    ]);
    expect(restated).toEqual([]);
  });

  it('keeps the ones the new rule still lands on, and restates their rule', () => {
    const fortnightly = { ...WEEKLY, interval: 2 };
    const { superseded, restated } = reconcileChain(chain, edited({ recurrence: fortnightly }));

    // Every other Friday survives — and has to stop claiming to be weekly, or
    // the last of them becomes the template that puts the old schedule back.
    expect(ids(superseded)).toEqual([
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-14',
      'friday-fellowship-2026-08-28',
      'friday-fellowship-2026-09-11',
    ]);
    expect(ids(restated)).toEqual([
      'friday-fellowship-2026-08-07',
      'friday-fellowship-2026-08-21',
      'friday-fellowship-2026-09-04',
      'friday-fellowship-2026-09-18',
    ]);
  });

  it('asks for nothing when the schedule did not change', () => {
    // A leader fixing a typo in the title must not disturb the calendar.
    expect(reconcileChain(chain, edited({ title: 'Friday Fellowship!' }))).toEqual({
      superseded: [],
      restated: [],
    });
  });

  it('drops the ones ahead when the hour moves, so they can be rewritten', () => {
    const later = new Date(2026, 6, 24, 19, 30);
    const { superseded } = reconcileChain(
      chain,
      edited({ startAt: later, endAt: new Date(2026, 6, 24, 21, 30) }),
    );

    // Same Fridays, wrong time. `pendingOccurrences` writes them back at 19:30.
    expect(superseded).toHaveLength(8);
  });

  it('leaves history and the edited gathering alone', () => {
    const { superseded, restated } = reconcileChain(chain, edited({ recurrence: MONTHLY }));

    for (const event of [...superseded, ...restated]) {
      expect(event.startAt.getTime()).toBeGreaterThan(FRIDAY.getTime());
      expect(event.id).not.toBe('friday-fellowship-2026-07-24');
    }
  });

  /** The chain with one of its Fridays replaced by an altered copy. */
  function withInstance(id: string, overrides: Partial<TallyEvent>): TallyEvent[] {
    return chain.map((event) => (event.id === id ? friday({ ...event, ...overrides }) : event));
  }

  it('does not delete a Friday somebody called off', () => {
    const withCancelled = withInstance('friday-fellowship-2026-08-07', {
      status: 'cancelled',
    });

    const { superseded, restated } = reconcileChain(
      withCancelled,
      edited({ recurrence: MONTHLY }),
    );

    expect(ids(superseded)).not.toContain('friday-fellowship-2026-08-07');
    // Still brought up to date, so un-cancelling it cannot revive the old rule.
    expect(ids(restated)).toContain('friday-fellowship-2026-08-07');
  });

  it('does not delete a gathering somebody moved by hand', () => {
    // Materialised for the 7th, then dragged to the Saturday.
    const withMoved = withInstance('friday-fellowship-2026-08-07', {
      startAt: new Date(2026, 7, 8, 19, 0),
      endAt: new Date(2026, 7, 8, 21, 0),
    });

    const { superseded, restated } = reconcileChain(withMoved, edited({ recurrence: MONTHLY }));

    expect(ids(superseded)).not.toContain('friday-fellowship-2026-08-07');
    expect(ids(restated)).toContain('friday-fellowship-2026-08-07');
  });

  it('clears the calendar ahead when a gathering stops repeating', () => {
    // Switching to one-off drops the series and the root, so the chain has to
    // be named from the event as it was stored.
    const oneoff = friday({ mode: 'oneoff', seriesId: null, recurrence: null });
    const { superseded } = reconcileChain(chain, oneoff, chainKey(friday()));

    expect(superseded).toHaveLength(8);
  });

  it('drops the ones past a newly set end date', () => {
    const { superseded } = reconcileChain(
      chain,
      edited({ recurrence: { ...WEEKLY, until: '2026-08-14' } }),
    );

    expect(ids(superseded)).toEqual([
      'friday-fellowship-2026-08-21',
      'friday-fellowship-2026-08-28',
      'friday-fellowship-2026-09-04',
      'friday-fellowship-2026-09-11',
      'friday-fellowship-2026-09-18',
    ]);
  });

  it('ignores other chains entirely', () => {
    const sunday = friday({
      id: 'sunday-school-2026-08-02',
      seriesId: 'sunday-school',
      startAt: new Date(2026, 7, 2, 9, 30),
      endAt: new Date(2026, 7, 2, 10, 45),
      recurrence: { ...WEEKLY, weekdays: [0] },
    });

    const { superseded, restated } = reconcileChain(
      [...chain, sunday],
      edited({ recurrence: MONTHLY }),
    );

    expect(ids([...superseded, ...restated])).not.toContain('sunday-school-2026-08-02');
  });
});

describe('missingOccurrenceNow', () => {
  it('is null while the horizon is doing its job', () => {
    const seed = friday();
    const filled = applied([seed], pendingOccurrences([seed], FRIDAY));

    expect(missingOccurrenceNow(filled, new Date(2026, 6, 31, 19, 30))).toBeNull();
  });

  it('finds the gathering happening right now that nobody wrote down', () => {
    // Only last Friday exists; it is 19:30 on the next one.
    const draft = missingOccurrenceNow([friday()], new Date(2026, 6, 31, 19, 30));
    expect(draft?.id).toBe('friday-fellowship-2026-07-31');
  });

  it('stays quiet outside the check-in window', () => {
    // Same missing Friday, but it is Wednesday afternoon.
    expect(missingOccurrenceNow([friday()], new Date(2026, 6, 29, 14, 0))).toBeNull();
    // And an hour after check-in closed.
    expect(missingOccurrenceNow([friday()], new Date(2026, 6, 31, 23, 30))).toBeNull();
  });
});
