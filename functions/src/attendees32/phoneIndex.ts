/**
 * The Attendees half of the kiosk's last-4 phone index.
 *
 * Same contract as the Planning Center collector (../pco/phoneIndex.ts): every
 * distinct last-4 across the student's family, keyed by Tally student id, and
 * only the four digits ever leave the module. "Family" here is co-membership
 * in a family-category folk — every non-removed member at any relation, which
 * takes parents and siblings alike without asking the relation vocabulary
 * anything. The one sweep the adapter already caches carries everything this
 * needs: contacts and folk edges ride on every attendee row.
 */
import { phoneLast4Set } from '../generated/phoneDigits.js';
import { allPhonesOf } from './mapping.js';
import type { A32FlowOptions } from './roster.js';
import { cachedSweep } from './roster.js';
import { A32_FAMILY_CATEGORY, type A32Attendee } from './types.js';

function familyFolkIds(attendee: A32Attendee): string[] {
  const ids: string[] = [];
  for (const edge of attendee.folkattendee_set ?? []) {
    if (edge.is_removed === true) continue;
    if (edge.folk.category !== A32_FAMILY_CATEGORY) continue;
    if (edge.attendee !== attendee.id) continue;
    ids.push(edge.folk.id);
  }
  return ids;
}

/**
 * Attendee id -> every last-4 in that attendee's family. Keyed by the
 * backend's own id, like the Planning Center collector, because the caller
 * maps each person to the student document that answers for them.
 */
export async function collectPhoneLast4(
  options: A32FlowOptions & { personIds: readonly string[] },
): Promise<Record<string, string[]>> {
  const swept = await cachedSweep(options);

  const last4ByAttendee = new Map<string, string[]>();
  const byFolk = new Map<string, string[]>();
  for (const attendee of swept.values()) {
    const last4 = phoneLast4Set(allPhonesOf(attendee));
    last4ByAttendee.set(attendee.id, last4);
    for (const folkId of familyFolkIds(attendee)) {
      const bucket = byFolk.get(folkId);
      if (bucket) bucket.push(...last4);
      else byFolk.set(folkId, [...last4]);
    }
  }

  const result: Record<string, string[]> = {};
  for (const personId of new Set(options.personIds)) {
    const attendee = swept.get(personId);
    if (!attendee) continue;

    const family = new Set(last4ByAttendee.get(personId) ?? []);
    for (const folkId of familyFolkIds(attendee)) {
      for (const last4 of byFolk.get(folkId) ?? []) family.add(last4);
    }
    if (family.size > 0) result[personId] = [...family].sort();
  }

  return result;
}
