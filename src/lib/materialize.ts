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
 *
 * **Writing one night down decides nothing about any other.** Materialising an
 * occurrence removes it from the projection and leaves the rest of the calendar
 * exactly where it was — there is a test that asserts precisely that, over every
 * occurrence in the window. It is the property that makes the other two safe to
 * rely on, because materialising is not a thing a leader chooses: a counselor
 * opening the check-in screen does it, and so does a kiosk being set up in a
 * lobby. Every way the calendar has silently rearranged itself has been a way
 * this was not true — a chain re-keyed by an edit and projected twice, a
 * template still ahead of today hiding the weeks before it, a tally that
 * restarted on whichever night was newest.
 */
import type { KioskTheme } from '@/lib/kioskTheme';
import type { LabelTemplate } from '@/lib/labelTemplate';
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
  /** Carried the same way, and for the same reason. */
  labelTemplate: LabelTemplate | null;
  /** And this, which is what a kiosk bound to the occurrence will wear. */
  kioskTheme: KioskTheme | null;
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

/** What one chain is expanded from. */
interface ChainProjection {
  /**
   * The instance the occurrences take their shape and their rule from: the
   * chain's latest live one.
   *
   * The latest rather than the first, because an edit is meant to carry: a
   * leader who moves Friday night to 19:30 has moved the Fridays still ahead,
   * and the ones the calendar shows after it should be the 19:30 ones.
   * Instances already held keep what they were held at, which is exactly what
   * makes them history.
   *
   * The latest can be a night that has not happened yet — a leader edits *next*
   * Friday far more often than last one, and a kiosk binds to a Sunday days
   * before it. That is why the expansion reaches backwards as well as forwards
   * (see `patternDates`): a template ahead of today has to describe the nights
   * between here and it, not erase them.
   */
  template: OccurrenceSource;
  /**
   * The chain's earliest known instance, which is where a `COUNT` starts
   * counting.
   *
   * Not the template, and that is the whole reason this exists. "Weekly, four
   * times" means four nights from the night it began, but the template is
   * whichever night is newest — so tallying from there handed the chain four
   * more every time one of its nights became a document, and a bounded repeat
   * never ended.
   */
  origin: OccurrenceSource;
}

/**
 * Which chains have something to project, and what each is projected from.
 *
 * Cancelled instances are skipped when there is anything live to prefer —
 * calling off one Friday should not make the rest of the term inherit the shape
 * of the night that did not happen. They are used when there is nothing else,
 * because the alternative is worse: a leader who schedules a weekly gathering
 * and then calls off its first night would otherwise have deleted the whole
 * repeat, silently and with no way back but to un-cancel. Cancelling one date
 * is meant to call off one date, which is what the danger zone promises.
 *
 * Either way a cancelled instance still counts as existing — `taken` below is
 * built from every event, live or not — so this cannot put a called-off Friday
 * back on the calendar.
 */
function chainsToProject(
  events: readonly OccurrenceSource[],
): Map<string, ChainProjection> {
  const live = new Map<string, OccurrenceSource>();
  const cancelled = new Map<string, OccurrenceSource>();
  const origins = new Map<string, OccurrenceSource>();

  for (const event of events) {
    if (event.mode !== 'recurring' || !event.recurrence) continue;

    const key = chainKey(event);
    const pool = event.status === 'cancelled' ? cancelled : live;
    const latest = pool.get(key);
    if (!latest || event.startAt > latest.startAt) pool.set(key, event);

    /*
     * The root document *is* the chain — its id is the chain key — so it is the
     * first occurrence by definition and nothing earlier can turn up. Failing
     * that, the earliest instance loaded, which is only the true beginning if
     * the chain started inside the window the caller read. A chain older than
     * that counts from too late and a bounded repeat runs on a little; that is
     * a bounded error, and the alternative is reading the whole collection back
     * to the ministry's first night on every tick of the clock.
     */
    const origin = origins.get(key);
    // Stryker disable next-line EqualityOperator: two instances written for the
    // same instant are the same beginning, and only `origin.startAt` is read
    // downstream — so which of the two is kept cannot be observed.
    if (!origin || (origin.id !== key && (event.id === key || event.startAt < origin.startAt))) {
      origins.set(key, event);
    }
  }

  const chains = new Map<string, ChainProjection>();
  for (const [key, origin] of origins) {
    const template = live.get(key) ?? cancelled.get(key);
    // Stryker disable next-line ConditionalExpression: every key in `origins`
    // was put there by the same iteration that filled one of the two pools, so
    // there is always a template. The check is here for the type.
    if (template) chains.set(key, { template, origin });
  }

  return chains;
}

