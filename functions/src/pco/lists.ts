/**
 * Reading Planning Center's Lists, so a leader can choose one instead of
 * pasting an id out of a URL.
 *
 * A List is the thing a youth pastor already maintains, which makes it the
 * right roster source and — until now — the most awkward setting in Tally: the
 * id lives in a browser address bar, gets copied into a deploy-time parameter,
 * and is wrong in a way nothing can tell you about, because "list 1234567 has
 * no members" and "list 1234567 is somebody's 2019 camp roster" look identical
 * from here.
 *
 * So this module reads the lists themselves. `total_people` comes back on the
 * collection, which means the picker can show what each choice would actually
 * select before anybody commits to it.
 *
 * Creating a list is deliberately absent, because the API has no such thing:
 * `/lists` is GET-only, there is no POST anywhere on the vertex, and there is
 * no way to add a person to a list either. Lists are built in Planning Center,
 * which is the correct place for them to be built. The app links out.
 */
import type { PcoClient } from './client.js';
import type { PcoList } from './types.js';

/**
 * One list, as the Settings picker needs it.
 *
 * The health fields are here because they answer the support question this
 * feature otherwise creates. "Why is that student missing?" is usually not a
 * bug: it is a list whose rules broke (`invalid`), or one that has not been
 * refreshed since the spring (`refreshedAt` with `autoRefresh` off).
 */
export interface PcoListSummary {
  id: string;
  name: string;
  description: string | null;
  /** Members as of the list's last refresh — what choosing it would select. */
  totalPeople: number | null;
  /** ISO 8601, or null when Planning Center has never run it. */
  refreshedAt: string | null;
  autoRefresh: boolean;
  /** True when Planning Center says the list's own rules no longer work. */
  invalid: boolean;
  /** Starred by somebody in People — a decent proxy for "one that matters". */
  starred: boolean;
}

/**
 * Lists are per-organisation and there are rarely many, but "rarely" is not a
 * bound. A church that has been running People for a decade can have hundreds,
 * and the picker is a dropdown, not an archive.
 */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toSummary(resource: PcoList): PcoListSummary | null {
  const attributes = resource.attributes ?? {};
  const name = str(attributes.name);
  // A list with no id is not addressable and a list with no name is not
  // choosable; either way there is nothing to show a leader.
  if (!resource.id || !name) return null;

  const totalPeople =
    typeof attributes.total_people === 'number' && Number.isFinite(attributes.total_people)
      ? attributes.total_people
      : null;

  return {
    id: resource.id,
    name,
    description: str(attributes.description),
    totalPeople,
    refreshedAt: str(attributes.refreshed_at),
    autoRefresh: attributes.auto_refresh === true,
    invalid: attributes.invalid === true,
    starred: attributes.starred === true,
  };
}

export interface FetchListsOptions {
  client: PcoClient;
  /** Free text matched against the list name, server-side. */
  search?: string;
  limit?: number;
}

/**
 * Every list the token can see, newest-relevant first.
 *
 * Ordered by name rather than by size or recency: a leader is looking for a
 * list they already know the name of, and a stable order means the same list is
 * in the same place every time they open the picker.
 */
export async function fetchLists(options: FetchListsOptions): Promise<PcoListSummary[]> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT));
  const search = options.search?.trim() ?? '';

  const summaries: PcoListSummary[] = [];
  const seen = new Set<string>();

  for await (const page of options.client.paginate<PcoList>('/lists', {
    order: 'name',
    // Planning Center filters by name upstream, so a church with hundreds of
    // lists sends one small page over the wire instead of all of them.
    ...(search ? { where: { name: search } } : {}),
  })) {
    for (const resource of page.data) {
      const summary = toSummary(resource);
      if (!summary || seen.has(summary.id)) continue;
      seen.add(summary.id);
      summaries.push(summary);
      if (summaries.length >= limit) return summaries;
    }
  }

  return summaries;
}

/**
 * One list by id, or null when it does not exist.
 *
 * This is what lets Settings name the list a previous deploy configured — the
 * saved id on its own would otherwise render as a bare number, which is exactly
 * the problem the picker exists to remove.
 *
 * A list that is gone raises `PcoApiError` like any other 404, because from
 * here "deleted" and "this token may not read Lists" are the same response.
 * Deciding which of those matters is the caller's job; the status handler
 * treats both as a name it could not read rather than as a broken connection.
 */
export async function fetchList(client: PcoClient, listId: string): Promise<PcoListSummary | null> {
  const body = await client.get<PcoList>(`/lists/${encodeURIComponent(listId)}`);
  const resource = Array.isArray(body.data) ? body.data[0] : body.data;
  return resource ? toSummary(resource) : null;
}
