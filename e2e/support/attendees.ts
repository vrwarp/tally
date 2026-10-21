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

/** A new record of the same person, enrolled in a meet when `meetId` is given. */
export async function a32Twin(
  original: Record<string, unknown>,
  phone: string,
  meetId?: number,
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
    { 'X-Target-Attendee-Id': 'new', ...(meetId ? { 'X-Join-Meet': String(meetId) } : {}) },
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
