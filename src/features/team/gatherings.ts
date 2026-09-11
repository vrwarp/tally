/**
 * Which gatherings an invitation can put somebody on.
 *
 * An invitation carries a list of chains (`docs/team-access.md`, P5), and
 * first sign-in adds the new person to each of them. The list offered here is
 * deliberately narrow: only chains that are *narrowed* — an open gathering
 * needs nobody added to it, so a tick-box for one would be a control that does
 * nothing — and only the ones the inviter could add somebody to by hand today.
 * `redeemInvitation` re-checks that at redemption time and skips anything the
 * inviter has since come off, so a box ticked in October cannot quietly grant
 * access in March; offering a box that is already doomed would just move the
 * disappointment forward.
 *
 * The titles come from the calendar the whole app already holds — `access` is
 * keyed by `chainKey`, and `chainKey` is derived from the events in it — so
 * nothing here reads Firestore.
 */
import { useMemo } from 'react';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { chainKey } from '@/lib/materialize';

export interface InvitableGathering {
  /** The `eventAccess` document id, which is what the invitation stores. */
  key: string;
  /** What the gathering is called. Every event in a chain shares its title. */
  title: string;
}

/**
 * The most chains one invitation may carry.
 *
 * The server refuses a twenty-first, so the form stops at twenty rather than
 * letting somebody tick a box and meet a refusal on the button.
 */
export const MAX_GATHERINGS = 20;

/**
 * What each chain is called, for every chain the calendar knows a name for.
 *
 * Two readers: the tick-boxes below, and the outstanding-placement rows, which
 * have to name a gathering the reader may not be on themselves — so this is
 * deliberately not filtered by who is asking.
 */
export function useChainTitles(): ReadonlyMap<string, string> {
  const { events, series } = useData();
  return useMemo(() => {
    const titles = new Map<string, string>();
    for (const event of events) titles.set(chainKey(event), event.title);
    // A series document outlives the window the calendar holds open, so it is
    // the better answer for a chain whose gatherings have all scrolled past.
    for (const entry of series) if (!titles.has(entry.id)) titles.set(entry.id, entry.title);
    return titles;
  }, [events, series]);
}

export function useInvitableGatherings(): InvitableGathering[] {
  const { access } = useData();
  const { profile, can } = useAuth();
  const titles = useChainTitles();
  const uid = profile?.id ?? '';
  const isAdmin = can('admin');

  return useMemo(() => {
    const offered: InvitableGathering[] = [];
    for (const list of access.values()) {
      if (!list.restricted) continue;
      if (!isAdmin && !list.members.has(uid)) continue;
      const title = titles.get(list.id);
      /*
       * A chain nothing on the calendar names is left off rather than labelled
       * with its key: the key of a hand-made repeat is a document id, and
       * "Put them on 8f2c1ade" is a tick-box nobody can answer. It can only
       * happen to a chain whose every occurrence has fallen out of the loaded
       * window, which is a gathering nobody is recruiting for this week.
       */
      if (!title) continue;
      offered.push({ key: list.id, title });
    }
    return offered.sort((a, b) => a.title.localeCompare(b.title));
  }, [access, titles, isAdmin, uid]);
}
