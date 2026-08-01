/**
 * Wiring for the live-debug flows: Tally's real compiled flow code, a real
 * pcomirror, a real Planning Center — and a guard between them and the world.
 *
 * Three clients, by trust level:
 *   - `mirror`   read/write through pcomirror, guarded — what Tally itself uses.
 *   - `pco`      read-only against api.planningcenteronline.com, guarded so a
 *                bug in the harness cannot write around the mirror. This is the
 *                truth the other two are checked against.
 *
 * The Firestore half is the same in-memory stand-in the simulator tests use,
 * inlined here because the compiled build ships without test helpers. State
 * (created ids, the student docs) persists to disk so the flows can run as
 * separate commands and a crashed run can still be cleaned up.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPcoClient } from '../../functions/lib/pco/client.js';
import { createTtlCache } from '../../functions/lib/pco/cache.js';
import { createGuardedFetch } from './guarded-fetch.mjs';

const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};

export const DEMO_DIR = need('DEMO_DIR');
export const RUN_ID = process.env.RUN_ID || 'r1';
export const MARKER = 'DEBUG_TEST';

const ledgerPath = `${DEMO_DIR}/ledger.txt`;
const tracePath = `${DEMO_DIR}/trace.ndjson`;
export { ledgerPath, tracePath };

export function makeClients() {
  const mirror = createPcoClient({
    appId: 'tally-demo',
    secret: need('MIRROR_KEY'),
    baseUrl: need('MIRROR_BASE'),
    fetchImpl: createGuardedFetch({ mode: 'rw', ledgerPath, tracePath, label: 'mirror' }),
  });
  const pco = createPcoClient({
    appId: need('PCO_APP_ID'),
    secret: need('PCO_SECRET'),
    baseUrl: 'https://api.planningcenteronline.com/people/v2',
    fetchImpl: createGuardedFetch({ mode: 'ro', ledgerPath, tracePath, label: 'pco' }),
  });
  return { mirror, pco };
}

export function makeConfig() {
  return {
    appId: 'tally-demo',
    secret: need('MIRROR_KEY'),
    baseUrl: need('MIRROR_BASE'),
    baseUrlOverridden: true,
    minGrade: 6,
    maxGrade: 12,
    writeBack: 'full',
    cacheTtlSeconds: 0, // every read asks; the mirror is the cache under test
    managedInApp: false,
    configError: null,
  };
}

export const cache = createTtlCache({ ttlMs: 0 });

/** The narrow FirestoreLike the flows use, persisted so commands can chain. */
export function makeDb() {
  const file = `${DEMO_DIR}/firestore.json`;
  const data = new Map(existsSync(file)
    ? Object.entries(JSON.parse(readFileSync(file, 'utf8'))) : []);
  const save = () => writeFileSync(file, JSON.stringify(Object.fromEntries(data), null, 1));
  const snapshot = (path) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    exists: data.has(path),
    data: () => (data.has(path) ? { ...data.get(path) } : undefined),
  });
  const write = (path, value, merge) => {
    data.set(path, merge ? { ...(data.get(path) ?? {}), ...value } : { ...value });
    save();
  };
  const ref = (path) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    get: async () => snapshot(path),
    set: async (value, options) => write(path, value, options?.merge === true),
    update: async (value) => write(path, value, true),
    delete: async () => { data.delete(path); save(); },
  });
  return {
    data,
    doc: (path) => ref(path),
    collection: (path) => ({
      doc: (id) => ref(`${path}/${id}`),
    }),
    batch: () => {
      const ops = [];
      return {
        set: (r, value, options) => ops.push(() => write(r.path, value, options?.merge === true)),
        update: (r, value) => ops.push(() => write(r.path, value, true)),
        delete: (r) => ops.push(() => { data.delete(r.path); save(); }),
        commit: async () => { for (const op of ops) op(); },
      };
    },
  };
}

/** Step state shared between commands (created ids, names). */
const statePath = `${DEMO_DIR}/state.json`;
export function loadState() {
  return existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
}
export function saveState(patch) {
  const next = { ...loadState(), ...patch };
  writeFileSync(statePath, JSON.stringify(next, null, 1));
  return next;
}

/** Timestamps Firestore-shaped enough for the flows that stamp them. */
export const logger = {
  info: (msg, extra) => console.log(`   [flow] ${msg}`, extra ?? ''),
  warn: (msg, extra) => console.log(`   [flow:warn] ${msg}`, extra ?? ''),
  error: (msg, extra) => console.log(`   [flow:error] ${msg}`, extra ?? ''),
};

/* ---- checks ---------------------------------------------------------------- */

let failures = 0;
export function check(label, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(` ${mark}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
export function finish() {
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

export async function personBothSides(clients, id, params = {}) {
  const [m, p] = await Promise.all([
    clients.mirror.get(`/people/${id}`, params),
    clients.pco.get(`/people/${id}`, params),
  ]);
  return { mirror: m.data, pco: p.data, mirrorDoc: m, pcoDoc: p };
}

export function sameAttrs(label, a, b, keys) {
  for (const k of keys) {
    const av = a?.attributes?.[k] ?? null;
    const bv = b?.attributes?.[k] ?? null;
    check(`${label}.${k}`, JSON.stringify(av) === JSON.stringify(bv), `${JSON.stringify(av)} vs ${JSON.stringify(bv)}`);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
