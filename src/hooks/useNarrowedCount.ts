import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { chainKey } from '@/lib/materialize';
import type { TallyEvent } from '@/types';

/**
 * How many people are inside this gathering's fence, or `null` where there is
 * no fence or the reader is not an admin.
 *
 * Separate from the badge because a caller that gates on "any badges at all"
 * has to know the answer before it renders: a `<NarrowedBadge>` that decides
 * for itself and returns `null` still counts as an element, and on the Events
 * calendar that is an empty flex row with a 6px margin under every gathering
 * that carries no tags.
 */
export function useNarrowedCount(event: TallyEvent): number | null {
  const { can } = useAuth();
  const { access } = useData();
  const list = access.get(chainKey(event));
  return can('admin') && list?.restricted === true ? list.members.size : null;
}
