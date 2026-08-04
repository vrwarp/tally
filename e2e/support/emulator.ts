/**
 * Talking to the emulators and the Planning Center simulator over their REST
 * surfaces.
 *
 * Tests use these to arrange state and to check what really landed in
 * Firestore, rather than trusting the screen — a check-in that renders but was
 * never written is precisely the bug worth catching.
 */
import { E2E } from '../../playwright.config';

const FIRESTORE_ROOT =
  `http://127.0.0.1:${E2E.firestore}/v1/projects/${E2E.projectId}/databases/(default)/documents`;

/**
 * The emulator's admin token. Tests read collections the security rules
 * deliberately deny to clients — `users`, for one, since a client that could
 * enumerate it could enumerate the team. Asserting through an admin channel
 * keeps the rules strict *and* the assertions honest.
 */
const ADMIN = { Authorization: 'Bearer owner' } as const;

export async function waitForHttp(url: string, label: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      // Any answer proves the port is bound and serving; some emulator roots
      // legitimately reply 404.
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${label} never became ready at ${url} (last error: ${lastError}).`);
}

/** Wipes every document. The emulator exposes this; production has no equivalent. */
export async function clearFirestore(): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${E2E.firestore}/emulator/v1/projects/${E2E.projectId}/databases/(default)/documents`,
    { method: 'DELETE', headers: ADMIN },
  );
  if (!response.ok) {
    throw new Error(`Could not clear Firestore: HTTP ${response.status}.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading documents back                                                      */
/* -------------------------------------------------------------------------- */

interface RestValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: RestValue[] };
  mapValue?: { fields?: Record<string, RestValue> };
}

function decode(value: RestValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(decode);
  if (value.mapValue !== undefined) return decodeFields(value.mapValue.fields ?? {});
  return null;
}

function decodeFields(fields: Record<string, RestValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

export interface FirestoreDoc {
  id: string;
  data: Record<string, unknown>;
}

/** Reads a whole collection through the emulator's REST API. */
export async function readCollection(path: string): Promise<FirestoreDoc[]> {
  const docs: FirestoreDoc[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${FIRESTORE_ROOT}/${path}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, { headers: ADMIN });
    if (response.status === 404) return docs;
    if (!response.ok) throw new Error(`Reading ${path} failed: HTTP ${response.status}.`);

    const body = (await response.json()) as {
      documents?: Array<{ name: string; fields?: Record<string, RestValue> }>;
      nextPageToken?: string;
    };

    for (const document of body.documents ?? []) {
      docs.push({
        id: document.name.slice(document.name.lastIndexOf('/') + 1),
        data: decodeFields(document.fields ?? {}),
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return docs;
}

/**
 * Deletes one document, through the same admin channel.
 *
 * This exists so a test that changes a *setting* can put it back. The suite
 * runs one worker against one dataset, so a spec that leaves the Planning
 * Center configuration pointing at a different list does not fail — it makes
 * some later spec fail instead, which is the worst kind of flake to chase.
 */
export async function deleteDocument(path: string): Promise<void> {
  const response = await fetch(`${FIRESTORE_ROOT}/${path}`, { method: 'DELETE', headers: ADMIN });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting ${path} failed: HTTP ${response.status}.`);
  }
}

function encode(value: unknown): RestValue {
  if (value === null) return { nullValue: null };
  // A spec that arranges an *event* needs the four timestamps, and the REST
  // shape wants them as RFC 3339 rather than epoch millis.
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  throw new Error(`No encoding for ${typeof value} in a test-written document.`);
}

/**
 * Writes one document whole, through the admin channel — for the settings a
 * spec arranges rather than clicks together, like pointing the Attendees
 * configuration at the simulator. Replaces the document; there is no merge.
 */
export async function writeDocument(
  path: string,
  data: Record<string, string | number | boolean | null | Date>,
): Promise<void> {
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
  const response = await fetch(`${FIRESTORE_ROOT}/${path}`, {
    method: 'PATCH',
    headers: { ...ADMIN, 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    throw new Error(`Writing ${path} failed: HTTP ${response.status} ${await response.text()}.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Planning Center simulator control plane                                     */
/* -------------------------------------------------------------------------- */

export async function resetSimulator(): Promise<void> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/reset`, { method: 'POST' });
  if (!response.ok) throw new Error(`Could not reset the simulator: HTTP ${response.status}.`);
}

/**
 * Disarms fault injection, leaving the seeded ministry alone.
 *
 * Deliberately not `resetSimulator`: the roster the app renders *is* the
 * simulator now, so a reset between tests would swap the seeded church for the
 * built-in fixtures and every later assertion would be about the wrong people.
 */
export async function clearSimulatorFaults(): Promise<void> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/clear-faults`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Could not clear simulator faults: HTTP ${response.status}.`);
  }
}

