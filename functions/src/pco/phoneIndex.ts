/**
 * The Planning Center half of the kiosk's last-4 phone index.
 *
 * The kiosk lets a parent find their student by the last four digits of any
 * phone number in the family — their own, the other parent's, a sibling's, or
 * the student's. Tally stores none of those numbers (see docs/data-model.md,
 * "What is not stored"), so the index is derived here, fresh from Planning
 * Center, and only the four digits ever leave this module.
 *
 * One sweep of the whole directory, deliberately unfiltered: the roster's own
 * sweep asks `where[child]=true` and the reachability sweep asks the opposite,
 * but a family's numbers live on adults *and* children alike, and this is the
 * one read that wants both. Each page's full numbers are reduced to last-4s
 * before the next page is fetched — the sweep never holds the church's phone
 * book, only its tail digits.
 */
import { phoneLast4Set } from '../generated/phoneDigits.js';
import { cacheKey, type TtlCache } from './cache.js';
import type { PcoClient } from './client.js';
import type { PcoConfig } from '../config.js';
import { buildIncludedIndex, phoneNumbersOf } from './mapping.js';
import { householdIdsOf } from './roster.js';
import type { PcoPerson } from './types.js';

/** One person's contribution: which households they are in, and their last-4s. */
interface PhoneDirectoryEntry {
  households: string[];
  last4: string[];
}

/**
 * Exported so a contact write could drop it, like `reachableAdultsCacheKey`.
 * Nothing does yet — the index is rebuilt on a schedule and on demand, and a
 * number added today is findable after the next rebuild either way.
 */
export function phoneDirectoryCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'kiosk-phone-directory', base: baseUrl });
}

async function sweepPhoneDirectory(client: PcoClient): Promise<Map<string, PhoneDirectoryEntry>> {
  const byPerson = new Map<string, PhoneDirectoryEntry>();

  for await (const page of client.paginate<PcoPerson>('/people', {
    include: ['phone_numbers', 'households'],
    order: 'last_name',
  })) {
    // Per page, like the reachability sweep: the numbers side-loaded here
    // belong to this page's people, and only their last-4s survive the loop.
    const index = buildIncludedIndex(page.included);

    for (const person of page.data) {
      const last4 = phoneLast4Set(phoneNumbersOf(person, index));
      const households = householdIdsOf(person);
      if (last4.length === 0 && households.length === 0) continue;
      byPerson.set(person.id, { households, last4 });
    }
  }

  return byPerson;
}

/**
 * Planning Center person id -> every last-4 in that person's family.
 *
 * "Family" is household co-membership, in every direction and at every age:
 * the student's own numbers, plus every number belonging to anyone who shares
 * any of their households — parents, siblings, the grandmother who lives in.
 * People with nothing on file are simply absent from the result. Keyed by the
 * backend's person id because the caller knows which student document each one
 * answers for — a pushed visitor's document keeps its Tally id.
 */
export async function collectPhoneLast4(options: {
  client: PcoClient;
  config: PcoConfig;
  cache: TtlCache;
  personIds: readonly string[];
  force?: boolean;
}): Promise<Record<string, string[]>> {
  const { client, config, cache } = options;

  const directory = await cache.get(
    phoneDirectoryCacheKey(config.baseUrl),
    () => sweepPhoneDirectory(client),
    options.force,
  );

  const byHousehold = new Map<string, string[]>();
  for (const entry of directory.values()) {
    for (const householdId of entry.households) {
      const bucket = byHousehold.get(householdId);
      if (bucket) bucket.push(...entry.last4);
      else byHousehold.set(householdId, [...entry.last4]);
    }
  }

  const result: Record<string, string[]> = {};
  for (const personId of new Set(options.personIds)) {
    const own = directory.get(personId);
    if (!own) continue;

    const family = new Set(own.last4);
    for (const householdId of own.households) {
      for (const last4 of byHousehold.get(householdId) ?? []) family.add(last4);
    }
    if (family.size > 0) result[personId] = [...family].sort();
  }

  return result;
}
