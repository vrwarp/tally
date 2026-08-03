/**
 * The custom field that says which Attendees person a Planning Center person
 * is.
 *
 * A church that runs both systems keeps the bridge on the Planning Center
 * side: a People custom field — slug `attendees_uuid` — holding the person's
 * Attendees UUID. Tally reads it and treats the two records as one human:
 * the merged roster shows one row, adding from either directory lands on the
 * same student, and an imported history files under the membership the church
 * already has.
 *
 * Everything degrades to "no aliases" rather than to a failure. An org
 * without the field pays one cached probe of `/field_definitions` per cache
 * window and nothing else; a server that has no `/field_definitions` at all —
 * an older mirror — answers that probe with an error this module swallows.
 * The alias is a pair of ids, so reading it moves no personal data.
 */
import { cacheKey, type TtlCache } from './cache.js';
import type { PcoClient } from './client.js';
import type { JsonApiResource, PcoFieldDefinition } from './types.js';

/** The slug the church's field must carry. A convention, not a config knob. */
export const A32_UUID_FIELD_SLUG = 'attendees_uuid';

/** Exported so a settings write that renames fields upstream could drop it. */
export function a32UuidFieldCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'a32-uuid-field', base: baseUrl });
}

/**
 * The field definition id behind `attendees_uuid`, or null when the org keeps
 * no such field. Cached — including the null — because the answer changes
 * about as often as the church restructures its database.
 */
export async function resolveA32UuidFieldId(options: {
  client: PcoClient;
  cache: TtlCache;
  baseUrl: string;
  force?: boolean;
}): Promise<string | null> {
  return options.cache.get(
    a32UuidFieldCacheKey(options.baseUrl),
    async () => {
      try {
        for await (const page of options.client.paginate<PcoFieldDefinition>(
          '/field_definitions',
        )) {
          for (const definition of page.data) {
            const attributes = definition.attributes ?? {};
            if (attributes.slug === A32_UUID_FIELD_SLUG && !attributes.deleted_at) {
              return definition.id;
            }
          }
        }
      } catch {
        // No such endpoint, or no permission to read it: an org with no
        // aliases, not a broken roster.
      }
      return null;
    },
    options.force,
  );
}

/**
 * Person id -> Attendees UUID, read out of the `included` array a
 * `?include=field_data` request side-loads.
 *
 * The datum names its person under `customizable` — the real API's word for
 * the owning record — with `person` accepted as well for older shapes. Only
 * data of the resolved definition counts; the org's other custom fields pass
 * through untouched and unread.
 */
export function a32AliasesFromIncluded(
  included: readonly JsonApiResource[],
  fieldDefinitionId: string,
): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const resource of included) {
    if (resource.type !== 'FieldDatum') continue;
    const relationships = resource.relationships ?? {};
    const definition = relationships.field_definition?.data;
    const definitionId = Array.isArray(definition) ? undefined : definition?.id;
    if (definitionId !== fieldDefinitionId) continue;

    const owner = relationships.customizable?.data ?? relationships.person?.data;
    const personId = Array.isArray(owner) ? undefined : owner?.id;
    const value =
      typeof (resource.attributes as { value?: unknown } | undefined)?.value === 'string'
        ? ((resource.attributes as { value: string }).value ?? '').trim()
        : '';
    if (personId && value) aliases[personId] = value;
  }
  return aliases;
}
