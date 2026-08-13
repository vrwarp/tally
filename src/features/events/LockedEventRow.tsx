/**
 * One gathering inside a locked chain's disclosure: a date, and nothing else.
 *
 * The row carries only what varies. Its chain is named on the head above it, its
 * time and room are on the head's second line whenever the chain shares them,
 * and its weekday is dropped when every night in the chain falls on the same
 * one. What is left is "Fri 31", which is the only thing distinguishing this row
 * from the six around it — and which, before this stripping, was the faintest
 * mark in a row whose two strongest positions carried an icon and a title that
 * were identical all the way down the list.
 *
 * ## It is a link, and that took two goes to settle
 *
 * The first attempt made it inert, borrowing `LockedGatherings`' argument that
 * there is nowhere useful to go. That argument is about a row a counselor meets
 * unannounced in a chooser. It does not survive contact with a touch screen: a
 * row-shaped thing that does nothing at all when tapped is indistinguishable from
 * a tap that missed, and the recovery is to tap again, harder, and then conclude
 * the app has hung.
 *
 * A row reached by deliberately opening a disclosure headed *not yours · Miriam
 * or Dana can add you* is a different case. The reader is informed before they
 * tap, `events: get` genuinely permits reading the gathering, and
 * `LockedGathering` names the people who can add them to it — so the wall is a
 * destination they chose rather than a trap.
 */
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import type { TallyEvent } from '@/types';

export interface LockedEventRowProps {
  event: TallyEvent;
  /**
   * Drop the weekday, because the chain's head has already said it. Off for a
   * chain whose nights are scattered, where the weekday is a real discriminator.
   */
  sharedWeekday?: boolean;
  /**
   * The chain's time and room, when it has one of each. Passed so a row can say
   * what its head could not — the night somebody moved by an hour is the one row
   * in the ladder that needs a second line.
   */
  detail?: string | null;
}

export function LockedEventRow({ event, sharedWeekday = false, detail = null }: LockedEventRowProps) {
  return (
    <li>
      {/*
        `/events/`, not `/event/`, like every other row on this calendar.

        Both routes end at `LockedGathering` for a gathering the reader is not
        on, and they end at *different* ones: the check-in route takes the
        default back link and offers a way out to the counselor screen, which is
        not where anybody reading the calendar came from.

        This row used to be the exception that proved a rule the page did not
        actually follow — the unlocked rows beside it went to the register. They
        do not any more. Which tab you came from decides where a gathering opens:
        the calendar manages, the chooser takes the register, and the one
        crossing is the "Take attendance" button at the top of the event page.
      */}
      <Link
        to={`/events/${event.id}`}
        className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg py-1.5 pl-17 pr-3 hover:bg-ink-800/40 active:bg-ink-800 pointer-fine:min-h-9 lg:min-h-8 lg:py-1 lg:pl-2.5 lg:pr-2.5"
      >
        {/* The indent is padding on the row rather than on the list, so the hit
            box spans the whole column while the text still lands on the 68px
            axis every other row uses. As a list inset it left 72px of dead
            column beside every row, and the nearest live target in that dead
            column was the control that collapses the group. */}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-300 lg:flex-none">
          {format(event.startAt, sharedWeekday ? 'MMM d' : 'EEE, MMM d')}
          {/* Only when the chain's own head could not state a time — a series
              whose nights are not all at the same hour. Then the hour is a fact
              that varies, so it belongs on the row. */}
          {detail === null ? (
            <span className="text-xs font-normal text-ink-400">
              {` · ${format(event.startAt, 'h:mm a')}`}
            </span>
          ) : null}
        </span>

        {/* Hidden where there is a pointer: at `lg` the ladder becomes a wrapping
            flow of dates, and a chevron per chip would eat a third of the chip
            to repeat what the flow already says. Hover carries it there. */}
        <span aria-hidden="true" className="shrink-0 text-lg text-ink-400 lg:hidden">
          ›
        </span>
      </Link>
    </li>
  );
}
