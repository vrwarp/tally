/**
 * The debug flows, one command each, chained through state on disk:
 *
 *   node flows.mjs student-create    Tally quick-add visitor -> pushStudent
 *   node flows.mjs student-update    updateStudentProfile: grade, allergies, birthday
 *   node flows.mjs parent-create     addParent: new person + new household
 *   node flows.mjs parent-update     setParentContact: email onto the parent
 *   node flows.mjs duplicate-check   addParent again -> 'existing-people'
 *   node flows.mjs search            searchPeople finds the student via the mirror
 *   node flows.mjs mirror-consistency  three-way diff + edge convergence wait
 *   node flows.mjs cleanup           delete everything the ledger names
 *
 * Every step verifies three layers: what Tally's flow reported, what the
 * mirror serves, and what Planning Center itself says (read-only client).
 */
import {
  DEMO_DIR, MARKER, RUN_ID, cache, check, finish, ledgerPath, loadState, logger,
  makeClients, makeConfig, makeDb, personBothSides, sameAttrs, saveState, sleep,
} from './harness.mjs';
import { loadLedger, createGuardedFetch } from './guarded-fetch.mjs';
import { pushStudent } from '../../functions/lib/pco/pushStudents.js';
import { updateStudentProfile } from '../../functions/lib/pco/profile.js';
import { addParent } from '../../functions/lib/pco/household.js';
import { setParentContact } from '../../functions/lib/pco/parentContact.js';
import { fetchPersonDetails, fetchRoster, fetchParentContactStatus, searchPeople }
  from '../../functions/lib/pco/roster.js';

const db = makeDb();
const clients = makeClients();
const config = makeConfig();
const S = () => loadState();

const KID_FIRST = `${MARKER}Kid${RUN_ID}`;
const KID_LAST = `${MARKER}Fam${RUN_ID}`;
const PARENT_FIRST = `${MARKER}Parent${RUN_ID}`;
const PHONE = '+1 555 010 0142';
const EMAIL = `debug_test_${RUN_ID}@example.invalid`;
const DOC_ID = `visitor_${RUN_ID}`;

async function studentCreate() {
  await db.doc(`students/${DOC_ID}`).set({
    firstName: KID_FIRST, lastName: KID_LAST, grade: 8,
    notes: null, status: 'active', upstreamPushPending: true,
  });
  const result = await pushStudent({ db, client: clients.mirror, config, studentId: DOC_ID, logger });
  check('pushStudent created', result.status === 'created', result.message);
  check('pushStudent returned an id', Boolean(result.pcoPersonId));
  const pid = result.pcoPersonId;
  saveState({ studentPersonId: pid });

  // Tally's own durable state: the document is the link, and the link must be
  // complete — id written, queue flag cleared, sync stamped.
  const doc = (await db.doc(`students/${DOC_ID}`).get()).data();
  check('doc holds the pco id', doc?.pcoPersonId === pid, String(doc?.pcoPersonId));
  check('doc push flag cleared', doc?.upstreamPushPending === false, String(doc?.upstreamPushPending));
  check('doc sync stamped', Boolean(doc?.pcoSyncedAt));

  const { mirror, pco } = await personBothSides(clients, pid);
  check('PCO holds the student', pco?.id === pid);
  check('PCO first_name carries the marker', pco?.attributes?.first_name === KID_FIRST);
  check('PCO child flag', pco?.attributes?.child === true, String(pco?.attributes?.child));
  check('PCO grade', pco?.attributes?.grade === 8, String(pco?.attributes?.grade));
  sameAttrs('mirror==pco', mirror, pco,
    ['first_name', 'last_name', 'grade', 'child', 'status', 'updated_at']);

  const roster = await fetchRoster({ client: clients.mirror, config, cache, personIds: [pid] });
  const row = roster.people.find((p) => p.pcoPersonId === pid);
  check('roster shows the student', Boolean(row), JSON.stringify(roster.unresolved));
  check('roster grade', row?.grade === 8, String(row?.grade));
}

async function studentUpdate() {
  const { studentPersonId: pid } = S();
  const result = await updateStudentProfile({
    db, client: clients.mirror, config, studentId: DOC_ID, logger,
    grade: 9, allergies: `${MARKER} peanuts`, birthday: '03-14',
  });
  check('updateStudentProfile updated', result.status === 'updated', result.message);
  check('wrote the three fields', ['grade', 'medical_notes', 'birthdate']
    .every((f) => result.wrote.includes(f)), JSON.stringify(result.wrote));

  const { mirror, pco } = await personBothSides(clients, pid);
  check('PCO grade is 9', pco?.attributes?.grade === 9, String(pco?.attributes?.grade));
  check('PCO allergies landed', pco?.attributes?.medical_notes === `${MARKER} peanuts`,
    String(pco?.attributes?.medical_notes));
  check('PCO birthdate is the yearless sentinel', pco?.attributes?.birthdate === '1885-03-14',
    String(pco?.attributes?.birthdate));
  sameAttrs('mirror==pco after update', mirror, pco,
    ['grade', 'medical_notes', 'birthdate', 'updated_at']);

  const roster = await fetchRoster({ client: clients.mirror, config, cache, personIds: [pid] });
  const row = roster.people.find((p) => p.pcoPersonId === pid);
  check('roster grade follows', row?.grade === 9, String(row?.grade));
  check('roster birthday is day-only', row?.birthday === '03-14', String(row?.birthday));
  check('roster flags the allergy without the note', row?.hasAllergies === true);

  // The document is an annotation plus a link, not a copy: the profile edit
  // went to Planning Center and must NOT have been written back into the doc,
  // while every read above serves the new values regardless. This split is the
  // consistency contract — Tally holds the door-typed history, PCO the truth.
  const doc = (await db.doc(`students/${DOC_ID}`).get()).data();
  check('doc keeps the door-typed grade, not a copy of PCO', doc?.grade === 8,
    String(doc?.grade));
}

