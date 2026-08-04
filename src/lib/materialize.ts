/**
 * Turning a recurrence rule into the gatherings it describes.
 *
 * A rule is the truth about when a ministry meets; a document is a record that
 * somebody did something about one of those nights. Tally keeps the two apart.
 * The calendar a leader scrolls is *computed* from the rules on every read, and
 * a gathering only becomes a document when it is acted on — checked into,
 * cancelled, moved, edited.
 *
 * SHARED WITH THE CLOUD FUNCTIONS, like `recurrenceCore.ts` — its only import
 * is that module, and `scripts/sync-functions-shared.mjs` copies both. The
 * callable that materialises an occurrence has to agree with the app about
 * which occurrences exist, so it runs this same projection server-side.
 *
 * This module is deliberately pure: given the documents already known and a
 * clock, it says which occurrences the rules put on the calendar that nothing
 * has been written down for. Turning those into events the app can render lives
 * in `lib/eventProjection.ts`, and materialising one lives in
 * `services/events.ts`. Splitting it this way is what makes the awkward part —
 * "is this night already spoken for?" — testable without a database.
 *
 * Two rules govern the whole design.
 *
 * **Computed, not written.** Tally used to write the next two months of Fridays
 * down in advance, and the calendar was then a set of documents that a change
 * to the rule could not reach: turning a weekly gathering monthly left eight
 * Fridays standing that nobody had chosen. A projection cannot drift from the
 * rule it comes from, because it *is* the rule.
 *
 * **Deterministic ids.** A projected occurrence's id is derived from its chain
 * and its date, never generated, and it is the id the document will have if the
 * occurrence is ever materialised. That is what lets a real document shadow its
 * own projection — a cancelled Friday stays cancelled, a Friday moved to
 * Saturday keeps its original id and does not appear twice — and it is why two
 * leaders acting on the same night converge on one document instead of
 * splitting the night's attendance between two. It is the same reason an
 * attendance document's id *is* the student id.
 */
import { recurrenceOccurrences, toDateOnlyValue, type RecurrenceRule } from '@/lib/recurrenceCore';

/**
 * The slice of an event this module reasons about.
 *
 * Structural rather than `TallyEvent`, because the callable builds these from
 * admin-SDK documents and `@/types` speaks the client SDK's `Timestamp`. A
 * `TallyEvent` satisfies it, so app call sites are unchanged.
 */
export interface OccurrenceSource {
  id: string;
  title: string;
  /** Carried onto every projected instance — see `lib/eventProjection.ts`. */
  description: string | null;
  /** A Material Symbols name. Carried the same way, and for the same reason. */
  icon: string | null;
  mode: 'recurring' | 'oneoff';
  seriesId: string | null;
  recurrence: RecurrenceRule | null;
  recurrenceRootId: string | null;
  status: 'scheduled' | 'cancelled';
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  location: string | null;
  notes: string | null;
  /** Carried onto every projected instance — see `lib/eventProjection.ts`. */
  requiresCheckOut: boolean;
}

/**
 * How far ahead the calendar is shown.
 *
 * A rule runs forever, so something has to say where Upcoming stops. Two months
 * of Fridays is eight gatherings — long enough to plan a term around and to
 * reach past a holiday, short enough that the list is still a list.
 *
 * This used to be how far ahead occurrences were *written*, which made it a
 * quota as well as a window: the calendar ended where the writing had got to.
 * Now it only decides what is shown.
 */
export const HORIZON_DAYS = 60;

/**
 * The identity of a chain of repeats, stable across every instance in it.
 *
 * `seriesId` first, because a series *is* the chain and the id reads like one
 * (`friday-fellowship-2026-08-07`). Failing that, the root — the id of the
 * hand-made event the chain grew from. Failing that the event is itself a root
 * that nothing has been materialised from, so it is its own key.
 *
 * This is also what the predictive roster groups history by, and the two uses
 * have to agree: whatever the projection treats as one chain is exactly the set
 * of gatherings that predict each other. Keying prediction on `seriesId` alone
 * was the older, narrower rule, and it meant a weekly event created in the app
 * — which has a root but no series document — accumulated months of attendance
 * that its own roster then refused to read.
 *
 * Narrowed to the three fields it reads so a caller holding less than a whole
 * event — the roster asks this of a `Pick`, and its tests of a fixture — can
 * still ask. `OccurrenceSource` and `TallyEvent` both satisfy it.
 */
