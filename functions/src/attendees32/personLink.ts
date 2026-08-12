/**
 * Following a dead Attendees id to whoever holds the record now.
 *
 * The Attendees twin of `../pco/personLink.ts`, and deliberately the same
 * shape: a merged-away attendee answers `410` with `merged_into`, a deleted
 * one answers `404`, and a chain is followed to its end because merges are
 * sequential — a coworker tidies duplicates on Sunday and again on Wednesday.
 *
 * This did not exist for most of the Attendees backend's life, and its absence
 * was declared honestly in `capabilities.mergeAware: false`: a person who had
 * moved read as a person who was gone, so a queued edit for them was reported
 * as `orphaned` and a leader was offered a re-create for somebody who already
 * existed under a different id. The capability is true now because attendees32
 * answers the question — see its `AttendeeMergeService`.
 */
import { a32MergedForwardOf, isA32GoneError, type A32Client } from './client.js';
import { API, type A32Attendee } from './types.js';

/**
 * Five, the same as Planning Center's, and for the same reason: a chain that
 * long is already a story worth reading in a log, and a bound is what turns a
 * cycle in hand-edited data into an answer rather than a hang.
 */
const MAX_MERGE_HOPS = 5;

export type A32PersonLink =
  | { outcome: 'live'; personId: string; attendee: A32Attendee }
  | { outcome: 'gone' };

/**
 * Follows a dead attendee id to whoever now holds the record, if anybody does.
 *
 * `from` is the error the caller already has in hand, so the ordinary case — a
 * plain deletion with no forwarding address — costs no second request. A chain
 * can still end dead: attendees32 keeps a tombstone when a survivor is later
 * deleted, and answers `410` with no `merged_into` for exactly that.
 */
export async function followA32PersonLink(
  client: A32Client,
  personId: string,
  from: unknown,
): Promise<A32PersonLink> {
  const seen = new Set<string>([personId]);
  let next = a32MergedForwardOf(from);

  for (let hop = 0; next && hop < MAX_MERGE_HOPS; hop += 1) {
    if (seen.has(next)) return { outcome: 'gone' };
    seen.add(next);
    try {
      const attendee = await client.get<A32Attendee>(API.attendeeById(next));
      if (attendee?.id) return { outcome: 'live', personId: String(attendee.id), attendee };
      return { outcome: 'gone' };
    } catch (error) {
      if (!isA32GoneError(error)) throw error;
      // The survivor was itself merged: keep walking. Anything else — a
      // deletion, a tombstone with nowhere to point — ends the trail here.
      next = a32MergedForwardOf(error);
    }
  }

  return { outcome: 'gone' };
}
