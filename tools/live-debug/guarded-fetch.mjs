/**
 * A fetch that refuses to touch anybody real.
 *
 * The live-debug harness drives Tally's production flow code against a real
 * Planning Center organization. Reads are unrestricted — that is what a mirror
 * is for — but every mutation is checked here, before it leaves the process,
 * against two rules that must hold no matter what any flow above decides:
 *
 *   1. A person may only be *created* with a first name carrying the
 *      `DEBUG_TEST` prefix, and a household only with the marker in its name.
 *   2. A record may only be *updated or deleted* if this harness created it —
 *      membership in the ledger, not the shape of the request, is the test.
 *
 * The ledger is a file of ids appended on every successful create, so it
 * survives the process and a cleanup run can find everything a crashed run
 * left behind. Everything else non-GET is refused by default: a flow reaching
 * for an endpoint this guard has never heard of is a reason to stop, not a
 * gap to slip through.
 *
 * Every request — allowed or refused — is appended to an ndjson trace with
 * its method, path, status, duration and a body digest, which is the
 * instrumentation the debugging rides on.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const MARKER = 'DEBUG_TEST';

export class GuardRefused extends Error {}

export function loadLedger(path) {
  const ids = new Set();
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const id = line.trim().split(' ')[0];
      if (id) ids.add(id);
    }
  }
  return ids;
}

export function createGuardedFetch({ mode, ledgerPath, tracePath, label }) {
  const ledger = loadLedger(ledgerPath);

  const remember = (id, note) => {
    if (!id || ledger.has(String(id))) return;
    ledger.add(String(id));
    appendFileSync(ledgerPath, `${id} ${note}\n`);
  };

  const trace = (entry) => {
    appendFileSync(tracePath, JSON.stringify({ t: new Date().toISOString(), via: label, ...entry }) + '\n');
  };

  const refuse = (why, method, path) => {
    trace({ method, path, refused: why });
    throw new GuardRefused(`guard refused ${method} ${path}: ${why}`);
  };

  const check = (method, path, body) => {
    if (method === 'GET' || method === 'HEAD') return;
    if (mode === 'ro') refuse('this client is read-only', method, path);

    const segs = path.split('?')[0].split('/').filter(Boolean); // after origin
    // Expect ['people','v2', ...]; normalise away the API prefix.
    const i = segs.indexOf('v2');
    const tail = i >= 0 ? segs.slice(i + 1) : segs;
    const data = body?.data ?? {};
    const attrs = data.attributes ?? {};

    if (method === 'POST' && tail.length === 1 && tail[0] === 'people') {
      if (!String(attrs.first_name ?? '').startsWith(MARKER)) {
        refuse(`person create without ${MARKER} first_name`, method, path);
      }
      return;
    }
    if (method === 'POST' && tail.length === 1 && tail[0] === 'households') {
      if (!String(attrs.name ?? '').includes(MARKER)) {
        refuse(`household create without ${MARKER} in its name`, method, path);
      }
      const members = (data.relationships?.people?.data ?? []).map((m) => String(m?.id));
      for (const id of members) {
        if (!ledger.has(id)) refuse(`household names person ${id} the harness did not create`, method, path);
      }
      return;
    }
    if (method === 'POST' && tail.length === 3 && tail[0] === 'households'
        && tail[2] === 'household_memberships') {
      if (!ledger.has(tail[1])) refuse(`membership on household ${tail[1]} not ours`, method, path);
      if (!ledger.has(String(attrs.person_id ?? ''))) {
        refuse(`membership for person ${attrs.person_id} not ours`, method, path);
      }
      return;
    }
    if (method === 'POST' && tail.length === 3 && tail[0] === 'people'
        && ['emails', 'phone_numbers', 'addresses'].includes(tail[2])) {
      if (!ledger.has(tail[1])) refuse(`contact on person ${tail[1]} not ours`, method, path);
      return;
    }
    if ((method === 'PATCH' || method === 'DELETE')
        && ['people', 'households'].includes(tail[0]) && tail.length >= 2) {
      if (!ledger.has(tail[1])) refuse(`${tail[0]}/${tail[1]} is not a record the harness created`, method, path);
      return;
    }
    refuse('no rule allows this mutation', method, path);
  };

  return async function guardedFetch(url, init = {}) {
    const method = (init.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname + (new URL(url).search || '');
    let body = null;
    if (typeof init.body === 'string' && init.body) {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    check(method, path, body);

    const started = Date.now();
    const response = await fetch(url, init);
    const entry = { method, path, status: response.status, ms: Date.now() - started };

    if (method !== 'GET' && method !== 'HEAD' && response.ok) {
      // Remember what we made, from the response's own statement of it.
      const copy = response.clone();
      try {
        const doc = await copy.json();
        const made = doc?.data;
        if (made && made.id && ['Person', 'Household'].includes(made.type)) {
          remember(made.id, `${made.type} via ${method} ${path}`);
          entry.created = `${made.type}/${made.id}`;
        }
      } catch { /* a 204 has no body to read */ }
    }
    trace(entry);
    return response;
  };
}
