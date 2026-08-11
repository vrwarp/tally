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

/**
 * Wipes every document. The emulator exposes this; production has no equivalent.
 *
 * The retry on 409 is not defensiveness for its own sake. The emulator refuses
 * to clear while it is still winding down work from before — a listener stream
 * belonging to a browser that was killed rather than closed, most often — and
 * it lets go a second or two later. That is exactly the state a timed-out test
 * leaves behind, and Playwright's answer to a timed-out test is to discard the
 * worker and start a new one, which runs this again from the `seededWorld`
 * fixture. Without the wait, one slow test failed the four tests after it, one
 * of them in a different file, each in 0ms and none of them for its own
 * reasons.
 */
export async function clearFirestore(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let attempts = 0;

  for (;;) {
    const response = await fetch(
      `http://127.0.0.1:${E2E.firestore}/emulator/v1/projects/${E2E.projectId}/databases/(default)/documents`,
      { method: 'DELETE', headers: ADMIN },
    );
    if (response.ok) return;
    attempts += 1;

    // Anything other than "busy" is a real answer, and repeating it will not
    // change it.
    if (response.status !== 409 || Date.now() >= deadline) {
      throw new Error(
        `Could not clear Firestore: HTTP ${response.status}` +
          (attempts > 1 ? `, still after ${attempts} attempts over 30s.` : '.'),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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
 *
 * 409 is retried for the same reason `clearFirestore` retries it: the emulator
 * answers "busy" while it is still winding down the Listen streams a closed
 * browser left behind, and this is usually called from a cleanup step after a
 * spec that opened several contexts. A teardown that throws there fails a test
 * whose assertions all passed.
 */
export async function deleteDocument(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;

  for (;;) {
    const response = await fetch(`${FIRESTORE_ROOT}/${path}`, { method: 'DELETE', headers: ADMIN });
    if (response.ok || response.status === 404) return;
    if (response.status !== 409 || Date.now() >= deadline) {
      throw new Error(`Deleting ${path} failed: HTTP ${response.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
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
  /*
   * Maps, because the documents worth arranging by hand are the ones with shape
   * — a `kioskRegistrations` record holds a guardian object, a list of children
   * objects and a duplicate-hint map keyed by child index, and a spec that
   * cannot write those can only arrange the easy half of the triage screen.
   */
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  }
  throw new Error(`No encoding for ${typeof value} in a test-written document.`);
}

function encodeFields(data: Record<string, unknown>): Record<string, RestValue> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
}

/** What `writeDocument` will take: JSON, plus the Dates that become timestamps. */
export type WritableValue =
  | string
  | number
  | boolean
  | null
  | Date
  | readonly WritableValue[]
  | { readonly [key: string]: WritableValue };

/**
 * Writes one document whole, through the admin channel — for the settings a
 * spec arranges rather than clicks together, like pointing the Attendees
 * configuration at the simulator. Replaces the document; there is no merge.
 */
export async function writeDocument(
  path: string,
  data: Record<string, WritableValue>,
): Promise<void> {
  const fields = encodeFields(data);
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
/* ---- the gate, and the states that only exist behind it ------------------ */

/**
 * Arms the simulator to hold the next matching request open.
 *
 * This is how the suite sees a state that exists only while a call to Planning
 * Center is in flight. Holding a socket open is what a slow API does, so nothing
 * in the Cloud Function, the trigger or the browser has to know it is being
 * tested — and the hold is applied before the handler runs, so the world on
 * screen while it waits is genuinely the world before the write.
 */
export async function holdSimulator(match: { method?: string; path?: string } = {}): Promise<void> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/hold`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(match),
  });
  if (!response.ok) throw new Error(`Could not arm the simulator hold: HTTP ${response.status}.`);
}

/** What the gate has caught. Waiting on this is how a spec avoids sleeping. */
export async function heldRequests(): Promise<Array<{ method: string; path: string }>> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/held`);
  if (!response.ok) throw new Error(`Could not read held requests: HTTP ${response.status}.`);
  return ((await response.json()) as { held: Array<{ method: string; path: string }> }).held;
}

/** Blocks until the drain has actually reached Planning Center. */
export async function waitForHeldRequest(label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await heldRequests()).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Planning Center was never asked for ${label} within ${timeoutMs}ms.`);
}

export async function releaseSimulator(): Promise<void> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/release`, { method: 'POST' });
  if (!response.ok) throw new Error(`Could not release the simulator: HTTP ${response.status}.`);
}

/**
 * Deletes a person upstream, or merges them into another.
 *
 * With no survivor it is the deletion an office admin makes; with one, the
 * tombstone names them and Planning Center answers `410` with `meta.merged_into`
 * — which is what `readThroughMerges` follows, and therefore the only way to
 * produce the state where an edit lands on somebody other than the person it
 * named.
 */
export async function burySimulatorPerson(id: string, mergedInto?: string): Promise<void> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/bury`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, ...(mergedInto ? { mergedInto } : {}) }),
  });
  if (!response.ok) throw new Error(`Could not bury ${id}: HTTP ${response.status}.`);
}

