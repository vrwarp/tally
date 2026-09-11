/**
 * "Miriam or Dana can add you."
 *
 * Its own module rather than a second export from `LockedGatherings`, for the
 * same reason `eventStatus.ts` is not a second export from `EventHeroCard`: a
 * file that exports both a component and a plain function loses its Fast Refresh
 * boundary and the whole tree remounts on every save.
 *
 * Three screens need this sentence, which is why it moved. The counselor's
 * chooser prints it under a locked gathering on a Friday night; the Events tab
 * prints it once per restricted chain at the top of the calendar, for a core
 * member whose whole page is somebody else's; the locked page prints the whole
 * list. Three renderings of *who can let you in* would drift, and the ranking
 * below is the entire content of it.
 *
 * ## The ranking
 *
 * Somebody who opened Tally today first, then the core team, then admins, then
 * everybody else. Presence before rank, because the sentence is read in a lobby
 * by somebody who needs a person, not a title: the counselor who signed in an
 * hour ago is standing at the next door, and the admin who set the gathering up
 * in March may be on leave. `lastSeenAt` is stamped once per session by design,
 * so what it actually says is "opened Tally today", and the ranking claims no
 * more than that. Core before admin, because an admin passes every gate
 * whatever the list says and is named separately as the fallback anyway.
 *
 * Suspended profiles are never named. Membership survives suspension on
 * purpose — un-suspending somebody restores them to every gathering they were
 * on — so the filtering happens here, at read time, rather than as a cleanup.
 *
 * Two names at most. A list of eight is not more actionable than a list of two,
 * and this is one line under a row on a phone; the page the row opens carries
 * the full list.
 */
import { fullName, shortName } from '@/features/events/useTeam';
import { chainKey } from '@/lib/materialize';
import { startOfDay } from '@/lib/time';
import type { EventAccess, TallyEvent, UserProfile } from '@/types';

/** The three keys this hint can be, as a narrow function type. */
export type ApproverTranslator = (
  key: 'oneApprover' | 'twoApprovers' | 'orAnyAdmin',
  values?: Record<string, string>,
) => string;

export interface ApproverOptions {
  /** The clock "today" is measured against. Defaults to the wall clock. */
  now?: Date;
  /** How many names to print. Two on a page, one on a phone row. */
  limit?: number;
}

/**
 * Whether this profile's once-a-session stamp landed today.
 *
 * Calendar day, not the last twenty-four hours: the stamp is written on the
 * first sign-in of a session, and "opened Tally this morning" is the fact a
 * reader can act on at seven in the evening.
 */
export function openedTallyToday(profile: Pick<UserProfile, 'lastSeenAt'>, now: Date): boolean {
  if (!profile.lastSeenAt) return false;
  return startOfDay(profile.lastSeenAt).getTime() === startOfDay(now).getTime();
}

function rank(profile: UserProfile, now: Date): number {
  if (openedTallyToday(profile, now)) return 0;
  if (profile.role === 'core') return 1;
  if (profile.role === 'admin') return 2;
  return 3;
}

/**
 * The people on a list who could actually add somebody, best first.
 *
 * Resolved against the directory, suspended profiles dropped, and sorted by
 * the ranking above. The sort is stable, so two people of the same rank keep
 * the order the document holds them in.
 */
export function rankApprovers(
  uids: Iterable<string>,
  byUid: ReadonlyMap<string, UserProfile>,
  now: Date,
): UserProfile[] {
  return [...uids]
    .map((uid) => byUid.get(uid))
    .filter((profile): profile is UserProfile => profile !== undefined && profile.active)
    .sort((a, b) => rank(a, now) - rank(b, now));
}

export function approvers(
  t: ApproverTranslator,
  event: Pick<TallyEvent, 'id' | 'seriesId' | 'recurrenceRootId'>,
  access: ReadonlyMap<string, EventAccess>,
  byUid: ReadonlyMap<string, UserProfile>,
  { now = new Date(), limit = 2 }: ApproverOptions = {},
): string | null {
  const list = access.get(chainKey(event));
  if (!list) return null;

  const names = rankApprovers(list.members, byUid, now)
    .map(shortName)
    .filter((name): name is string => name !== null)
    .slice(0, Math.max(1, limit));

  if (names.length === 0) return null;
  if (names.length === 1) return t('oneApprover', { name: names[0]! });
  return t('twoApprovers', { first: names[0]!, second: names[1]! });
}

/**
 * "or any admin: Dana Ruiz" — always, after the names.
 *
 * An admin passes every gate whatever a list says, so an admin is always a
 * way in, and the sentence used to say so only when the list was empty. The
 * named person may be on leave, or suspended since June, which the app cannot
 * know and the reader can; naming the fallback unconditionally is what lets
 * the reader choose. The first active admin in the directory's own order —
 * one name, a full one, because a forename is no answer to somebody who has
 * never met Dana in a lobby of two hundred.
 *
 * Null when the directory holds no active admin, which is a directory that
 * has not loaded rather than a ministry without one; the callers already have
 * a sentence for that.
 */
export function approversFallback(
  t: ApproverTranslator,
  team: readonly UserProfile[],
): string | null {
  const admin = fallbackAdmin(team);
  return admin ? t('orAnyAdmin', { name: fullName(admin) }) : null;
}

/**
 * The same admin, as a person rather than as a sentence.
 *
 * A screen that already draws the people you could ask as rows wants this
 * one as a row too. Rendering it as prose under the list made the reader
 * parse two shapes for one idea — a name with a role beside it, then a
 * sentence with a name after a colon — and the shape that looked like an
 * afterthought was the one that is unconditionally true.
 */
export function fallbackAdmin(team: readonly UserProfile[]): UserProfile | null {
  return team.find((member) => member.active && member.role === 'admin') ?? null;
}