export function chainKey(
  event: Pick<OccurrenceSource, 'id' | 'seriesId' | 'recurrenceRootId'>,
): string {
  return event.seriesId ?? event.recurrenceRootId ?? event.id;
}

/**
 * The id one occurrence has, projected or materialised.
 *
 * A calendar day, not an instant: two gatherings of the same series on one day
 * is not a thing that happens, and a date reads in the Firebase console.
 */
export function occurrenceId(key: string, startAt: Date): string {
  return `${key}-${toDateOnlyValue(startAt)}`;
}

/** One occurrence the rules put on the calendar that has no document. */
export interface ProjectedOccurrence {
  /** The id it would be materialised under. Derived, never generated. */
  id: string;
  /** The instance it takes its shape from. */
  source: OccurrenceSource;
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
}

/**
 * The template each chain is projected from: its latest live instance.
 *
 * The latest rather than the first, because an edit is meant to carry: a leader
 * who moves Friday night to 19:30 has moved the Fridays still ahead, and the
 * ones the calendar shows after it should be the 19:30 ones. Instances already
 * held keep what they were held at, which is exactly what makes them history.
 *
 * Cancelled instances are skipped as templates but still count as existing, so
 * calling one Friday off does not make it reappear in the projection.
 */
function templatesByChain(
  events: readonly OccurrenceSource[],
): Map<string, OccurrenceSource> {
  const templates = new Map<string, OccurrenceSource>();

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
}

/**
 * Which occurrences the rules put between `now` and the horizon that no
 * document already stands for.
 *
 * Returns them in chronological order. Everything a real document covers is
 * left out here rather than merged out later, which is what makes the two sets
 * disjoint by construction — see `lib/eventProjection.ts` for how they are put
 * back together.
 */
export function projectOccurrences(
  events: readonly OccurrenceSource[],
  now: Date,
  options: HorizonOptions = {},
): ProjectedOccurrence[] {
  const horizonDays = options.horizonDays ?? HORIZON_DAYS;

  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const projected: ProjectedOccurrence[] = [];

  /*
   * Every occurrence a document already speaks for, cancelled ones included.
   *
   * Two keys per event, because an event can be spoken for in two different
   * ways. Its id catches the ones materialised from this projection —
   * including one a leader has since dragged to a different evening, which must
   * not reappear on its original date. Its chain-and-day catches everything
   * else: a Friday scheduled by hand, or seeded, carries an id from before this
   * scheme existed and would otherwise be projected alongside itself, putting
   * two Friday Fellowships on one Friday.
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
    // the gathering it was projected from: a lock-in that runs past midnight
    // stays that long, and a window somebody widened stays wide.
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

    for (const startAt of dates) {
      if (startAt > horizon) break;

      const endAt = new Date(startAt.getTime() + duration);
      const checkInClosesAt = new Date(endAt.getTime() + closesOffset);
      // Over and done with. Tally does not invent history — a gathering nobody
      // recorded did not happen, and showing it now would put an empty one on
      // the calendar and in the dashboard's denominator.
      if (checkInClosesAt < now) continue;

      const id = occurrenceId(key, startAt);
      if (taken.has(id)) continue;
      taken.add(id);

      projected.push({
        id,
        source: template,
        startAt,
        endAt,
        checkInOpensAt: new Date(startAt.getTime() + opensOffset),
        checkInClosesAt,
      });
    }
  }

  return projected.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * The occurrence at exactly this instant in this chain, or null.
 *
 * What the materialising callable checks before it writes anything: a client
 * asks for a chain and a start time, and this is the question "is that a
 * gathering the rules actually describe?" asked of the same projection the
 * client was reading. Nothing else about the request is trusted — the payload
 * comes from `source`, and the id from `occurrenceId`.
 */
export function findProjectedOccurrence(
  events: readonly OccurrenceSource[],
  chain: string,
  startAt: Date,
  now: Date,
  options: HorizonOptions = {},
): ProjectedOccurrence | null {
  return (
    projectOccurrences(events, now, options).find(
      (occurrence) =>
        occurrence.startAt.getTime() === startAt.getTime() &&
        occurrence.id === occurrenceId(chain, startAt),
    ) ?? null
  );
}