/**
 * Rate-limits the next `count` requests, exactly as a busy lobby kiosk does.
 *
 * `retryAfterSeconds` is what the drain believes over its own schedule, so this
 * is also the control over how long `waiting` lasts.
 */
export async function rateLimitSimulator(count = 1, retryAfterSeconds = 1): Promise<void> {
  const response = await fetch(`${E2E.simulatorUrl}/_sim/rate-limit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ count, retryAfterSeconds }),
  });
  if (!response.ok) throw new Error(`Could not arm a rate limit: HTTP ${response.status}.`);
}

/* ---- calling a callable as somebody -------------------------------------- */

/**
 * An ID token the Functions emulator will accept.
 *
 * The emulator decodes the bearer token and skips signature verification, which
 * is the same affordance the sign-in fallback already leans on — see
 * `e2e/support/auth.ts`. It is only ever reachable at `127.0.0.1:5001`, and the
 * production verifier does not have this behaviour, so nothing about it can
 * escape the suite.
 *
 * Worth the twenty lines rather than reaching past the guard: it means a spec
 * that drains the queue is going through `requireAdmin` → `readCaller` →
 * `users/{uid}` for real, and would notice the day that guard stopped working.
 */
function emulatorIdToken(uid: string, email: string): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = segment({ alg: 'none', typ: 'JWT' });
  const payload = segment({
    iss: `https://securetoken.google.com/${E2E.projectId}`,
    aud: E2E.projectId,
    auth_time: now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    email,
    email_verified: true,
    firebase: { identities: { email: [email] }, sign_in_provider: 'google.com' },
  });
  return `${header}.${payload}.`;
}

/** The uid the seeded ministry gave a signed-in member, by their address. */
export async function uidOf(email: string): Promise<string> {
  const users = await readCollection('users');
  const match = users.find((row) => row.data.email === email);
  if (!match) {
    throw new Error(
      `No users document for ${email}. Sign that member in before asking for their uid.`,
    );
  }
  return match.id;
}

export async function callFunction(
  name: string,
  data: unknown,
  as: { uid: string; email: string },
): Promise<unknown> {
  const response = await fetch(
    `http://127.0.0.1:${E2E.functions}/${E2E.projectId}/us-central1/${name}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${emulatorIdToken(as.uid, as.email)}`,
      },
      body: JSON.stringify({ data }),
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed: HTTP ${response.status} ${text}`);
  return (JSON.parse(text) as { result?: unknown }).result;
}

/**
 * Changes somebody upstream, the way the church office does.
 *
 * A real `PATCH /people/{id}` with the simulator's credentials rather than a
 * control-plane shortcut, because what a spec needs to arrange here is not a
 * fixture — it is another human editing the same record in Planning Center
 * while a leader's correction is queued. Going through the API is the only
 * version of that which the drain cannot tell apart from the real thing.
 */
export async function patchSimulatorPerson(
  personId: string,
  attributes: Record<string, unknown>,
): Promise<void> {
  const auth = Buffer.from('sim-app-id:sim-secret').toString('base64');
  const response = await fetch(`${E2E.simulatorUrl}/people/v2/people/${personId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ data: { type: 'Person', id: personId, attributes } }),
  });
  if (!response.ok) {
    throw new Error(`Could not edit ${personId} upstream: HTTP ${response.status}.`);
  }
}