/**
 * The last occurrence a `COUNT`-bounded rule permits, or null when nothing
 * bounds it.
 *
 * Resolved to a date so the projection can compare against it directly, the way
 * it already does with `UNTIL` — which is the shape a bound has to have here.
 * A tally is a fact about a chain, and the projection expands one instance of
 * it; the only way to carry "four times" onto a walk that starts somewhere in
 * the middle is to work out ahead of time which night the fourth is.
 */
function countBound(rule: RecurrenceRule, origin: Date): Date | null {
  if (rule.count === null) return null;
  const dates = recurrenceOccurrences({ ...rule, count: null, until: null }, origin, {
    limit: rule.count,
  });
  return dates[dates.length - 1] ?? origin;
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
    // Stryker disable next-line ConditionalExpression: adding the chain-and-day
    // key for a one-off changes nothing that can be reached. A one-off is not
    // projected from (see `chainsToProject`), and one that used to be part of a
    // chain still carries the id that projection gave it — which the line above
    // has already claimed.
    if (event.mode === 'recurring') taken.add(occurrenceId(chainKey(event), event.startAt));
  }

  for (const [key, { template, origin }] of chainsToProject(events)) {
    const rule: RecurrenceRule | null = template.recurrence;
    // Stryker disable next-line ConditionalExpression: `chainsToProject` pools
    // only events that have a rule, so a template without one never gets here.
    // The check is what makes `rule` a `RecurrenceRule` below.
    if (!rule) continue;

    // Worked out from the chain's beginning rather than from the template, and
    // taken off the rule before it is expanded so the two cannot both apply.
    const last = countBound(rule, origin.startAt);

    // Offsets rather than absolute times, so an occurrence keeps the shape of
    // the gathering it was projected from: a lock-in that runs past midnight
    // stays that long, and a window somebody widened stays wide.
    const duration = template.endAt.getTime() - template.startAt.getTime();
    const opensOffset = template.checkInOpensAt.getTime() - template.startAt.getTime();
    const closesOffset = template.checkInClosesAt.getTime() - template.endAt.getTime();

    // Expanded from the template's own start: it is an occurrence of the rule
    // by construction, so the phase of "every 2 weeks" and the position of "the
    // third Tuesday" both carry over without re-deriving them. The walk reaches
    // back to `from` as well as forward, so a template still ahead of today
    // describes the nights between here and it rather than hiding them.
    //
    // Expansion starts *before* `now` by the length of one gathering, because a
    // gathering that has already started is the one that matters most: a
    // counselor opening Tally at 19:30 needs tonight's 19:00 Friday, and
    // starting at `now` would skip straight past it to next week. Anything
    // genuinely finished is dropped below.
    const tail = Math.max(0, template.checkInClosesAt.getTime() - template.startAt.getTime());
    const dates = recurrenceOccurrences({ ...rule, count: null }, template.startAt, {
      // At most one occurrence can land per day, so the horizon plus the
      // lookback bounds how many there can be.
      limit: horizonDays + 2,
      from: new Date(now.getTime() - tail),
    });

    for (const startAt of dates) {
      if (startAt > horizon) break;
      if (last && startAt > last) break;

      const endAt = new Date(startAt.getTime() + duration);
      const checkInClosesAt = new Date(endAt.getTime() + closesOffset);
      // Over and done with. Tally does not invent history — a gathering nobody
      // recorded did not happen, and showing it now would put an empty one on
      // the calendar and in the dashboard's denominator.
      if (checkInClosesAt < now) continue;

      const id = occurrenceId(key, startAt);
      if (taken.has(id)) continue;
      // Stryker disable next-line CallExpression: each chain is visited once
      // and a rule yields at most one occurrence per day, so nothing in this
      // run can produce the same id twice. It is here so the set means "spoken
      // for" rather than "spoken for by a document".
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
      // Both halves, because the id carries the day and not the clock: a
      // request for the right Friday at the wrong hour matches the id alone.
    ) ?? null
  );
}
