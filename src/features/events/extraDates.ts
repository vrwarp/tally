/**
 * Extra dates: nights added to a repeating gathering by hand.
 *
 * The rule is the only thing that puts a night on a chain's calendar, and an
 * edit to any of the chain's nights is an edit to the rule — "moving a Friday
 * night to 19:30 moves the Fridays still ahead". That left no way to say "and
 * also, this once, Saturday the 19th" without either moving every Friday or
 * making a one-off that stood outside the gathering's history, its access list
 * and its labels. An extra date is that night: a document in the chain, with no
 * rule of its own, so it can never become the shape the chain is projected
 * from. See `docs/proposals/extra-nights.md`.
 */
import type { GatheringOption } from '@/lib/gatherings';
import { chainKey } from '@/lib/materialize';
import type { EventDraft } from '@/services/events';
import type { TallyEvent } from '@/types';

const DAY_MS = 86_400_000;

/**
 * What "Add an extra date" opens the editor with, read off one of the chain's
 * own nights.
 *
 * Everything that makes the gathering *that* gathering is carried — its look on
 * the check-in screen, the kiosk's labels and colours, check-out — because the
 * nursery's Christmas Eve is the nursery, and a one-off made by hand at 11pm on
 * the 23rd was how the labels used to go missing.
 *
 * The chain link is the part that has to be exactly right. A chain's key is its
 * series, failing that its root, failing that the night's own id when the night
 * *is* the root, so a root night hands its own id down as the root. A projected
 * night already carries the resolved root (`asEvent` in `lib/eventProjection`).
 *
 * The date is a starting point, not a guess: the day after the night it was
 * opened from, at the same time, keeping the gathering's length and its
 * check-in window. The leader changes it first, and the editor carries the end
 * along when they do.
 */
export function extraDateDefaults(source: TallyEvent): Partial<EventDraft> {
  const shift = (date: Date) => new Date(date.getTime() + DAY_MS);
  return {
    extra: true,
    mode: 'recurring',
    recurrence: null,
    seriesId: source.seriesId,
    recurrenceRootId: source.recurrenceRootId ?? (source.seriesId ? null : source.id),
    title: source.title,
    description: source.description,
    icon: source.icon,
    location: source.location,
    notes: source.notes,
    requiresCheckOut: source.requiresCheckOut,
    labelTemplate: source.labelTemplate,
    kioskTheme: source.kioskTheme,
    kioskBackdropId: source.kioskBackdropId,
    startAt: shift(source.startAt),
    endAt: shift(source.endAt),
    checkInOpensAt: shift(source.checkInOpensAt),
    checkInClosesAt: shift(source.checkInClosesAt),
  };
}

/**
 * The gathering a one-off being written looks like a night of, or null.
 *
 * The other way a leader arrives at an extra date: they tap *New event*, pick
 * *One-off* and type "Friday Fellowship Christmas Party". Two signals, either
 * enough — the trip already borrows that gathering's regulars, or its title
 * names one. Most leaders never touch *Borrow regulars from*, so the title is
 * the signal that actually fires. Longest name first, so "Friday Fellowship
 * Juniors" is not mistaken for "Friday Fellowship".
 */
export function suggestedExtraChain(
  form: { title: string; predictFromChain: string },
  options: readonly GatheringOption[],
): GatheringOption | null {
  if (form.predictFromChain) {
    const borrowed = options.find((option) => option.key === form.predictFromChain);
    if (borrowed) return borrowed;
  }
  const title = form.title.trim().toLocaleLowerCase();
  if (!title) return null;
  return (
    [...options]
      .filter((option) => option.title.trim().length > 0)
      .sort((a, b) => b.title.length - a.title.length)
      .find((option) => title.includes(option.title.trim().toLocaleLowerCase())) ?? null
  );
}

/**
 * The chain's newest ordinary night — what an extra date added to it is shaped
 * from. Never an extra date itself, for the reason the projection never takes
 * one as its template.
 */
export function chainTemplate(
  events: readonly TallyEvent[],
  chain: string,
): TallyEvent | null {
  let latest: TallyEvent | null = null;
  for (const event of events) {
    if (event.mode !== 'recurring' || event.extra) continue;
    if (chainKey(event) !== chain) continue;
    if (!latest || event.startAt > latest.startAt) latest = event;
  }
  return latest;
}
