/**
 * The Attendees server's own API, for what a spec has to check or prepare on
 * the far side: a record as the server holds it, a twin made for a merge, a
 * name put back. Works against the simulator and the real server alike; only
 * the live spec needs it today.
 */
import { E2E } from '../../playwright.config';

const API = '/persons/api/datagrid_data_attendee/';

export async function a32Fetch(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${E2E.a32.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Token ${E2E.a32.token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** One attendee as the server answers for it: the status and the record. */
export async function a32Record(id: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await a32Fetch('GET', `${API}${id}/`);
  return { status: response.status, body: response.ok ? ((await response.json()) as Record<string, unknown>) : null };
}

/** A new record of the same person. */
export async function a32Twin(
  original: Record<string, unknown>,
  phone: string,
): Promise<Record<string, unknown>> {
  const response = await a32Fetch(
    'POST',
    API,
    {
      first_name: original.first_name,
      last_name: original.last_name,
      first_name2: original.first_name2,
      last_name2: original.last_name2,
      gender: original.gender,
      division: original.division,
      actual_birthday: '2011-02-03',
      infos: { names: {}, fixed: {}, contacts: { phone1: phone } },
    },
    { 'X-Target-Attendee-Id': 'new' },
  );
  if (!response.ok) throw new Error(`Attendees would not create the twin: HTTP ${response.status} ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function a32Patch(id: string, fields: Record<string, unknown>): Promise<void> {
  const response = await a32Fetch('PATCH', `${API}${id}/`, fields, { 'X-Target-Attendee-Id': id });
  if (!response.ok) throw new Error(`Attendees would not edit ${id}: HTTP ${response.status} ${await response.text()}`);
}

/** Undoes a merge the server made, if it still stands; then removes the record. */
export async function a32Remove(id: string): Promise<void> {
  await a32Fetch('POST', `${API}${id}/unmerge/`);
  await a32Fetch('DELETE', `${API}${id}/`, undefined, { 'X-Target-Attendee-Id': id });
}

/** Removes every record of `name` carrying `phone`: twins an interrupted run left behind. */
export async function a32RemoveTwins(name: string, phone: string): Promise<void> {
  const response = await a32Fetch('GET', `${API}?searchValue=${encodeURIComponent(name)}&take=20&skip=0`);
  if (!response.ok) throw new Error(`Attendees would not search for ${name}: HTTP ${response.status}`);
  const body = (await response.json()) as { data: Array<{ id: string; infos?: { contacts?: { phone1?: string } } }> };
  for (const row of body.data) {
    if (row.infos?.contacts?.phone1 === phone) await a32Remove(row.id);
  }
}

/** Everyone the server finds for `query`, as the roster sweep sees them. */
export async function a32Search(query: string): Promise<Array<Record<string, unknown>>> {
  const response = await a32Fetch('GET', `${API}?searchValue=${encodeURIComponent(query)}&take=50&skip=0`);
  if (!response.ok) throw new Error(`Attendees would not search for ${query}: HTTP ${response.status}`);
  return ((await response.json()) as { data: Array<Record<string, unknown>> }).data;
}

/** A new record with no family. */
export async function a32Person(
  firstName: string,
  lastName: string,
  phone: string,
): Promise<Record<string, unknown>> {
  const response = await a32Fetch(
    'POST',
    API,
    {
      first_name: firstName,
      last_name: lastName,
      gender: 'UNSPECIFIED',
      division: Number(E2E.a32.divisionId),
      actual_birthday: '2011-02-03',
      infos: { names: {}, fixed: {}, contacts: { phone1: phone } },
    },
    { 'X-Target-Attendee-Id': 'new' },
  );
  if (!response.ok) throw new Error(`Attendees would not create ${firstName}: HTTP ${response.status} ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>;
}

/** The server's relation ids by title: `child`, `parent` and the rest. */
export async function a32Relations(): Promise<Record<string, number>> {
  const response = await a32Fetch('GET', '/persons/api/all_relations/?take=200');
  if (!response.ok) throw new Error(`Attendees would not list relations: HTTP ${response.status}`);
  const { data } = (await response.json()) as { data: Array<{ id: number; title: string }> };
  return Object.fromEntries(data.map((row) => [row.title, row.id]));
}

/** Every family a record is in (the folks of the family category), with this person's role in each. */
export function a32FamiliesOf(
  record: Record<string, unknown>,
): Array<{ id: string; attendees: string[]; role: number }> {
  const edges = (record.folkattendee_set ?? []) as Array<{
    role: number;
    is_removed?: boolean;
    folk: { id: string; category: number; attendees: string[] };
  }>;
  return edges
    .filter((row) => row.folk.category === 0 && row.is_removed !== true)
    .map((row) => ({ id: row.folk.id, attendees: row.folk.attendees, role: row.role }));
}

/** A record's family, or null when it is in none. Only a full record (a32Record) carries this. */
export function a32FamilyOf(
  record: Record<string, unknown>,
): { id: string; attendees: string[]; role: number } | null {
  return a32FamiliesOf(record)[0] ?? null;
}

/** Removes a family folk the way the attendee page does, on behalf of one of its members. */
export async function a32RemoveFamily(folkId: string, memberId: string): Promise<void> {
  await a32Fetch('DELETE', `/persons/api/attendee_families/${folkId}/`, undefined, { 'X-Target-Attendee-Id': memberId });
}

/** Takes a record and its family off the server. */
export async function a32RemoveWithFamily(id: string): Promise<void> {
  const record = await a32Record(id);
  for (const family of record.body ? a32FamiliesOf(record.body) : []) await a32RemoveFamily(family.id, id);
  await a32Remove(id);
}