async function cacheSemantics() {
  const { createTtlCache } = await import('../../functions/lib/pco/cache.js');
  const { studentPersonId: pid } = S();
  const warm = createTtlCache({ ttlMs: 30_000 });
  const read = async (force = false) => {
    const roster = await fetchRoster({
      client: clients.mirror, config, cache: warm, personIds: [pid], force });
    return roster.people.find((p) => p.pcoPersonId === pid)?.grade ?? null;
  };
  const before = await read();
  const bumped = before === 12 ? 11 : before + 1;
  const result = await updateStudentProfile({
    db, client: clients.mirror, config, studentId: DOC_ID, logger, grade: bumped });
  check('grade bumped upstream', result.status === 'updated', result.message);
  check('a warm cache serves the pre-write copy within its TTL',
    (await read()) === before, 'documented staleness, bounded by the TTL');
  warm.invalidate();          // what the callable's resetSharedCache does
  check('the callable-style reset makes the next read cold',
    (await read()) === bumped, `expected ${bumped}`);
  check('a forced read is also fresh', (await read(true)) === bumped);
}

async function tallyState() {
  const { studentPersonId: pid } = S();
  const doc = (await db.doc(`students/${DOC_ID}`).get()).data();
  console.log('   doc:', JSON.stringify(doc));
  const roster = await fetchRoster({ client: clients.mirror, config, cache, personIds: [pid] });
  const row = roster.people.find((p) => p.pcoPersonId === pid);
  if (row) {
    check('doc link resolves on the roster', true, `${row.firstName} ${row.lastName}`);
  } else {
    // The linked person is gone upstream: the roster must SAY so, not shrink.
    check('a deleted upstream person is reported, not dropped',
      roster.unresolved.includes(pid), JSON.stringify(roster.unresolved));
  }
}

async function parentCreate() {
  const { studentPersonId: pid } = S();
  const result = await addParent({
    db, client: clients.mirror, config, studentId: DOC_ID, logger,
    firstName: PARENT_FIRST, phone: PHONE,
  });
  check('addParent added', result.status === 'added', result.message);
  check('created a person and a household',
    result.createdPerson === true && result.createdHousehold === true,
    JSON.stringify({ p: result.createdPerson, h: result.createdHousehold }));
  const parentId = result.parentPersonId;
  saveState({ parentPersonId: parentId });

  const { pco } = await personBothSides(clients, parentId);
  check('PCO parent exists as an adult', pco?.attributes?.child === false,
    String(pco?.attributes?.child));
  check('PCO parent name carries the marker',
    String(pco?.attributes?.first_name ?? '').startsWith(MARKER));

  const fam = await clients.pco.get(`/people/${pid}`, { include: ['households'] });
  const households = (fam.data?.relationships?.households?.data ?? []).map((h) => h.id);
  check('PCO puts the student in exactly one household', households.length === 1,
    JSON.stringify(households));
  saveState({ householdId: households[0] });

  const members = await clients.pco.get(`/households/${households[0]}/household_memberships`, {});
  const roles = Object.fromEntries((members.data ?? []).map((m) => [
    m.relationships?.person?.data?.id, m.attributes?.household_role]));
  check('PCO membership: parent is parent_guardian', roles[parentId] === 'parent_guardian',
    JSON.stringify(roles));

  const details = await fetchPersonDetails({
    client: clients.mirror, config, cache, personId: pid, force: true });
  check('tally sees a household adult', details?.householdAdult === true, JSON.stringify(details));
  check('tally sees the parent name',
    String(details?.parentName ?? '').startsWith(PARENT_FIRST), String(details?.parentName));
  check('tally sees the phone', details?.parentPhone === PHONE, String(details?.parentPhone));

  const status = await fetchParentContactStatus({
    client: clients.mirror, config, cache, personIds: [pid], force: true });
  check('dashboard says reachable', status.reachable[`pco_${pid}`] === true,
    JSON.stringify(status.reachable));
}

