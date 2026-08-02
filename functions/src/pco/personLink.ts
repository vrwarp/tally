/**
 * Following a dead Planning Center person id to whoever holds the record now.
 *
 * Merges are how a church actually cleans duplicates up — a production webhook
 * log showed twelve in one evening's tidy-up — and the mirror Tally reads
 * through says exactly where each record went: `410`, with `meta.merged_into`
 * on the error. Raw Planning Center answers a plain `404` and has forgotten,
 * so against it everything here degrades to "gone", which is all a 404 can
 * mean.
 *
 * Kept apart from `studentPerson.ts` so the roster can follow links without a
 * circular import: these functions know about people, not about students.
 */
import { PcoApiError, type PcoClient } from './client.js';
import type { PcoPerson } from './types.js';

/** A merge chain is people-fixing-duplicates, not a linked list; five hops is
 *  already a story, and a bound is what stops a cycle in corrupt data. */
const MAX_MERGE_HOPS = 5;

/** `404`/`410`: the person is not there, whatever else is true. */
export function isPersonGoneError(error: unknown): error is PcoApiError {
  return error instanceof PcoApiError && (error.status === 404 || error.status === 410);
}

/** The forwarding address on a mirror's tombstone, if the burial was a merge. */
export function mergedForwardOf(error: unknown): string | null {
  if (!(error instanceof PcoApiError) || error.status !== 410) return null;
  const forwarded = error.errors[0]?.meta?.merged_into;
  if (typeof forwarded === 'string' && forwarded) return forwarded;
  if (typeof forwarded === 'number') return String(forwarded);
  return null;
}

export type PersonLink =
  | { outcome: 'live'; personId: string; person: PcoPerson }
  | { outcome: 'gone' };

/**
 * Follows a dead person id to whoever now holds the record, if anybody does.
 *
 * `from` is the error the caller already has in hand from reading the id, so
 * the common case — a plain deletion, no forwarding address — costs no second
 * request. A chain can end dead: the log that motivated this showed a keeper
 * absorbing seven duplicates and then being deleted itself minutes later.
 */
export async function followPersonLink(
  client: PcoClient,
  personId: string,
  from: unknown,
): Promise<PersonLink> {
  const seen = new Set<string>([personId]);
  let next = mergedForwardOf(from);
  for (let hop = 0; next && hop < MAX_MERGE_HOPS; hop += 1) {
    if (seen.has(next)) return { outcome: 'gone' };
    seen.add(next);
    try {
      const body = await client.get<PcoPerson>(`/people/${encodeURIComponent(next)}`);
      const person = Array.isArray(body.data) ? body.data[0] : body.data;
      if (person?.id) return { outcome: 'live', personId: person.id, person };
      return { outcome: 'gone' };
    } catch (error) {
      if (!isPersonGoneError(error)) throw error;
      next = mergedForwardOf(error);
    }
  }
  return { outcome: 'gone' };
}
