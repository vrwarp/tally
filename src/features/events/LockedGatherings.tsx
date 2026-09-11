/**
 * The gatherings on tonight that are not yours.
 *
 * The problem this whole feature solves is clutter: the Sunday-morning nursery
 * team's chooser carries Friday's youth night, the retreat and the Wednesday
 * small group, none of which they will ever stand at. The fix is *demotion*,
 * not disappearance, and the difference is the most important decision in the
 * design.
 *
 * A counselor standing at a door at 6:59pm who opens Tally and sees an empty
 * screen does not conclude "I have not been added to this gathering". They
 * conclude the app is broken, and then they find something to file forty
 * check-ins against — which is the worst failure this app has. So a restricted
 * gathering stays on the screen, below a divider, in a quiet collapsed section,
 * with a lock and the name of somebody who can let them in. Never invisible;
 * never as appealing as the thing they came for.
 *
 * Collapsed by default so a counselor on one gathering in a ministry running
 * five gets one card rather than one card and four rejections. Open when
 * nothing tonight is theirs, because that is the moment somebody needs to
 * understand what they are looking at.
 *
 * One name on the row, and the lock. The row is one line on a phone, and a
 * second name or the admin fallback is the part that truncates; the page the
 * gathering opens to carries both, in full.
 */
import { Link } from 'react-router-dom';
import { useData } from '@/context/dataContext';
import { approvers } from '@/features/events/approvers';
import { useTeam } from '@/features/events/useTeam';
import type { TallyEvent } from '@/types';
import { useTranslations } from 'use-intl';
import { useTimeFormats } from '@/hooks/useTimeFormats';

export interface LockedGatheringsProps {
  events: readonly TallyEvent[];
  /**
   * Whether anything on this screen *is* the reader's.
   *
   * Decides both the wording and whether the section starts open — see the
   * note above.
   */
  hasOwn: boolean;
  /**
   * The clock "opened Tally today" is measured against when the row picks
   * whom to name. The wall clock when the caller has none to pass.
   */
  now?: Date;
}

export function LockedGatherings({ events, hasOwn, now = new Date() }: LockedGatheringsProps) {
  const time = useTimeFormats();
  const t = useTranslations('Events');
  const { access } = useData();
  // Only now, and only on a screen that actually has one of these on it.
  const { byUid } = useTeam(events.length > 0);

  if (events.length === 0) return null;

  return (
    <section aria-labelledby="not-yours" className="border-t border-ink-800 pt-4">
      <details open={!hasOwn} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg text-xs font-bold uppercase tracking-wider text-ink-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500">
          {/* "Today" rather than "tonight": this list is the calendar day, and
              a nursery team's gathering is at half past nine in the morning. */}
          <span id="not-yours">
            {t(hasOwn ? 'notYoursCountMore' : 'notYoursCount', { count: events.length })}
          </span>
          {/* Turned about the arrowhead's ink, not its em box. `⌄` hangs low in
              its square, so a plain 180° flip throws the mark to cap height and
              it visibly jumps ~6px when the section opens. */}
          <span
            aria-hidden
            className="origin-[50%_69%] transition-transform group-open:rotate-180"
          >
            ⌄
          </span>
        </summary>

        <ul className="flex flex-col gap-1 pt-2">
          {events.map((event) => {
            const who = approvers(t, event, access, byUid, { now, limit: 1 });

            return (
              /*
               * A row, not a hero card, and deliberately less appealing than
               * the thing the counselor came for — but it does go somewhere.
               *
               * It was inert for a round, on the argument that there is nowhere
               * useful to go. Two things overturned that. The page it opens is
               * not a refusal but the one screen that can help: full names of
               * who can add you, an admin unconditionally, and the button that
               * puts your name on their list. And on a touch screen a tap with
               * no response is indistinguishable from a tap that missed — the
               * inert-row argument was made about a disclosure the reader chose
               * to open, and this section opens by itself precisely when they
               * have chosen nothing.
               *
               * The phone row still prints one name, so the part that truncates
               * is never the way out; the second name and the admin are on the
               * page this leads to.
               */
              <li key={event.id}>
                {/*
                  * A surface and a chevron, because a row with neither was the
                  * least interactive-looking thing on a rail of carded history
                  * rows — the one item on the screen that opens the page that
                  * can actually help read as the footnote explaining why you
                  * are stuck. The lock carries the meaning, so it takes the
                  * icon slot the catch-up rows use and the event's own icon
                  * goes; two glyphs at equal size and equal spacing made "you
                  * cannot work this" and "it is in the morning" look like a
                  * matched pair of ornaments.
                  */}
                <Link
                  to={`/event/${event.id}`}
                  className="flex min-h-11 items-center gap-3 rounded-xl bg-ink-900/60 px-3 py-2 text-left ring-1 ring-ink-800 hover:bg-ink-900 active:bg-ink-900"
                >
                  <span aria-hidden className="text-base text-ink-500">
                    🔒
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-300">
                      {event.title}
                    </span>
                    <span className="block truncate text-xs text-ink-500">
                      {time.eventWindow(event)}
                      {who ? ` · ${who}` : ''}
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 text-ink-500">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