async function parentUpdate() {
  const { studentPersonId: pid, parentPersonId } = S();
  const result = await setParentContact({
    db, client: clients.mirror, config, studentId: DOC_ID, logger, email: EMAIL });
  check('setParentContact updated', result.status === 'updated', result.message);
  check('wrote email, skipped nothing else', JSON.stringify(result.wrote) === '["email"]',
    JSON.stringify(result));

  const emails = await clients.pco.get(`/people/${parentPersonId}/emails`, {});
  const addresses = (emails.data ?? []).map((e) => e.attributes?.address);
  check('PCO holds the email', addresses.includes(EMAIL), JSON.stringify(addresses));

  const again = await setParentContact({
    db, client: clients.mirror, config, studentId: DOC_ID, logger, email: EMAIL, phone: PHONE });
  check('second write skips what is on file', again.status === 'already-set', again.message);

  const details = await fetchPersonDetails({
    client: clients.mirror, config, cache, personId: pid, force: true });
  check('tally shows the email', details?.parentEmail === EMAIL, String(details?.parentEmail));
}

async function duplicateCheck() {
  const result = await addParent({
    db, client: clients.mirror, config, studentId: DOC_ID, logger, firstName: PARENT_FIRST });
  check('a second add stops at the adult already there',
    result.status === 'already-has-adult', `${result.status}: ${result.message}`);
}

async function search() {
  const { studentPersonId: pid } = S();
  const hits = await searchPeople({ client: clients.mirror, config, query: KID_FIRST });
  check('mirror search finds the student', hits.some((h) => h.pcoPersonId === pid),
    JSON.stringify(hits.map((h) => [h.pcoPersonId, h.firstName])));
}

async function mirrorConsistency() {
  const { studentPersonId: pid, parentPersonId, householdId } = S();
  const deadline = Date.now() + 120_000;
  let edges = {};
  for (;;) {
    const [kid, par] = await Promise.all([
      clients.mirror.get(`/people/${pid}`, { include: ['households'] }),
      clients.mirror.get(`/people/${parentPersonId}`, { include: ['households'] }),
    ]);
    const of = (d) => (d.data?.relationships?.households?.data ?? []).map((h) => h.id);
    edges = { kid: of(kid), parent: of(par) };
    if ((edges.kid.includes(householdId) && edges.parent.includes(householdId))
        || Date.now() > deadline) break;
    console.log('   [wait] mirror edges not settled yet', JSON.stringify(edges));
    await sleep(5000);
  }
  check('mirror: student carries the household edge', edges.kid.includes(householdId),
    JSON.stringify(edges));
  check('mirror: parent carries the household edge', edges.parent.includes(householdId),
    JSON.stringify(edges));

  for (const id of [pid, parentPersonId]) {
    const { mirror, pco } = await personBothSides(clients, id);
    sameAttrs(`final mirror==pco Person/${id}`, mirror, pco,
      ['first_name', 'last_name', 'grade', 'child', 'birthdate', 'medical_notes', 'updated_at']);
  }
  const [mh, ph] = await Promise.all([
    clients.mirror.get(`/households/${householdId}`, {}),
    clients.pco.get(`/households/${householdId}`, {}),
  ]);
  sameAttrs('household mirror==pco', mh.data, ph.data, ['name', 'member_count', 'updated_at']);
}

async function cleanup() {
  const raw = createGuardedFetch({
    mode: 'rw', ledgerPath, tracePath: `${DEMO_DIR}/trace.ndjson`, label: 'cleanup' });
  const auth = 'Basic ' + Buffer.from(`tally-demo:${process.env.MIRROR_KEY}`).toString('base64');
  const base = process.env.MIRROR_BASE;
  const ids = [...loadLedger(ledgerPath)];
  // Households before people, so no member deletion has to guess at cascades.
  const ordered = [];
  for (const id of ids) {
    const probe = await fetch(`${base}/households/${id}`, { headers: { Authorization: auth } });
    ordered.push({ id, kind: probe.status === 200 ? 'households' : 'people' });
  }
  ordered.sort((a, b) => (a.kind === 'households' ? -1 : 1) - (b.kind === 'households' ? -1 : 1));
  for (const { id, kind } of ordered) {
    const res = await raw(`${base}/${kind}/${id}`,
      { method: 'DELETE', headers: { Authorization: auth } });
    check(`deleted ${kind}/${id}`, res.status === 204 || res.status === 404, `HTTP ${res.status}`);
  }
  for (const { id, kind } of ordered) {
    const gone = await clients.pco.get(`/${kind}/${id}`, {}).then(() => false, () => true);
    check(`PCO no longer serves ${kind}/${id}`, gone);
  }
}

const commands = {
  'student-create': studentCreate,
  'student-update': studentUpdate,
  'parent-create': parentCreate,
  'parent-update': parentUpdate,
  'duplicate-check': duplicateCheck,
  search,
  'mirror-consistency': mirrorConsistency,
  'cache-semantics': cacheSemantics,
  'tally-state': tallyState,
  cleanup,
};

const cmd = process.argv[2];
if (!commands[cmd]) {
  console.error(`usage: node flows.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
console.log(`== ${cmd} (run ${RUN_ID}) ==`);
commands[cmd]().then(finish, (e) => { console.error(' ERROR', e); process.exit(1); });
