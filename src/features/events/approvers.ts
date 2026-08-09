/**
 * "Miriam or Dana can add you."
 *
 * Its own module rather than a second export from `LockedGatherings`, for the
 * same reason `eventStatus.ts` is not a second export from `EventHeroCard`: a
 * file that exports both a component and a plain function loses its Fast Refresh
 * boundary and the whole tree remounts on every save.
 *
 * Two screens need this sentence, which is why it moved. The counselor's chooser
 * prints it under a locked gathering on a Friday night; the Events tab prints it
 * once per restricted chain at the top of the calendar, for a core member whose
 * whole page is somebody else's. Two renderings of *who can let you in* would
 * drift, and the ranking below is the entire content of it.
 *
 * Two names at most. A list of eight is not more actionable than a list of two,
 * and this is one line under a row on a phone. The core team come first when
 * there are more than two, because they can do everything a counselor on the
 * gathering can and more besides — but a counselor on it can add somebody too,
 * and on a Friday night they are the one standing next to you.
 */
import { shortName } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import type { EventAccess, TallyEvent, UserProfile } from '@/types';

export function approvers(
  event: Pick<TallyEvent, 'id' | 'seriesId' | 'recurrenceRootId'>,
  access: ReadonlyMap<string, EventAccess>,
  byUid: ReadonlyMap<string, UserProfile>,
): string | null {
  const list = access.get(chainKey(event));
  if (!list) return null;

  const names = [...list.members]
    .map((uid) => byUid.get(uid))
    .filter((profile): profile is UserProfile => profile !== undefined)
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
