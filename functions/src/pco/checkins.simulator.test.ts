/**
 * The Check-Ins history import, driven end to end: the real client, its real
 * query encoding and pagination, against a simulated Planning Center serving
 * both products from one host — which is the fact `checkInsBaseUrl` leans on.
 *
 * The fixture event is deliberately awkward in every way the real data is:
 * a night nobody attended, a period with no date at all, a duplicate check-in,
 * a volunteering parent, and a one-time guest with no person behind the name.
 * What these tests pin down is that each of those becomes the *right* nothing
 * — skipped and counted, never silently dropped, never a phantom student.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECKINS_ARCHIVED_EVENT_ID,
  CHECKINS_ONE_OFF_EVENT_ID,
  CHECKINS_WEEKLY_EVENT_ID,
  FIXTURE_IDS,
  SIMULATOR_ORIGIN,
  SimulatorStore,
  createSimulatorFetch,
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  type SimulatorOptions,
} from '../../../tools/pco-simulator/src/index.js';
import { MINISTRY_TIME_ZONE } from '../occurrences.js';
import { SILENT_LOGGER } from '../firestore.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { createPcoClient, type PcoClient } from './client.js';
import {
  checkInsBaseUrl,
  checkInsRootEventId,
  importCheckInsEvent,
  listCheckInsEvents,
} from './checkins.js';

const NOW = new Date('2026-07-01T12:00:00Z');
const UID = 'core-team-uid';

function harness(options: SimulatorOptions = {}): {
  client: PcoClient;
  store: SimulatorStore;
  db: FakeFirestore;
} {
  const store = new SimulatorStore(options);
  const simulator = createSimulatorFetch(store);

  const baseUrl = checkInsBaseUrl(SIMULATOR_ORIGIN);
  if (!baseUrl) throw new Error('The simulator origin must derive a Check-Ins root.');

  const client = createPcoClient({
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl,
    sleep: async () => {},
    fetchImpl: simulator,
  });

  return { client, store, db: new FakeFirestore() };
}

async function runImport(world: ReturnType<typeof harness>, pcoEventId: string) {
  return importCheckInsEvent({
    db: world.db,
    client: world.client,
    pcoEventId,
    uid: UID,
    now: NOW,
    logger: SILENT_LOGGER,
  });
}

/** Ids the fixture's four Friday nights derive, in ministry-local days. */
const ROOT = checkInsRootEventId(CHECKINS_WEEKLY_EVENT_ID);
const JUNE_19 = `${ROOT}-2026-06-19`;
const JUNE_26 = `${ROOT}-2026-06-26`;

const originalTz = process.env.TZ;

beforeEach(() => {
  // Occurrence ids embed the ministry-local calendar day; the container that
  // runs the real callable is UTC and sets this the same way.
  process.env.TZ = MINISTRY_TIME_ZONE;
});

afterEach(() => {
  process.env.TZ = originalTz;
});

describe('checkInsBaseUrl', () => {
  it('derives the Check-Ins root beside the People root', () => {
    expect(checkInsBaseUrl('https://api.planningcenteronline.com/people/v2')).toBe(
      'https://api.planningcenteronline.com/check-ins/v2',
    );
    expect(checkInsBaseUrl('http://127.0.0.1:4010/people/v2/')).toBe(
      'http://127.0.0.1:4010/check-ins/v2',
    );
  });

  it('refuses a root it cannot derive from, rather than guessing', () => {
    // Every request carries the church's credentials; a guessed URL is where
    // they would be sent.
    expect(checkInsBaseUrl('https://proxy.example.org/planning-center')).toBeNull();
  });
});

