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
 */
import { EventIcon } from '@/components/ui';
import { useData } from '@/context/dataContext';
import { shortName, useTeam } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import { formatEventWindow } from '@/lib/time';
import type { TallyEvent } from '@/types';

export interface LockedGatheringsProps {
  events: readonly TallyEvent[];
  /**
   * Whether anything on this screen *is* the reader's.
   *
   * Decides both the wording and whether the section starts open — see the
   * note above.
   */
  hasOwn: boolean;
}

/**
 * "Miriam or Dana can add you."
 *
 * Two names at most. A list of eight is not more actionable than a list of two,
 * and this is one line under a row on a phone. The core team come first when
 * there are more than two, because they can do everything a counselor on the
 * gathering can and more besides — but a counselor on it can add somebody too,
 * and on a Friday night they are the one standing next to you.
 */
function approvers(
  event: TallyEvent,
  access: ReturnType<typeof useData>['access'],
  byUid: ReturnType<typeof useTeam>['byUid'],
): string | null {
  const list = access.get(chainKey(event));
  if (!list) return null;

  const names = [...list.members]
    .map((uid) => byUid.get(uid))
    .filter((profile): profile is NonNullable<typeof profile> => profile !== undefined)
    .sort((a, b) => {
      const rank = (role: string) => (role === 'admin' ? 0 : role === 'core' ? 1 : 2);
      return rank(a.role) - rank(b.role);
    })
    .map(shortName)
    .filter((name): name is string => name !== null);

  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} can add you`;
  return `${names[0]} or ${names[1]} can add you`;
}

export function LockedGatherings({ events, hasOwn }: LockedGatheringsProps) {
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
            Not yours · {events.length} {hasOwn ? 'more ' : ''}today
          </span>
          <span aria-hidden className="transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>

        <ul className="flex flex-col gap-1 pt-2">
          {events.map((event) => {
            const who = approvers(event, access, byUid);

            return (
              /*
               * A row, not a hero card, and deliberately less appealing than
               * the thing the counselor came for. Not a link either: there is
               * nowhere useful to go — the gathering's own page would refuse
               * them too — so the row states the situation instead of
               * promising a screen that cannot help.
               */
              <li
                key={event.id}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left"
              >
                <span aria-hidden className="text-ink-600">
                  🔒
                </span>
                <EventIcon name={event.icon} size="sm" tone="muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-300">
                    {event.title}
                  </span>
                  <span className="block truncate text-xs text-ink-500">
                    {formatEventWindow(event)}
                    {who ? ` · ${who}` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
