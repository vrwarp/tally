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
/** The six keys this line can be, as a narrow function type. */
export type EventStatusTranslator = (
  key:
    | 'cancelled'
    | 'checkInOpen'
    | 'checkInOpensAt'
    | 'checkInClosed'
    | 'finishedWithCount'
    | 'finishedEmpty',
  values?: Record<string, string | number>,
) => string;

export function eventStatusLine(
  t: EventStatusTranslator,
  event: TallyEvent,
  now: Date,
  present: number | undefined,
): string {
  if (event.status === 'cancelled') return t('cancelled');
  if (isCheckInOpen(event, now)) return t('checkInOpen');
  if (event.checkInOpensAt > now) {
    return t('checkInOpensAt', { time: formatClock(event.checkInOpensAt) });
  }
  if (present === undefined) return t('checkInClosed');
  return present > 0 ? t('finishedWithCount', { count: present }) : t('finishedEmpty');
}