/* ---- the edit queue ------------------------------------------------------- */

/**
 * Takes a student's lease before the drain can.
 *
 * This is how a spec sees `queued` — the state between a leader pressing Save
 * and a worker claiming the job, which against these emulators is a few hundred
 * milliseconds. Rather than a switch that stops the drain, the spec holds the
 * lease the drain itself competes for, so what is being exercised is the real
 * mutual exclusion: the same refusal a second worker would meet, and the same
 * one that keeps two edits of one child in the order they were queued.
 */
export async function takeEditLease(studentId: string, forMs = 120_000): Promise<void> {
  await writeDocument(`upstreamEditLeases/${studentId}`, {
    editId: 'held-by-the-suite',
    untilMs: Date.now() + forMs,
  });
}

export async function releaseEditLease(studentId: string): Promise<void> {
  await deleteDocument(`upstreamEditLeases/${studentId}`);
}

/**
 * Drains the queue now, as an admin, rather than waiting out the schedule.
 *
 * Scheduled functions do not run on their own in the emulator, so without this
 * every retry in the design would be unreachable from a test — a `waiting` job
 * would sit at its backoff for ever. The callable is the schedule's twin, on
 * the same pattern as `pushPendingVisitors` beside `pushPendingStudents`, so
 * this is the product's own path and not a way around it.
 */
export async function drainQueue(): Promise<{ ran: number; swept: number }> {
  const { TEAM } = await import('./auth');
  const uid = await uidOf(TEAM.admin);
  return (await callFunction('drainUpstreamEditsNow', {}, {
    uid,
    email: TEAM.admin,
  })) as { ran: number; swept: number };
}

/**
 * Asks for one student's jobs to be drained, the way the app itself does.
 *
 * Narrower than `drainQueue` and usually what a test actually means. The wide
 * sweep walks the whole collection, takes up to five students and up to five
 * jobs each under one 300-second ceiling — so a spec that loops on it while a
 * fault is armed can spend minutes of that ceiling on students it is not
 * waiting for, and eventually kill the call outright. This is the callable the
 * browser fires after a save, scoped to the one child in question.
 */
export async function drainStudentNow(studentId: string): Promise<{ states: string[] }> {
  const { TEAM } = await import('./auth');
  const uid = await uidOf(TEAM.admin);
  return (await callFunction('drainStudentEdits', { studentId }, {
    uid,
    email: TEAM.admin,
  })) as { states: string[] };
}

/** Every queued edit, newest first, straight out of Firestore. */
export async function readUpstreamEdits(): Promise<FirestoreDoc[]> {
  return readCollection('upstreamEdits');
}

/**
 * Waits for one student's edit to reach a state, and answers with it.
 *
 * Polls Firestore rather than the screen on purpose: a spec that only ever
 * asserted the rendering could not tell a drain that worked from one whose
 * result the browser happened to be drawing from a stale subscription.
 */
export async function waitForEditState(
  studentId: string,
  states: readonly string[],
  timeoutMs = 30_000,
): Promise<FirestoreDoc> {
  const deadline = Date.now() + timeoutMs;
  let seen = '';
  while (Date.now() < deadline) {
    const edits = await readUpstreamEdits();
    const mine = edits.filter((row) => row.data.studentId === studentId);
    const match = mine.find((row) => states.includes(String(row.data.state)));
    if (match) return match;
    seen = mine.map((row) => String(row.data.state)).join(', ') || 'none';
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Edit for ${studentId} never reached ${states.join(' or ')} within ${timeoutMs}ms (saw: ${seen}).`,
  );
}

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
/**
 * Merges one simulated attendee into another, the way a coworker would in
 * Attendees itself.
 *
 * On the control plane rather than the API, because this is not something
 * Tally can ask for — it is a fact about the far end that a test arranges,
 * like `down`. Afterwards the loser's id answers `410` with the survivor,
 * which is the contract attendees32 states.
 */
export async function mergeA32Attendee(loser: string, survivor: string): Promise<void> {
  const response = await fetch(`${E2E.a32SimulatorUrl}/_sim/merge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loser, survivor }),
  });
  if (!response.ok) {
    throw new Error(`Could not merge ${loser} into ${survivor}: HTTP ${response.status}.`);
  }
}

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
