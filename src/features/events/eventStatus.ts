/**
 * The one line that says where a gathering is in its own evening.
 *
 * Its own module rather than a second export from `EventHeroCard`, which Fast
 * Refresh will not accept: a file that exports both a component and a plain
 * function loses its refresh boundary, and the whole tree remounts on every
 * save. Small price, and the sentence is worth sharing — the hero card, the
 * events list and the check-in chooser all have to agree about what "open"
 * means.
 */
import { formatClock, isCheckInOpen } from '@/lib/time';
import type { TallyEvent } from '@/types';

/**
 * Where a gathering is in its own evening, as one line.
 *
 * A card that says only "7:00 PM – 9:00 PM" leaves the reader doing arithmetic
 * against a clock they would have to leave the app to see, and the answer
 * decides whether they should be tapping names yet.
 *
 * `present` is only ever passed for a gathering whose window has closed —
 * attendance history is a one-shot read, so a count for an evening still in
 * progress would be however many had been tapped in when the screen opened,
 * frozen, beside a card inviting the reader to go and add more.
 */
export function eventStatusLine(
  event: TallyEvent,
  now: Date,
  present: number | undefined,
): string {
  if (event.status === 'cancelled') return 'Cancelled';
  if (isCheckInOpen(event, now)) return 'Check-in is open';
  if (event.checkInOpensAt > now) return `Check-in opens at ${formatClock(event.checkInOpensAt)}`;
  if (present === undefined) return 'Check-in has closed';
  return present > 0 ? `Finished · ${present} checked in` : 'Finished · nobody was checked in';
}