describe('listCheckInsEvents', () => {
  it('offers the live events with enough history to recognise them', async () => {
    const world = harness();
    const events = await listCheckInsEvents({ client: world.client, db: world.db });

    const weekly = events.find((event) => event.id === CHECKINS_WEEKLY_EVENT_ID);
    expect(weekly).toMatchObject({
      name: 'Friday Fellowship',
      frequency: 'Weekly',
      // Four dated Fridays; the dateless period the API also serves is not a
      // gathering anybody can recognise the event by.
      gatheringCount: 4,
      // Attendees only: the volunteering parent is not part of the count a
      // leader sizes the import by.
      checkInCount: 9,
      firstGatheringAt: '2026-06-06T02:30:00Z',
      alreadyImported: false,
    });
  });

  it('does not offer archived events', async () => {
    const world = harness();
    const events = await listCheckInsEvents({ client: world.client, db: world.db });
    expect(events.map((event) => event.id)).not.toContain(CHECKINS_ARCHIVED_EVENT_ID);
  });

  it('reports a chain that already exists in Tally', async () => {
    const world = harness();
    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    const events = await listCheckInsEvents({ client: world.client, db: world.db });
    const weekly = events.find((event) => event.id === CHECKINS_WEEKLY_EVENT_ID);
    expect(weekly?.alreadyImported).toBe(true);
  });
});

