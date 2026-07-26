/**
 * Turning a recurrence rule into real event documents.
 *
 * Tally does not expand rules at read time. A gathering a counselor checks into
 * has to be a document — attendance hangs off it, the predictive roster reads
 * its series history, the dashboard counts it — so somebody has to write next
 * Friday down before next Friday.
 *
 * This module is the *planning* half, and it is deliberately pure: given the
 * events already known and a clock, it says which occurrences are missing. The
 * writing half lives in `services/events.ts`, and who triggers it lives in
 * `hooks/useOccurrenceHorizon.ts`. Splitting it this way is what makes the
 * awkward part — "did we already create this one?" — testable without a
 * database.
 *
 * Two rules govern the whole design.
 *
 * **Ahead of time, not at the door.** Materialising when check-in starts would
 * mean next Friday does not exist all week: it would be missing from Upcoming,
 * nobody could move it or call it off in advance, and the whole point of having
 * a calendar would arrive about an hour before the calendar stopped mattering.
 *
 * **Deterministic ids.** An occurrence's document id is derived from its chain
 * and its date, never generated. Two leaders opening the app at once, or one
 * device syncing a queued write from the car park, converge on the same
 * document instead of producing two Friday Fellowships for the same Friday and
 * splitting the night's attendance between them. It is the same reason an
 * attendance document's id *is* the student id.
 */
import { recurrenceOccurrences, toDateOnlyValue } from '@/lib/recurrence';
import type { RecurrenceRule, TallyEvent } from '@/types';

/**
 * How far ahead occurrences are written down.
 *
 * Two months of Fridays is eight documents — small enough to be free, long
 * enough that the calendar still reaches past the end of a term when nobody has
 * opened Tally over the holidays.
 */
export const HORIZON_DAYS = 60;

/**
 * The most occurrences one chain may gain in a single top-up.
 *
 * A daily rule would otherwise write sixty documents the first time anybody
 * opened the app. The cap is not a limit on the schedule — the next top-up
 * simply adds the next few — it is a limit on how much one page load may do.
 */
export const MAX_PER_CHAIN = 10;

/**
 * The identity of a chain of repeats, stable across every instance in it.
 *
 * `seriesId` first, because a series *is* the chain and the id reads like one
 * (`friday-fellowship-2026-08-07`). Failing that, the root — the id of the
 * hand-made event the chain grew from. Failing that the event is itself a root
 * that has never been materialised, so it is its own key.
 */
export function chainKey(event: TallyEvent): string {
  return event.seriesId ?? event.recurrenceRootId ?? event.id;
}

/**
 * The document id for one occurrence.
 *
 * A calendar day, not an instant: two gatherings of the same series on one day
 * is not a thing that happens, and a date reads in the Firebase console.
 */
export function occurrenceId(key: string, startAt: Date): string {
  return `${key}-${toDateOnlyValue(startAt)}`;
}

/** One occurrence that ought to exist and does not. */
export interface OccurrenceDraft {
  id: string;
  /** The instance it was copied forward from. */
  source: TallyEvent;
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
}

/**
 * The template each chain is copied forward from: its latest live instance.
 *
 * The latest rather than the first, because an edit is meant to carry: a leader
 * who moves Friday night to 19:30 has moved the Fridays still ahead, and the
 * next one written down should be the 19:30 one. Past instances keep what they
 * were held at, which is exactly what makes them history.
 *
 * Cancelled instances are skipped as templates but still count as existing, so
 * calling one Friday off does not make it reappear on the next top-up.
 */
function templatesByChain(events: readonly TallyEvent[]): Map<string, TallyEvent> {
  const templates = new Map<string, TallyEvent>();

  for (const event of events) {
    if (event.mode !== 'recurring' || !event.recurrence) continue;
    if (event.status === 'cancelled') continue;

    const key = chainKey(event);
    const current = templates.get(key);
    if (!current || event.startAt > current.startAt) templates.set(key, event);
  }

  return templates;
}

export interface HorizonOptions {
  horizonDays?: number;
  maxPerChain?: number;
}

