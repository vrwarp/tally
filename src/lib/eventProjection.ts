/**
 * The calendar the app renders: documents, plus the gatherings the rules
 * describe that nothing has been written down for.
 *
 * `lib/materialize.ts` decides *which* occurrences a set of rules puts on the
 * calendar. This turns them into `TallyEvent`s and merges them with the real
 * ones, so every screen keeps reading one list and never has to know which kind
 * it is holding. That is the whole point of doing it here: `EventsPage`,
 * `useActiveEvent`, the dashboard and check-in were all written against a
 * queried collection, and they still are.
 *
 * The one thing a screen has to care about is `materialized`. A projected
 * gathering can be read, listed, opened and predicted from, but it cannot be
 * written to — there is no document yet. Anything that writes calls
 * `ensureMaterialized` first (see `services/events.ts`), which is a single
 * round trip that turns the projection into the document it always described.
 */
import { projectOccurrences, type HorizonOptions } from '@/lib/materialize';
import type { TallyEvent } from '@/types';

/**
 * A projected occurrence as an event.
 *
 * Everything comes from the chain's template except the four times, which come
 * from the rule. The bookkeeping fields are inherited rather than invented:
 * `updatedAt` in particular is load-bearing, because `EventEditorModal` keys
 * its form reset on it — a projected gathering whose `updatedAt` moved every
 * render would reset the form under a leader mid-edit.
 *
 * `requiresRsvp` is false for the same structural reason it is always false on a
 * recurring gathering: an RSVP list belongs to a one-off, and a one-off never
 * repeats, so nothing here can have been projected from one.
 */
function asEvent(
  occurrence: ReturnType<typeof projectOccurrences>[number],
  template: TallyEvent,
): TallyEvent {
  const { source } = occurrence;

  return {
    id: occurrence.id,
    title: source.title,
    mode: 'recurring',
    seriesId: source.seriesId,
    recurrence: source.recurrence,
    // The chain's root, resolved here so every projected instance carries the
    // same one and the derived ids stay stable.
    recurrenceRootId: source.recurrenceRootId ?? source.id,
    startAt: occurrence.startAt,
    endAt: occurrence.endAt,
    checkInOpensAt: occurrence.checkInOpensAt,
    checkInClosesAt: occurrence.checkInClosesAt,
    location: source.location,
    notes: source.notes,
    requiresRsvp: false,
    defaultGroupingMode: source.defaultGroupingMode,
    // A projected gathering is on by definition. Calling one off is an act, and
    // an act materialises it.
    status: 'scheduled',
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    createdBy: template.createdBy,
    materialized: false,
  };
}

/**
 * Everything on the calendar between the recent past and the horizon.
 *
 * Newest first, matching the order `subscribeEvents` delivers, so a consumer
 * that was reading the query result unchanged still gets what it expects.
 *
 * The two sets are disjoint before they are concatenated: `projectOccurrences`
 * drops any occurrence a document already speaks for, keyed on the derived id.
 * So there is no precedence rule here to get wrong — a real document is simply
 * the only one of the pair that exists.
 */
export function projectEvents(
  stored: readonly TallyEvent[],
  now: Date,
  options: HorizonOptions = {},
): TallyEvent[] {
  const occurrences = projectOccurrences(stored, now, options);
  if (occurrences.length === 0) return [...stored];

  const byId = new Map(stored.map((event) => [event.id, event]));

  const projected: TallyEvent[] = [];
  for (const occurrence of occurrences) {
    // The template is one of `stored` by construction — it is where the chain's
    // rule was read from — so this only misses if a caller passed occurrences
    // from a different list than the events they came out of.
    const template = byId.get(occurrence.source.id);
    if (template) projected.push(asEvent(occurrence, template));
  }

  return [...stored, ...projected].sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
}

/**
 * A cheap identity for a projected calendar, so an unchanged one can be dropped.
 *
 * The projection is recomputed on every clock tick, and almost every tick
 * produces exactly the same gatherings. Handing back a new array anyway
 * re-renders every screen in the app once a minute — the same problem, and the
 * same fix, as `rosterSignature` in the data provider.
 *
 * Only the fields that decide what a screen draws are compared. `updatedAt` is
 * in there because an edit that changes nothing else still has to reach the
 * editor's form-reset key.
 */
export function calendarSignature(events: readonly TallyEvent[]): string {
  return events
    .map(
      (event) =>
        `${event.id}|${event.startAt.getTime()}|${event.endAt.getTime()}|${event.status}|${event.materialized ? 1 : 0}|${event.updatedAt.getTime()}`,
    )
    .join('\n');
}