describe('importCheckInsEvent', () => {
  it('imports every attended night as one chain under Tally-derived ids', async () => {
    const world = harness();
    const summary = await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    // Friday 19:30 Pacific is Saturday 02:30 UTC — the ids must carry the
    // *local* day, or the chain would not line up with what the app derives.
    expect(world.db.get(`events/${ROOT}`)).toMatchObject({
      title: 'Friday Fellowship',
      mode: 'recurring',
      recurrenceRootId: null,
      status: 'scheduled',
      createdBy: 'planning-center',
      pcoCheckInsEventId: CHECKINS_WEEKLY_EVENT_ID,
    });
    expect(world.db.get(`events/${JUNE_19}`)).toMatchObject({ recurrenceRootId: ROOT });
    expect(world.db.get(`events/${JUNE_26}`)).toMatchObject({ recurrenceRootId: ROOT });

    expect(summary.gatherings).toMatchObject({ created: 3, existing: 0, skippedEmpty: 1 });
  });

  it('carries a weekly recurrence rule so the chain keeps projecting', async () => {
    const world = harness();
    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    // On every instance, exactly as materialising an occurrence copies it —
    // whichever night is latest becomes the projection's template.
    for (const id of [ROOT, JUNE_19, JUNE_26]) {
      expect(world.db.get(`events/${id}`)?.recurrence).toEqual({
        frequency: 'weekly',
        interval: 1,
        weekdays: [5],
        monthlyMode: 'dayOfMonth',
        until: null,
        count: null,
      });
    }
  });

  it('takes the check-in window from the kiosk itself', async () => {
    const world = harness();
    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    const root = world.db.get(`events/${ROOT}`)!;
    expect((root.startAt as Date).toISOString()).toBe('2026-06-06T02:30:00.000Z');
    expect((root.checkInOpensAt as Date).toISOString()).toBe('2026-06-06T02:00:00.000Z');
    expect((root.checkInClosesAt as Date).toISOString()).toBe('2026-06-06T04:30:00.000Z');
  });

  it('puts everyone who attended on the roster, dated from their first night', async () => {
    const world = harness();
    const summary = await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    expect(summary.students).toMatchObject({ found: 4, added: 4, existing: 0 });

    const amara = world.db.get(`students/pco_${FIXTURE_IDS.amara}`)!;
    expect(amara).toMatchObject({
      pcoPersonId: FIXTURE_IDS.amara,
      status: 'active',
      createdBy: 'planning-center',
      addedToRosterBy: UID,
    });
    // Around since her first night — not since the import ran. The dashboard
    // decides which past gatherings she could have attended from this date.
    expect((amara.createdAt as Date).toISOString()).toBe('2026-06-06T02:30:00.000Z');
    expect((amara.firstAttendedAt as Date).toISOString()).toBe('2026-06-06T02:30:00.000Z');
    expect((amara.lastAttendedAt as Date).toISOString()).toBe('2026-06-27T02:30:00.000Z');

    // The Guest-kind check-in is an attendee: Mateo is a real person who came.
    expect(world.db.get(`students/pco_${FIXTURE_IDS.mateoCheckInsGuest}`)).toBeDefined();
  });

  it('writes attendance rows a counselor could have written, minus the uid', async () => {
    const world = harness();
    const summary = await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    expect(summary.checkIns).toMatchObject({
      written: 7,
      kept: 0,
      skippedVolunteers: 1,
      skippedOneTimeGuests: 1,
      duplicatesCollapsed: 1,
    });

    const row = world.db.get(`events/${ROOT}/attendance/pco_${FIXTURE_IDS.amara}`)!;
    expect(row).toMatchObject({
      studentId: `pco_${FIXTURE_IDS.amara}`,
      eventId: ROOT,
      seriesId: null,
      checkedInBy: 'planning-center',
      method: 'import',
      isFirstEver: true,
    });
    // The duplicate collapsed onto the *earliest* record — the arrival.
    expect((row.checkedInAt as Date).toISOString()).toBe('2026-06-06T02:30:00.000Z');

    // Nobody was imported for the volunteer or the person-less guest.
    expect(world.db.get(`students/pco_5200001`)).toBeUndefined();
    expect(
      world.db.get(`events/${JUNE_19}/attendance/pco_${FIXTURE_IDS.amara}`),
    ).toMatchObject({ isFirstEver: false });
  });

  it('marks first-ever on each student’s earliest imported night', async () => {
    const world = harness();
    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    // Sofia only ever came on the last night; that night is her first ever.
    const sofia = world.db.get(
      `events/${JUNE_26}/attendance/pco_${FIXTURE_IDS.sofiaWithAllergy}`,
    )!;
    expect(sofia.isFirstEver).toBe(true);
  });

  it('is idempotent: a re-run converges on the same documents', async () => {
    const world = harness();
    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);
    const before = new Map(world.db.data);

    const summary = await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    expect(summary.gatherings).toMatchObject({ created: 0, existing: 3 });
    expect(summary.students).toMatchObject({ added: 0, existing: 4 });
    // Rows the import itself wrote are re-written with the same values —
    // including `isFirstEver`, which must not flip once the student document
    // carries a `firstAttendedAt`.
    expect(
      world.db.get(`events/${ROOT}/attendance/pco_${FIXTURE_IDS.amara}`)?.isFirstEver,
    ).toBe(true);

    for (const [path, value] of before) {
      expect(world.db.get(path)).toEqual(value);
    }
  });

  it('never overwrites a night a leader has edited or a row a counselor wrote', async () => {
    const world = harness();
    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    // A leader renames one night; a counselor re-checks a student in through
    // Tally itself.
    const edited = { ...world.db.get(`events/${JUNE_26}`)!, title: 'Renamed by a leader' };
    world.db.seed(`events/${JUNE_26}`, edited);
    world.db.seed(`events/${JUNE_26}/attendance/pco_${FIXTURE_IDS.sofiaWithAllergy}`, {
      studentId: `pco_${FIXTURE_IDS.sofiaWithAllergy}`,
      eventId: JUNE_26,
      seriesId: null,
      checkedInAt: new Date('2026-06-27T02:45:00Z'),
      checkedInBy: 'a-counselor-uid',
      method: 'tap',
      isFirstEver: false,
    });

    const summary = await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    expect(world.db.get(`events/${JUNE_26}`)?.title).toBe('Renamed by a leader');
    expect(
      world.db.get(`events/${JUNE_26}/attendance/pco_${FIXTURE_IDS.sofiaWithAllergy}`)
        ?.checkedInBy,
    ).toBe('a-counselor-uid');
    expect(summary.checkIns.kept).toBe(1);
  });

  it('leaves a deactivated student deactivated', async () => {
    const world = harness();
    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    const path = `students/pco_${FIXTURE_IDS.amara}`;
    world.db.seed(path, { ...world.db.get(path)!, status: 'inactive' });

    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    // Removal from the roster is a decision somebody made in Tally; history
    // arriving later does not unmake it.
    expect(world.db.get(path)?.status).toBe('inactive');
  });

  it('never pushes an existing first-attended date later', async () => {
    const world = harness();
    // She was first seen at a live Tally gathering earlier than anything the
    // kiosk holds, so the import has nothing earlier to contribute.
    world.db.seed(`students/pco_${FIXTURE_IDS.amara}`, {
      pcoPersonId: FIXTURE_IDS.amara,
      status: 'active',
      firstAttendedAt: new Date('2026-05-01T02:30:00Z'),
      lastAttendedAt: new Date('2026-05-01T02:30:00Z'),
      createdAt: new Date('2026-05-01T02:30:00Z'),
    });

    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    const student = world.db.get(`students/pco_${FIXTURE_IDS.amara}`)!;
    // The half of the invariant that protects New Visitors from a back-fill:
    // a later date discovered in the archive is not news about their arrival.
    expect((student.firstAttendedAt as Date).toISOString()).toBe('2026-05-01T02:30:00.000Z');
    // But "last seen" does move forward.
    expect((student.lastAttendedAt as Date).toISOString()).toBe('2026-06-27T02:30:00.000Z');
    // And no imported row claims to be her first ever.
    expect(
      world.db.get(`events/${ROOT}/attendance/pco_${FIXTURE_IDS.amara}`)?.isFirstEver,
    ).toBe(false);
  });

  it('corrects a first-attended date the archive proves is too late', async () => {
    const world = harness();
    /*
     * The ordinary case after adopting Tally and importing afterwards: she was
     * checked in live last week, so her document says she arrived last week —
     * and the kiosk has been recording her since June.
     */
    world.db.seed(`students/pco_${FIXTURE_IDS.amara}`, {
      pcoPersonId: FIXTURE_IDS.amara,
      status: 'active',
      firstAttendedAt: new Date('2026-06-30T02:30:00Z'),
      lastAttendedAt: new Date('2026-06-30T02:30:00Z'),
      createdAt: new Date('2026-06-30T02:30:00Z'),
    });

    await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    const student = world.db.get(`students/pco_${FIXTURE_IDS.amara}`)!;
    // Otherwise her profile reads "first seen 30 June" above a row saying she
    // was present on the 6th, and the dashboard calls a regular a new face.
    expect((student.firstAttendedAt as Date).toISOString()).toBe('2026-06-06T02:30:00.000Z');
    /*
     * And the date every derivation measures her against moves with it.
     * `predictiveRoster` and the MIA list both drop history from before
     * `createdAt`, so leaving it at 30 June would land her whole imported
     * attendance somewhere no screen would count it.
     */
    expect((student.createdAt as Date).toISOString()).toBe('2026-06-06T02:30:00.000Z');
    // Her earliest imported night is now, truthfully, her first ever.
    expect(
      world.db.get(`events/${ROOT}/attendance/pco_${FIXTURE_IDS.amara}`)?.isFirstEver,
    ).toBe(true);
  });

  it('imports a frequency-less event as history with nothing projected ahead', async () => {
    const world = harness();
    const summary = await runImport(world, CHECKINS_ONE_OFF_EVENT_ID);

    const rootId = checkInsRootEventId(CHECKINS_ONE_OFF_EVENT_ID);
    expect(summary.gatherings.created).toBe(1);
    const root = world.db.get(`events/${rootId}`)!;
    // A chain with no rule: the history groups and predicts, and the
    // projection has nothing to continue — because nothing upstream repeats.
    expect(root.recurrence).toBeNull();
    expect(root.mode).toBe('recurring');
  });

  it('walks pagination rather than trusting one page', async () => {
    // Page size 2 forces every sweep — events, periods, check-ins — to walk.
    const world = harness({ pageSize: 2 });
    const summary = await runImport(world, CHECKINS_WEEKLY_EVENT_ID);

    expect(summary.gatherings).toMatchObject({ created: 3 });
    expect(summary.checkIns).toMatchObject({ written: 7 });
  });
});
