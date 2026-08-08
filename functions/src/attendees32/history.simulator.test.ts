/**
 * Importing an Attendees meet's history, end to end against the simulator and
 * an in-memory Firestore.
 *
 * The properties the shared writer promised on the Planning Center side must
 * hold here too: the import is idempotent, RSVP-ish rows never become
 * attendance, empty nights are skipped rather than imported as cancelled, and
 * every written row names its true source.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  A32SimulatorStore,
  ATTENDANCE_CATEGORIES,
  createSimulatorFetch,
  DEFAULT_TOKEN,
  seedDefaultOrganization,
  SIMULATOR_ORIGIN,
} from '../../../tools/a32-simulator/src/index.js';
import type { A32Config } from '../config.js';
import { occurrenceId } from '../generated/materialize.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { a32Config } from '../testing/a32Config.js';
import { createA32Client, type A32Client } from './client.js';
import { A32_IMPORT_ACTOR, a32RootEventId, importMeetHistory, listImportableMeets } from './history.js';

let store: A32SimulatorStore;
let client: A32Client;
let config: A32Config;
let db: FakeFirestore;

const NOW = new Date('2026-08-01T12:00:00Z');

beforeEach(() => {
  store = new A32SimulatorStore();
  seedDefaultOrganization(store);
  client = createA32Client({
    token: DEFAULT_TOKEN,
    baseUrl: SIMULATOR_ORIGIN,
    fetchImpl: createSimulatorFetch(store),
    sleep: async () => {},
  });
  config = a32Config();
  db = new FakeFirestore();
});

describe('listImportableMeets', () => {
  it('offers the meet with enough on the row to recognise it', async () => {
    const summaries = await listImportableMeets({ client, db });
    expect(summaries).toHaveLength(1);
    const [meet] = summaries;
    expect(meet).toMatchObject({
      id: 'simorg_tally_gathering',
      name: 'Friday night',
      alreadyImported: false,
    });
    expect(meet!.gatheringCount).toBeGreaterThan(0);
    expect(meet!.checkInCount).toBeGreaterThan(0);
    expect(meet!.firstGatheringAt).not.toBeNull();
  });

  it('says when the chain already exists in Tally', async () => {
    db.seed(`events/${a32RootEventId('simorg_tally_gathering')}`, { title: 'Friday night' });
    const summaries = await listImportableMeets({ client, db });
    expect(summaries[0]!.alreadyImported).toBe(true);
  });
});

describe('importMeetHistory', () => {
  it('imports gatherings, students and attendance with Attendees provenance', async () => {
    const summary = await importMeetHistory({
      db,
      client,
      config,
      meetSlug: 'simorg_tally_gathering',
      uid: 'uid-leader',
      now: NOW,
    });

    expect(summary.eventName).toBe('Friday night');
    expect(summary.rootEventId).toBe(a32RootEventId('simorg_tally_gathering'));
    expect(summary.gatherings.created).toBeGreaterThan(0);
    expect(summary.students.added).toBeGreaterThan(0);
    expect(summary.checkIns.written).toBeGreaterThan(0);
    // The seeded term has one scheduled-but-absent row per week; none of them
    // may become attendance, and the summary says why they are not missing.
    expect(summary.warnings.some((warning) => warning.includes('RSVP'))).toBe(true);

    const root = db.get(summary.rootEventId ? `events/${summary.rootEventId}` : '')!;
    expect(root).toMatchObject({
      title: 'Friday night',
      createdBy: A32_IMPORT_ACTOR,
      a32MeetSlug: 'simorg_tally_gathering',
      recurrence: null,
    });

    // Students land with the generic linkage, never the legacy field.
    const studentPaths = [...db.data.keys()].filter(
      (path) => path.startsWith('students/') && !path.includes('/attendance/'),
    );
    expect(studentPaths.length).toBe(summary.students.added);
    for (const path of studentPaths) {
      const doc = db.get(path)!;
      expect(path).toBe(`students/a32_${doc.upstreamPersonId}`);
      expect(doc.upstreamBackend).toBe('a32');
      expect(doc.pcoPersonId).toBeUndefined();
      expect(doc.createdBy).toBe(A32_IMPORT_ACTOR);
    }

    // Attendance rows carry the true actor and the import method.
    const attendancePaths = [...db.data.keys()].filter((path) => path.includes('/attendance/'));
    expect(attendancePaths.length).toBe(summary.checkIns.written);
    for (const path of attendancePaths.slice(0, 5)) {
      expect(db.get(path)).toMatchObject({ checkedInBy: A32_IMPORT_ACTOR, method: 'import' });
    }
  });

  it('is idempotent: a second run writes nothing new', async () => {
    const first = await importMeetHistory({
      db,
      client,
      config,
      meetSlug: 'simorg_tally_gathering',
      uid: 'uid-leader',
      now: NOW,
    });
    const second = await importMeetHistory({
      db,
      client,
      config,
      meetSlug: 'simorg_tally_gathering',
      uid: 'uid-leader',
      now: NOW,
    });

    expect(second.gatherings.created).toBe(0);
    expect(second.gatherings.existing).toBe(first.gatherings.created);
    expect(second.students.added).toBe(0);
    expect(second.students.existing).toBe(first.students.added);
    // Re-importing its own rows is allowed (that is what makes a top-up
    // possible); what matters is the world ends up identical.
    expect(second.checkIns.written).toBe(first.checkIns.written);
  });

  it('keeps a row a counselor wrote in Tally itself', async () => {
    const first = await importMeetHistory({
      db,
      client,
      config,
      meetSlug: 'simorg_tally_gathering',
      uid: 'uid-leader',
      now: NOW,
    });
    const somePath = [...db.data.keys()].find((path) => path.includes('/attendance/'))!;
    db.seed(somePath, { ...db.get(somePath)!, checkedInBy: 'uid-counselor', method: 'tap' });

    const second = await importMeetHistory({
      db,
      client,
      config,
      meetSlug: 'simorg_tally_gathering',
      uid: 'uid-leader',
      now: NOW,
    });
    expect(second.checkIns.kept).toBe(1);
    expect(second.checkIns.written).toBe(first.checkIns.written - 1);
    expect(db.get(somePath)!.checkedInBy).toBe('uid-counselor');
  });

  it('files an aliased attendee under the membership the roster already has', async () => {
    /*
     * The church runs both systems for the same people, and Planning Center
     * holds each person's Attendees UUID (`attendees_uuid`). The caller
     * resolves that into `existingStudentIds`; what matters here is that the
     * import honours it — history lands on the Planning Center membership,
     * no second document stands up, and the Planning Center linkage is left
     * exactly as it was.
     */
    const priya = [...store.attendees.values()].find((row) => row.firstName === 'Priya')!;
    db.seed('students/pco_140203708', {
      status: 'active',
      pcoPersonId: '140203708',
      upstreamBackend: 'pco',
      upstreamPersonId: '140203708',
    });

    const summary = await importMeetHistory({
      db,
      client,
      config,
      meetSlug: 'simorg_tally_gathering',
      uid: 'uid-leader',
      now: NOW,
      existingStudentIds: { [priya.id]: 'pco_140203708' },
    });

    // No a32 document for her; her rows count her as an existing student.
    expect(db.get(`students/a32_${priya.id}`)).toBeUndefined();
    expect(summary.students.existing).toBeGreaterThanOrEqual(1);

    // Her attendance is under the membership the church already had…
    const herRows = [...db.data.keys()].filter((path) =>
      path.endsWith('/attendance/pco_140203708'),
    );
    expect(herRows.length).toBeGreaterThan(0);

    // …and that membership still belongs to Planning Center.
    expect(db.get('students/pco_140203708')).toMatchObject({
      pcoPersonId: '140203708',
      upstreamBackend: 'pco',
      upstreamPersonId: '140203708',
    });
  });

  it('skips nights nobody attended instead of importing cancelled evenings', async () => {
    const empty = store.seedGathering('2026-05-01T19:00:00.000Z', '2026-05-01T21:00:00.000Z');
    // One scheduled row, nobody attended: still an empty night.
    store.seedAttendance(empty, [...store.attendees.keys()][0]!, ATTENDANCE_CATEGORIES.scheduled);

    const summary = await importMeetHistory({
      db,
      client,
      config,
      meetSlug: 'simorg_tally_gathering',
      uid: 'uid-leader',
      now: NOW,
    });
    expect(summary.gatherings.skippedEmpty).toBeGreaterThan(0);
  });

  it('keeps the first of two gatherings that share a calendar day', async () => {
    /*
     * A meet that runs two sessions in one day would otherwise put both on one
     * document — Tally derives a night's id from its chain and its *day* — and
     * the two registers would merge, so everybody at the first session read as
     * present at the second.
     */
    const nights = [...store.gatherings].sort((a, b) => (a.start < b.start ? -1 : 1));
    // The most recent night, so the collision is between two derived ids
    // rather than involving the root, whose id carries no date at all.
    const evening = nights.at(-1)!;
    const start = new Date(new Date(evening.start).getTime() + 3 * 60 * 60 * 1000);
    const second = store.seedGathering(
      start.toISOString(),
      new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    );

    // Somebody who came to that second session and to nothing else, so any
    // sighting of them anywhere is the merge this guards against.
    const otto = store.seedStudent({ firstName: 'Otto', lastName: 'Baumann', grade: 9 });
    store.seedAttendance(second, otto.id, ATTENDANCE_CATEGORIES.attended);

    const summary = await importMeetHistory({
      db,
      client,
      config,
      meetSlug: 'simorg_tally_gathering',
      uid: 'uid-leader',
      now: NOW,
    });

    // Never silently: a dropped session is a night of attendance that vanished.
    expect(summary.warnings.some((warning) => warning.includes('share'))).toBe(true);

    expect(db.get(`students/a32_${otto.id}`)).toBeUndefined();
    expect(
      [...db.data.keys()].filter((path) => path.endsWith(`/attendance/a32_${otto.id}`)),
    ).toEqual([]);

    // The night that was kept is the earlier one, with its own register intact.
    const keptId = occurrenceId(a32RootEventId('simorg_tally_gathering'), new Date(evening.start));
    expect(db.get(`events/${keptId}`)).toMatchObject({ a32GatheringId: evening.id });
  });
});