/** Arms the simulator to answer the next `count` requests with an error. */
export async function failSimulator(status: number, message: string, count = 99): Promise<void> {
  await fetch(`${E2E.simulatorUrl}/_sim/fail`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status, message, count }),
  });
}

/**
 * Adds one student to Planning Center, the way the church office would.
 *
 * With no mirror to wait for, "somebody was added upstream" is a thing a test
 * can just *do*, and then check that the app noticed.
 */
export async function createSimulatorStudent(input: {
  firstName: string;
  lastName: string;
  grade: number;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  allergies?: string;
  /** The same person's Attendees UUID, recorded as the `attendees_uuid` field. */
  attendeesUuid?: string;
}): Promise<void> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ students: [input] }),
  });
  if (!response.ok) {
    throw new Error(`Could not add a student to the simulator: HTTP ${response.status}.`);
  }
}

/** Every request the simulator has answered, for asserting on what was asked. */
export async function simulatorRequests(): Promise<Array<{ method: string; path: string }>> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/requests`);
  const body = (await response.json()) as { requests: Array<{ method: string; path: string }> };
  return body.requests;
}

export async function simulatorPeople(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/people`);
  const body = (await response.json()) as { people: Array<Record<string, unknown>> };
  return body.people;
}

/**
 * Removes everything the Attendees specs put into Firestore.
 *
 * The suite is seeded once and runs in file order, so a spec that imported a
 * whole meet's history — a chain of gatherings, attendance under each, and a
 * membership per student — would quietly reshape every number the later
 * dashboard and check-in specs assert on. The Attendees specs run first
 * alphabetically and sweep themselves out on the way.
 */
export async function removeA32Residue(): Promise<void> {
  for (const student of await readCollection('students')) {
    if (student.id.startsWith('a32_') || student.data.upstreamBackend === 'a32') {
      await deleteDocument(`students/${student.id}`);
    }
  }
  for (const event of await readCollection('events')) {
    if (!event.id.startsWith('a32-meet-')) continue;
    for (const record of await readCollection(`events/${event.id}/attendance`)) {
      await deleteDocument(`events/${event.id}/attendance/${record.id}`);
    }
    for (const record of await readCollection(`events/${event.id}/rsvps`)) {
      await deleteDocument(`events/${event.id}/rsvps/${record.id}`);
    }
    await deleteDocument(`events/${event.id}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Attendees simulator control plane                                           */
/* -------------------------------------------------------------------------- */

/** Puts the Attendees simulator back to its seeded organisation. */
export async function resetA32Simulator(): Promise<void> {
  const response = await fetch(`${E2E.a32SimulatorUrl}/_sim/reset`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Could not reset the Attendees simulator: HTTP ${response.status}.`);
  }
}

/**
 * An Attendees person's UUID, looked up by name through the simulator's own
 * API — the ids are minted at boot, so a spec that links a Planning Center
 * person to one has to ask.
 */
export async function a32PersonIdOf(name: string): Promise<string> {
  const url = `${E2E.a32SimulatorUrl}/persons/api/datagrid_data_attendee/?searchValue=${encodeURIComponent(name)}&take=5&skip=0`;
  const response = await fetch(url, { headers: { Authorization: 'Token a32-sim-token' } });
  if (!response.ok) {
    throw new Error(`Could not search the Attendees simulator: HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const first = body.data[0];
  if (!first) throw new Error(`The Attendees simulator holds nobody called "${name}".`);
  return first.id;
}

/** Takes the whole Attendees server down (503s) — or brings it back. */
export async function setA32Down(down: boolean): Promise<void> {
  const response = await fetch(`${E2E.a32SimulatorUrl}/_sim/down`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ down }),
  });
  if (!response.ok) {
    throw new Error(`Could not set the Attendees simulator down=${down}: HTTP ${response.status}.`);
  }
}
