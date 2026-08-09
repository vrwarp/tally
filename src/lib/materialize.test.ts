/**
 * Unit tests for the occurrence projection.
 *
 * The interesting assertions are all about what the projection *leaves out*. It
 * runs on every read, so "a document already stands for this night" is by far
 * the most common answer and the one that has to be right — every exception a
 * leader records (cancelled, moved, scheduled by hand) is expressed by a
 * document shadowing its own projection, and getting that wrong puts two Friday
 * Fellowships on one Friday.
 */
import { describe, expect, it } from 'vitest';
import {
  HORIZON_DAYS,
  chainKey,
  findProjectedOccurrence,
  occurrenceId,
  projectOccurrences,
} from '@/lib/materialize';
import type { ProjectedOccurrence } from '@/lib/materialize';
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
 * Materialises projected occurrences the way the callable does, so a second
 * pass sees documents where the first saw a projection. Carrying `recurrence`
 * forward is the part that matters: an occurrence that lost its rule would stop
 * the chain dead.
 */
function materialized(
  events: readonly TallyEvent[],
  occurrences: readonly ProjectedOccurrence[],
): TallyEvent[] {
  return [
    ...events,
    ...occurrences.map((occurrence) =>
      friday({
        id: occurrence.id,
        seriesId: occurrence.source.seriesId,
        recurrence: occurrence.source.recurrence,
        recurrenceRootId: occurrence.source.recurrenceRootId ?? occurrence.source.id,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        checkInOpensAt: occurrence.checkInOpensAt,
        checkInClosesAt: occurrence.checkInClosesAt,
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

describe('projectOccurrences', () => {
  it('fills the horizon from a single instance', () => {
    const projected = projectOccurrences([friday()], FRIDAY);

    // Every Friday inside the sixty-day window.
    expect(ids(projected)).toEqual([
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

  it('yields to a document, so nothing is shown twice', () => {
    const seed = friday();
    const all = materialized([seed], projectOccurrences([seed], FRIDAY));

    expect(projectOccurrences(all, FRIDAY)).toEqual([]);
  });

  it('projects nothing for an event that does not repeat', () => {
    expect(projectOccurrences([friday({ recurrence: null })], FRIDAY)).toEqual([]);
    expect(projectOccurrences([friday({ mode: 'oneoff', recurrence: null })], FRIDAY)).toEqual([]);
  });

  it('carries the gathering’s shape forward, not just its date', () => {
    const source = friday({
      startAt: new Date(2026, 6, 24, 22, 0),
      endAt: new Date(2026, 6, 25, 1, 0), // a lock-in, past midnight
      checkInOpensAt: new Date(2026, 6, 24, 20, 30), // a window somebody widened
      checkInClosesAt: new Date(2026, 6, 25, 1, 30),
      location: 'Fellowship Hall',
    });

    const [next] = projectOccurrences([source], new Date(2026, 6, 24, 22, 0));

    expect(next?.startAt).toEqual(new Date(2026, 6, 31, 22, 0));
    expect(next?.endAt).toEqual(new Date(2026, 7, 1, 1, 0));
    expect(next?.checkInOpensAt).toEqual(new Date(2026, 6, 31, 20, 30));
    expect(next?.checkInClosesAt).toEqual(new Date(2026, 7, 1, 1, 30));
    expect(next?.source.location).toBe('Fellowship Hall');
  });

  it('projects from the latest instance, so an edit carries', () => {
    const original = friday();
    // Somebody moved the coming Friday to 19:30 and to a new room.
    const moved = friday({
      id: 'friday-fellowship-2026-07-31',
      startAt: new Date(2026, 6, 31, 19, 30),
      endAt: new Date(2026, 6, 31, 21, 30),
      location: 'Youth room',
    });

    const [next] = projectOccurrences([original, moved], FRIDAY);

    expect(next?.id).toBe('friday-fellowship-2026-08-07');
    expect(next?.startAt).toEqual(new Date(2026, 7, 7, 19, 30));
    expect(next?.source.location).toBe('Youth room');
  });

  /*
   * The nights between here and a template that has not happened yet.
   *
   * A chain is expanded from its latest live instance, and the latest is very
   * often ahead of today — a leader edits *next* Friday far more than last one,
   * un-cancels one, or a kiosk in a lobby binds to a Sunday days early, and
   * each of those writes the document. The expansion only ever walked forwards
   * from it, so every Friday between now and the one that had been touched
   * simply stopped being on the calendar: not cancelled, not hidden, absent.
   */
  it('does not erase the nights before a template that is still ahead', () => {
    const original = friday();
    // Somebody opened the Friday four weeks out and edited it.
    const ahead = friday({
      id: 'friday-fellowship-2026-08-21',
      startAt: new Date(2026, 7, 21, 19, 0),
      endAt: new Date(2026, 7, 21, 21, 0),
      checkInOpensAt: new Date(2026, 7, 21, 18, 0),
      checkInClosesAt: new Date(2026, 7, 21, 22, 0),
    });

    const projected = ids(projectOccurrences([original, ahead], FRIDAY));

    expect(projected.slice(0, 3)).toEqual([
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-07',
      'friday-fellowship-2026-08-14',
    ]);
    // And the edited night itself is a document now, so it is not projected.
    expect(projected).not.toContain('friday-fellowship-2026-08-21');
  });

  /*
   * The invariant the two rules in this module's docblock add up to, and the
   * cheapest way to catch a regression in either: writing a night down says
   * *that this night was acted on*, and nothing else. It is not a decision
   * about any other night, so the calendar either side of it must not move.
   */
  it('is unchanged by materialising any one of its own occurrences', () => {
    const seed = friday();
    const baseline = projectOccurrences([seed], FRIDAY);

    for (const occurrence of baseline) {
      const after = projectOccurrences(materialized([seed], [occurrence]), FRIDAY);
      expect(ids(after)).toEqual(ids(baseline).filter((id) => id !== occurrence.id));
    }
  });

  it('follows a rule that was changed, with nothing left over', () => {
    // The whole reason the calendar is computed. Turning the weekly gathering
    // monthly used to leave eight materialised Fridays standing.
    const monthly = friday({
      recurrence: { ...WEEKLY, frequency: 'monthly', weekdays: [] },
    });

    // Just the one inside the sixty-day window: 24 September is two days past
    // the horizon, which is a display bound and not the rule running out.
    expect(ids(projectOccurrences([monthly], FRIDAY))).toEqual([
      'friday-fellowship-2026-08-24',
    ]);
  });

  it('does not duplicate a Friday that was scheduled by hand', () => {
    // A document from before ids were derived — seeded, or created through the
    // editor. Same series, same evening, unrelated id.
    const byHand = friday({ id: 'evt-legacy-7', startAt: new Date(2026, 6, 31, 19, 0) });
    const projected = projectOccurrences([friday(), byHand], FRIDAY);

    expect(ids(projected)).not.toContain('friday-fellowship-2026-07-31');
    expect(ids(projected)[0]).toBe('friday-fellowship-2026-08-07');
  });

  it('does not put a moved gathering back on its original date', () => {
    // Materialised for the 31st, then dragged to the Saturday.
    const moved = friday({
      id: 'friday-fellowship-2026-07-31',
      startAt: new Date(2026, 7, 1, 19, 0),
      endAt: new Date(2026, 7, 1, 21, 0),
    });
    const projected = projectOccurrences([friday(), moved], FRIDAY);

    expect(ids(projected)).not.toContain('friday-fellowship-2026-07-31');
    expect(ids(projected)).not.toContain('friday-fellowship-2026-08-01');
  });

  it('does not resurrect a Friday somebody called off', () => {
    const cancelled = friday({ id: 'friday-fellowship-2026-07-31', status: 'cancelled' });
    const projected = projectOccurrences([friday(), cancelled], FRIDAY);

    expect(ids(projected)).not.toContain('friday-fellowship-2026-07-31');
    expect(ids(projected)).toContain('friday-fellowship-2026-08-07');
  });

  /*
   * Cancelling one date is cancelling one date.
   *
   * A cancelled instance is passed over as a template, so that calling off a
   * Friday does not hand the rest of the term the shape of the night that did
   * not happen. When it is the *only* instance there is nothing to pass over
   * to, and the chain had no template at all — so a leader who scheduled a
   * weekly gathering and then called off its first night deleted the entire
   * repeat, with nothing on screen saying so.
   */
  it('keeps the repeat when the only instance is cancelled', () => {
    const projected = projectOccurrences([friday({ status: 'cancelled' })], FRIDAY);

    expect(ids(projected)).toContain('friday-fellowship-2026-07-31');
    // Its own night stays off, which is what cancelling asked for.
    expect(ids(projected)).not.toContain('friday-fellowship-2026-07-24');
  });

  it('still prefers a live instance over a cancelled one as the template', () => {
    const cancelled = friday({
      id: 'friday-fellowship-2026-07-31',
      status: 'cancelled',
      startAt: new Date(2026, 6, 31, 16, 0),
      endAt: new Date(2026, 6, 31, 18, 0),
      location: 'The night that did not happen',
    });

    const [next] = projectOccurrences([friday(), cancelled], FRIDAY);

    expect(next?.startAt).toEqual(new Date(2026, 7, 7, 19, 0));
    expect(next?.source.location).not.toBe('The night that did not happen');
  });

  /*
   * A tally is a fact about the chain, not about whichever night is newest.
   *
   * `COUNT` was expanded from the template, and the template is the latest
   * instance — so every night that became a document restarted the tally and
   * handed the chain N more. "Weekly, four times" ran forever, four Fridays at
   * a time.
   */
  describe('a repeat bounded by a tally', () => {
    const bounded = { ...WEEKLY, count: 4 };

    it('stops after the fourth Friday from the one it began on', () => {
      expect(ids(projectOccurrences([friday({ recurrence: bounded })], FRIDAY))).toEqual([
        'friday-fellowship-2026-07-31',
        'friday-fellowship-2026-08-07',
        'friday-fellowship-2026-08-14',
      ]);
    });

    it('does not gain four more each time one of its nights is written down', () => {
      const root = friday({ recurrence: bounded });
      let all: readonly TallyEvent[] = [root];

      // Every Friday of the repeat gets checked into, in order.
      for (let round = 0; round < 4; round += 1) {
        all = materialized(all, projectOccurrences(all, FRIDAY).slice(0, 1));
      }

      expect(projectOccurrences(all, FRIDAY)).toEqual([]);
      expect(ids(all)).toEqual([
        'friday-fellowship-2026-07-24',
        'friday-fellowship-2026-07-31',
        'friday-fellowship-2026-08-07',
        'friday-fellowship-2026-08-14',
      ]);
    });
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

    const projected = projectOccurrences([friday(), sunday], FRIDAY, { horizonDays: 16 });

    expect(ids(projected)).toEqual([
      'friday-fellowship-2026-07-31',
      'sunday-school-2026-08-02',
      'friday-fellowship-2026-08-07',
      'sunday-school-2026-08-09',
    ]);
  });

  it('stops when the rule itself runs out', () => {
    const bounded = friday({ recurrence: { ...WEEKLY, count: 3 } });
    expect(ids(projectOccurrences([bounded], FRIDAY))).toEqual([
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-07',
    ]);
  });

  it('respects an end date', () => {
    const bounded = friday({ recurrence: { ...WEEKLY, until: '2026-08-07' } });
    expect(ids(projectOccurrences([bounded], FRIDAY))).toEqual([
      'friday-fellowship-2026-07-31',
      'friday-fellowship-2026-08-07',
    ]);
  });

  it('shows every day of a daily rule, because nothing is being written', () => {
    // This used to be capped at ten per chain, which was a limit on how much
    // one page load could write. A projection writes nothing, so the calendar
    // is simply the calendar.
    const daily = friday({ recurrence: { ...WEEKLY, weekdays: [0, 1, 2, 3, 4, 5, 6] } });
    const projected = projectOccurrences([daily], FRIDAY, { horizonDays: 14 });

    expect(projected).toHaveLength(14);
  });

  it('never reaches past the horizon', () => {
    const monthly = friday({
      recurrence: { ...WEEKLY, frequency: 'monthly', weekdays: [] },
    });
    const projected = projectOccurrences([monthly], FRIDAY);
    const limit = new Date(FRIDAY.getTime() + HORIZON_DAYS * 86_400_000);

    expect(projected.length).toBeGreaterThan(0);
    for (const occurrence of projected) {
      expect(occurrence.startAt.getTime()).toBeLessThanOrEqual(limit.getTime());
    }
  });

  it('does not invent gatherings that came and went', () => {
    // Three weeks on from the only instance, at noon. Every Friday in between
    // is finished and must stay off the calendar — an empty gathering nobody
    // recorded would land in the dashboard's denominator as one that happened.
    const projected = projectOccurrences([friday()], new Date(2026, 7, 14, 12, 0));

    // Today's is still ahead of its check-in window, so it counts.
    expect(ids(projected)[0]).toBe('friday-fellowship-2026-08-14');
    expect(ids(projected)).not.toContain('friday-fellowship-2026-07-31');
    expect(ids(projected)).not.toContain('friday-fellowship-2026-08-07');
  });

  it('includes a gathering already under way', () => {
    // 19:30 on a Friday whose 19:00 start nobody wrote down.
    const projected = projectOccurrences([friday()], new Date(2026, 6, 31, 19, 30));
    expect(ids(projected)[0]).toBe('friday-fellowship-2026-07-31');
  });
});

describe('findProjectedOccurrence', () => {
  const chain = 'friday-fellowship';

  it('finds the gathering a client is asking to materialise', () => {
    const found = findProjectedOccurrence(
      [friday()],
      chain,
      new Date(2026, 6, 31, 19, 0),
      FRIDAY,
    );

    expect(found?.id).toBe('friday-fellowship-2026-07-31');
    expect(found?.source.title).toBe('Friday Fellowship');
  });

  it('refuses a date the rule does not land on', () => {
    // A Thursday. Nothing in the request is trusted, so this is the check that
    // stops a counselor's client inventing a gathering — and backdating one.
    expect(
      findProjectedOccurrence([friday()], chain, new Date(2026, 6, 30, 19, 0), FRIDAY),
    ).toBeNull();
    expect(
      findProjectedOccurrence([friday()], chain, new Date(2026, 6, 17, 19, 0), FRIDAY),
    ).toBeNull();
  });

  it('refuses a chain the caller does not belong to', () => {
    expect(
      findProjectedOccurrence([friday()], 'sunday-school', new Date(2026, 6, 31, 19, 0), FRIDAY),
    ).toBeNull();
  });

  it('refuses one that already has a document', () => {
    const all = materialized([friday()], projectOccurrences([friday()], FRIDAY));

    // Not a failure at the door: `ensureMaterialized` never asks about a
    // gathering it is already holding a document for.
    expect(
      findProjectedOccurrence(all, chain, new Date(2026, 6, 31, 19, 0), FRIDAY),
    ).toBeNull();
  });

  it('refuses one past the horizon', () => {
    expect(
      findProjectedOccurrence([friday()], chain, new Date(2027, 6, 30, 19, 0), FRIDAY),
    ).toBeNull();
  });
});
