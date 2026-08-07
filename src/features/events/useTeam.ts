/**
 * The team, for the two screens that have to name people rather than count them.
 *
 * Deliberately not in `DataProvider`. Every other stream up there is needed on
 * nearly every screen; this one is needed on exactly two — a locked gathering's
 * row, which says who can let you in, and the access sheet, which lists who is
 * on it. Putting it at the root would open a listener on the whole team for
 * every counselor on every screen, in a deployment where nobody has restricted
 * anything and it would never be read.
 *
 * So it is subscribed on demand, and `enabled` is how a caller says the
 * question has actually come up. A chooser with no locked gatherings on it
 * never reads a single document.
 */
import { useEffect, useMemo, useState } from 'react';
import { subscribeUsers } from '@/services/users';
import type { UserProfile } from '@/types';

export interface Team {
  /** Everybody with a profile, active or not, in email order. */
  members: UserProfile[];
  byUid: Map<string, UserProfile>;
  loading: boolean;
}

const NONE: UserProfile[] = [];

export function useTeam(enabled: boolean): Team {
  const [members, setMembers] = useState<UserProfile[]>(NONE);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);

    const unsubscribe = subscribeUsers(
      (next) => {
        setMembers(next);
        setLoading(false);
      },
      () => {
        // A directory that cannot be read is not worth a banner on a screen
        // about something else: the names simply do not appear, and every
        // caller already has a sentence for that case.
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [enabled]);

  const byUid = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  return { members, byUid, loading };
}

/**
 * What to call somebody when the screen has room for one name.
 *
 * Falls back to the email's local part rather than to the whole address: a
 * counselor reading "ask miriam.achebe to add you" can act on it, and one
 * reading "ask miriam.achebe@stpauls.example.org" is reading a line that has
 * wrapped twice.
 */
export function shortName(profile: UserProfile | undefined): string | null {
  if (!profile) return null;
  const display = profile.displayName?.trim();
  if (display) return display.split(/\s+/)[0] ?? display;
  const local = profile.email.split('@')[0];
  return local && local.length > 0 ? local : null;
}
