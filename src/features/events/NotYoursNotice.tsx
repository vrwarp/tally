/**
 * Said once, at the top, instead of thirty-one times down the margin.
 *
 * A core member who has not been added to the weekly gatherings sees the whole
 * calendar and can work almost none of it, and the first version of this screen
 * told them so one row at a time: a padlock and the words *not yours*, eleven
 * pixels high, at the right-hand edge of every past row. Fourteen copies of a
 * sentence that never varies is not information, it is texture — and the word it
 * used was about possession when the fact is about permission and the fix is a
 * person.
 *
 * So the state is a property of the page and lives here, and the rows below
 * carry only what differs. Three things had to be true of it:
 *
 *  - **It names the chains.** "Some gatherings are hidden" is the sentence that
 *    makes somebody think the app is broken.
 *  - **It names people, per chain.** `approvers()` keys on `chainKey` precisely
 *    because two chains in one ministry routinely have two different sets of
 *    people on them; one pair for the whole page is half an answer aimed at
 *    somebody who cannot help, with no way to tell which half.
 *  - **The names are the bright half.** The chain labels are a lookup key and
 *    the headline has just said both of them; the person who can let you in
 *    exists nowhere else on the screen.
 *
 * It does not dismiss. The fact is permanent for as long as it is true, and the
 * day somebody adds this reader to Friday, the notice disappearing is the signal.
 */
import { useMemo } from 'react';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { approvers } from '@/features/events/approvers';
import { useTeam } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import type { TallyEvent } from '@/types';

export interface NotYoursNoticeProps {
  /**
   * Everything on the calendar this screen can see. The notice narrows it
   * itself rather than taking a list of chains, because the question it answers
   * — *which gatherings on this page are not mine* — is about what is drawn.
   */
  events: readonly TallyEvent[];
}

/** "Friday Fellowship or Sunday School", "A, B or C". */
function join(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

export function NotYoursNotice({ events }: NotYoursNoticeProps) {
  const { access, canWork } = useData();
  const { can } = useAuth();

  /*
   * One entry per restricted chain on the calendar, in the order they were met.
   *
   * Over the events rather than over `access`, deliberately: an access document
   * survives its chain, and naming a gathering that is not on this page would be
   * an answer to a question nobody asked.
   */
  const chains = useMemo(() => {
    const seen = new Map<string, TallyEvent>();
    for (const event of events) {
      const key = chainKey(event);
      if (!seen.has(key) && !canWork(event)) seen.set(key, event);
    }
    return [...seen.entries()].map(([key, event]) => ({ key, event }));
  }, [events, canWork]);

  // Only ask for the directory when a name is actually going to be printed.
  const { byUid } = useTeam(chains.length > 0);

  // An admin passes `canWorkChain` unconditionally, so this is already empty for
  // them; the guard is for the ordinary case, which is a ministry with nothing
  // restricted at all.
  if (chains.length === 0 || can('admin')) return null;

  const titles = [...new Set(chains.map(({ event }) => event.title))];

  return (
    <section
      aria-labelledby="not-yours"
      className="flex flex-col gap-2 rounded-xl bg-ink-900 px-4 py-3 ring-1 ring-ink-800 lg:flex-row lg:items-center lg:gap-8"
    >
      <span className="flex min-w-0 items-start gap-3 lg:flex-1">
        <span aria-hidden="true" className="shrink-0 text-sm grayscale opacity-70">
          🔒
        </span>
        <span className="min-w-0 flex-1">
          <span id="not-yours" className="block text-sm font-semibold text-ink-100">
            You are not on {join(titles)}
          </span>
          {/* The phone gets the headline and the names and nothing else: the
              qualifier is the sentence that teaches the row language, and it is
              read once, on a viewport where the notice already costs half a
              fold. */}
          <span className="mt-0.5 hidden text-xs leading-relaxed text-ink-400 lg:block">
            Their dates are below; their head counts are not, and nothing in them is yours to
            open or edit.
          </span>
        </span>
      </span>

      {/* No rule of its own, in either direction. The page allows a hairline
          exactly one meaning — below this line, not yours — and inside a panel
          that is already ringed, 8px says the same thing without competing with
          the demotion mark or with the column divider underneath. */}
      <ul className="flex shrink-0 flex-col gap-1 pl-7 pt-2 text-xs lg:pl-8 lg:pt-0">
        {chains.map(({ key, event }) => {
          const who = approvers(event, access, byUid);
          return (
            <li key={key} className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-semibold text-ink-400 lg:min-w-32">{event.title}</span>
              <span className="min-w-0 truncate text-ink-200">
                {who ?? 'Ask an admin to add you'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
