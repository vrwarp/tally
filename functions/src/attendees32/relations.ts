/**
 * The relation vocabulary attendees32 files people under, read once and cached.
 *
 * `all_relations` answers a caller who is not a counselor with `driver` alone
 * unless the query says `category_id=0`, the family category. The family roles
 * are the whole point here — `child` and `parent` are how Tally tells a student
 * from an adult and finds who to call — and the integration user is
 * deliberately not a counselor (that list also opens counseling notes), so the
 * query always says so. Roster, writes and the id lookup all read through this
 * one loader so there is one place to be right about it.
 */
import { cacheKey, type TtlCache } from '../pco/cache.js';
import type { A32Client } from './client.js';
import { API, A32_FAMILY_CATEGORY, A32_RELATION_TITLES, type A32Relation } from './types.js';

export interface A32RelationsOptions {
  client: A32Client;
  cache: TtlCache;
  config: { baseUrl: string };
  force?: boolean;
}

export function relationsCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'a32-relations', base: baseUrl });
}

/** Reference data that changes on the scale of never; the TTL keeps it honest anyway. */
export function loadRelations(options: A32RelationsOptions): Promise<Map<number, A32Relation>> {
  return options.cache.get(
    relationsCacheKey(options.config.baseUrl),
    async () => {
      const byId = new Map<number, A32Relation>();
      for await (const page of options.client.paginate<A32Relation>(API.relations, {
        category_id: A32_FAMILY_CATEGORY,
      })) {
        for (const relation of page.data) byId.set(relation.id, relation);
      }
      return byId;
    },
    options.force,
  );
}

/** The `child` / `parent` relation ids, by the titles the seed gives them. */
export function relationIdsOf(
  relations: ReadonlyMap<number, A32Relation>,
): { child: number | null; parent: number | null } {
  let child: number | null = null;
  let parent: number | null = null;
  for (const relation of relations.values()) {
    if (relation.title === A32_RELATION_TITLES.child) child = relation.id;
    if (relation.title === A32_RELATION_TITLES.parent) parent = relation.id;
  }
  return { child, parent };
}