/**
 * Which occurrences are missing between `now` and the horizon.
 *
 * Returns drafts in chronological order. An empty result is the normal case —
 * the horizon is usually already full, which is what makes it safe to call this
 * on every app open.
 */
export function pendingOccurrences(
  events: readonly TallyEvent[],
  now: Date,
  options: HorizonOptions = {},
): OccurrenceDraft[] {
  const horizonDays = options.horizonDays ?? HORIZON_DAYS;
  const maxPerChain = options.maxPerChain ?? MAX_PER_CHAIN;

  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const drafts: OccurrenceDraft[] = [];

  /*
   * Every occurrence already accounted for, cancelled ones included.
   *
   * Two keys per event, because an event can be spoken for in two different
   * ways. Its id catches the ones written by this module — including one a
   * leader has since dragged to a different evening, which must not come back
   * on its original date. Its chain-and-day catches everything else: a Friday
   * scheduled by hand, or seeded, carries an id from before this scheme existed
   * and would otherwise be materialised a second time, putting two Friday
   * Fellowships on one Friday and splitting the night's attendance.
   */
  const taken = new Set<string>();
  for (const event of events) {
    taken.add(event.id);
    if (event.mode === 'recurring') taken.add(occurrenceId(chainKey(event), event.startAt));
  }

  for (const [key, template] of templatesByChain(events)) {
    const rule: RecurrenceRule | null = template.recurrence;
    if (!rule) continue;

    // Offsets rather than absolute times, so an occurrence keeps the shape of
    // the gathering it was copied from: a lock-in that runs past midnight stays
    // that long, and a window somebody widened stays wide.
    const duration = template.endAt.getTime() - template.startAt.getTime();
    const opensOffset = template.checkInOpensAt.getTime() - template.startAt.getTime();
    const closesOffset = template.checkInClosesAt.getTime() - template.endAt.getTime();

    // Expanded from the template's own start: it is an occurrence of the rule
    // by construction, so the phase of "every 2 weeks" and the position of "the
    // third Tuesday" both carry over without re-deriving them.
    //
    // Expansion starts *before* `now` by the length of one gathering, because a
    // gathering that has already started is the one that matters most: a
    // counselor opening Tally at 19:30 needs tonight's 19:00 Friday, and
    // starting at `now` would skip straight past it to next week. Anything
    // genuinely finished is dropped below.
    const tail = Math.max(0, template.checkInClosesAt.getTime() - template.startAt.getTime());
    const dates = recurrenceOccurrences(rule, template.startAt, {
      // At most one occurrence can land per day, so the horizon plus the
      // lookback bounds how many there can be.
      limit: horizonDays + 2,
      from: new Date(now.getTime() - tail),
    });

    let written = 0;
    for (const startAt of dates) {
      if (startAt > horizon || written >= maxPerChain) break;

      const endAt = new Date(startAt.getTime() + duration);
      const checkInClosesAt = new Date(endAt.getTime() + closesOffset);
      // Over and done with. Tally does not invent history — a gathering nobody
      // recorded did not happen, and writing it now would put an empty one on
      // the calendar and in the dashboard's denominator.
      if (checkInClosesAt < now) continue;

      const id = occurrenceId(key, startAt);
      if (taken.has(id)) continue;
      taken.add(id);

      drafts.push({
        id,
        source: template,
        startAt,
        endAt,
        checkInOpensAt: new Date(startAt.getTime() + opensOffset),
        checkInClosesAt,
      });
      written += 1;
    }
  }

  return drafts.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * The occurrence a counselor is standing in front of, if it was never written
 * down: one whose check-in window is open right now.
 *
 * This is the backstop, not the mechanism. If the horizon is doing its job this
 * returns null forever — it exists for the case where nobody from the core team
 * opened Tally for two months and the calendar ran dry.
 */
export function missingOccurrenceNow(
  events: readonly TallyEvent[],
  now: Date,
): OccurrenceDraft | null {
  return (
    pendingOccurrences(events, now, { horizonDays: 1, maxPerChain: 1 }).find(
      (draft) => now >= draft.checkInOpensAt && now <= draft.checkInClosesAt,
    ) ?? null
  );
}
