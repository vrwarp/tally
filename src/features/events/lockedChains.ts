/**
 * Cutting a band of the calendar into "his" and "somebody else's".
 *
 * The Events tab has four bands — today, this week, later, and each past month —
 * and every one of them needs the same partition, so it is written once here
 * rather than four times in two components.
 *
 * ## Why a chain and not a band
 *
 * The obvious grouping is one demoted block per band: *seven gatherings here you
 * are not on*. It is cheaper and it is wrong, because the fact a reader needs is
 * not "these are not yours" — they worked that out from the lock — but *who can
 * let me in*, and that answer is per chain. `eventAccess` holds one document per
 * repeat chain, `approvers()` keys on `chainKey`, and two chains in one ministry
 * routinely have two different sets of people on them. A block mixing them can
 * only name one, or name both and leave the reader to guess which half applies.
 *
 * ## The ordering
 *
 * Groups sort by the date each one advertises, in the direction of the band that
 * holds them — ascending ahead, descending behind. The group head leads with that
 * date, so a list sorted any other way puts its brightest marks out of sequence:
 * a column reading *Sep 4, Aug 21, Aug 16* is read as a fault long before it is
 * read as alphabetical-by-title.
 */
import { chainKey } from '@/lib/materialize';
import type { TallyEvent } from '@/types';

export interface LockedChain {
  /** `chainKey` of every event in `events`, and the `eventAccess` document id. */
  key: string;
  /** What the gathering is called. Every event in a chain shares its title. */
  label: string;
  /** In the band's own direction, so `events[0]` is the one the head names. */
  events: TallyEvent[];
}

export interface PartitionedBand {
  /** The reader's own gatherings, in the order the band already had them. */
  own: TallyEvent[];
  /** Everybody else's, grouped by chain. Empty when nothing is restricted. */
  locked: LockedChain[];
}

/**
 * @param direction `'asc'` ahead of today, `'desc'` behind it. Decides both the
 *   order of the groups and which end of a group the head reads from — the
 *   *next* Friday coming up, the *latest* one gone by.
 */
export function partitionBand(
  events: readonly TallyEvent[],
  canWork: (event: TallyEvent) => boolean,
  direction: 'asc' | 'desc',
): PartitionedBand {
  const own: TallyEvent[] = [];
  const byChain = new Map<string, LockedChain>();

  for (const event of events) {
    if (canWork(event)) {
      own.push(event);
      continue;
    }

    const key = chainKey(event);
    const group = byChain.get(key);
    if (group) group.events.push(event);
    else byChain.set(key, { key, label: event.title, events: [event] });
  }

  const sign = direction === 'asc' ? 1 : -1;
  const locked = [...byChain.values()];

  for (const group of locked) {
    group.events.sort((a, b) => sign * (a.startAt.getTime() - b.startAt.getTime()));
  }
  // By the date the head advertises, which after the sort above is the first.
  locked.sort(
    (a, b) => sign * (a.events[0]!.startAt.getTime() - b.events[0]!.startAt.getTime()),
  );

  return { own, locked };
}

/**
 * The facts every gathering in a chain shares, so the head can state them once.
 *
 * A weekly series has one time and one room, and printing them on all seven rows
 * is how an open group came to cost 420px to deliver seven dates. Anything that
 * varies within the chain — a night moved an hour later, a one-off in a different
 * building — comes back `null` and stays on the rows, which is what makes an
 * exception visible instead of drowning it in six copies of the rule.
 */
export function sharedDetail(events: readonly TallyEvent[]): string | null {
  if (events.length === 0) return null;

  const first = events[0]!;
  const window = `${first.startAt.getHours()}:${first.startAt.getMinutes()}-${first.endAt.getHours()}:${first.endAt.getMinutes()}`;
  const sameWindow = events.every(
    (event) =>
      `${event.startAt.getHours()}:${event.startAt.getMinutes()}-${event.endAt.getHours()}:${event.endAt.getMinutes()}` ===
      window,
  );
  if (!sameWindow) return null;

  const location = events.every((event) => event.location === first.location)
    ? first.location
    : null;

  return location ? `${formatWindow(first)} · ${location}` : formatWindow(first);
}

/**
 * Not `formatEventWindow`, which takes the whole event: this runs over a chain
 * and only ever needs the two clocks.
 */
function formatWindow(event: TallyEvent): string {
  const clock = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${clock(event.startAt)} – ${clock(event.endAt)}`;
}

/**
 * Whether every gathering in a chain falls on the same weekday.
 *
 * When they do, the rows drop the weekday too: a ladder under *Friday
 * Fellowship* reading "Fri 31 / Fri 24 / Fri 17" spends three characters a row
 * on the one thing the head already said.
 */
export function sharedWeekday(events: readonly TallyEvent[]): boolean {
  if (events.length === 0) return false;
  const day = events[0]!.startAt.getDay();
  return events.every((event) => event.startAt.getDay() === day);
}
