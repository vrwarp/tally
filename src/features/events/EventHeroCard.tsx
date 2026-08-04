/**
 * One gathering, at the size of a decision.
 *
 * Used in the two places somebody is choosing rather than browsing: the top of
 * the Events tab, and the check-in screen, which now asks a counselor to say
 * which of today's gatherings they are standing at rather than guessing from
 * the clock.
 *
 * The whole card is the link. A big card with a button inside it is two targets
 * where the reader sees one — the same objection `EventsPage` already makes
 * about nesting a button in an anchor — so the call to action here is a `span`
 * that is styled like a button and is not one. Every pixel of the card goes to
 * the same place, which is what makes it a thumb target rather than a layout.
 */
import { Link } from 'react-router-dom';
import { Badge, EventIcon } from '@/components/ui';
import { formatEventDay, formatEventWindow, isCheckInOpen } from '@/lib/time';
import { eventStatusLine } from '@/features/events/eventStatus';
import { cn } from '@/lib/utils';
import type { TallyEvent } from '@/types';

export interface EventHeroCardProps {
  event: TallyEvent;
  now: Date;
  /** Head count. Only pass one for a gathering that has finished. */
  present?: number;
  /** Where the card leads. */
  to: string;
  /** The words in the button-shaped span at the foot of the card. */
  cta: string;
  /**
   * Show the day as well as the time. Off for a card the reader already knows
   * is today, on wherever the card could be any day.
   */
  showDay?: boolean;
  className?: string;
}

export function EventHeroCard({
  event,
  now,
  present,
  to,
  cta,
  showDay = false,
  className,
}: EventHeroCardProps) {
  const cancelled = event.status === 'cancelled';
  const open = isCheckInOpen(event, now) && !cancelled;

  return (
    <Link
      to={to}
      className={cn(
        'flex flex-col gap-3 rounded-2xl bg-ink-900 p-4 ring-1 active:bg-ink-800',
        // The gathering that is actually happening gets the brand ring, so a
        // counselor walking in can find it without reading anything.
        open ? 'ring-brand-500/40' : 'ring-ink-800',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <EventIcon name={event.icon} size="lg" tone={open ? 'brand' : 'neutral'} />

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'text-lg font-bold leading-tight',
              cancelled ? 'text-ink-400 line-through' : 'text-ink-50',
            )}
          >
            {event.title}
          </h3>
          <p className="mt-0.5 text-sm text-ink-400">
            {showDay ? `${formatEventDay(event.startAt, now)} · ` : ''}
            {formatEventWindow(event)}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
      </div>

      {/* Under the whole header rather than beside the icon: two or three lines
          of prose in a column narrowed by a 56px tile is four words wide on a
          phone. */}
      {event.description ? (
        <p className="text-sm leading-relaxed text-ink-300">{event.description}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
        {open ? <Badge tone="success">Check-in open</Badge> : null}
        {event.requiresRsvp ? <Badge tone="warn">RSVP only</Badge> : null}
        {event.requiresCheckOut ? <Badge tone="neutral">Check-out</Badge> : null}
        {/*
          Said once.

          A ringed green chip reading "Check-in open" sat 8px from grey text
          reading "Check-in is open" — the same fact twice, which makes a reader
          stop and check whether the second is qualifying the first. The badge is
          the compact form and wins; the sentence is worth keeping in every other
          state, where it says something no badge does ("Check-in opens at
          7:00 PM", "Finished · 24 checked in"). The cancelled branch doubles up
          the same way.
        */}
        {open || cancelled ? null : (
          <span className="text-xs text-ink-500">{eventStatusLine(event, now, present)}</span>
        )}
      </div>

      {/* Not a button. See the note at the top of this file. */}
      <span
        className={cn(
          'flex min-h-14 w-full items-center justify-center rounded-xl px-5 text-base font-semibold',
          open
            ? 'bg-brand-500 text-white'
            : 'bg-ink-800 text-ink-100 ring-1 ring-ink-700',
        )}
      >
        {cta}
      </span>
    </Link>
  );
}
