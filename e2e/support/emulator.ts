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
