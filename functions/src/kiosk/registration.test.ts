/**
 * What the server does with a family that typed itself in.
 *
 * Three groups of claims, in the order they cost somebody something:
 *
 *   - **Refusals.** This is the only write in Tally requested by somebody who
 *     is not on the team, so what it will not accept is the interesting half.
 *   - **The documents.** A child registered here has to look exactly like a
 *     child quick-added at the door, or they fall out of the dashboard lists
 *     the core team works from — plus the one field that differs, which is what
 *     stops the create trigger racing this request's own push.
 *   - **A retry.** A parent taps once; a wifi blip means the call runs twice.
 *     One family either way, or the roster grows a duplicate every time a lobby
 *     has bad signal.
 *   - **What does *not* happen.** Nothing upstream, and no refusal — the two
 *     things this used to do at the door and now leaves to the Review screen.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { PULSE_DOC } from './pulse.js';
import { PENDING_LAST4_DOC, PHONE_INDEX_DOC } from './phoneIndex.js';
import {
  parseRegisterFamilyRequest,
  registerFamily,
  REGISTRATIONS_COLLECTION,
  RegistrationInputError,
  type RegisterFamilyResult,
} from './registration.js';

const NOW = new Date('2026-08-07T19:05:00Z');
const EVENT_START = new Date('2026-08-07T19:00:00Z');

function goodRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registrationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    children: [
      { firstName: 'Robin', lastName: 'Fields', grade: 4 },
      { firstName: 'Sam', lastName: 'Fields', grade: null },
    ],
    guardian: { firstName: 'Dana', lastName: 'Fields', phone: '555-010-3344' },
    ...overrides,
  };
}

function dbWithEvent(): FakeFirestore {
  const db = new FakeFirestore();
  db.seed('events/friday-today', {
    status: 'scheduled',
    seriesId: 'friday-fellowship',
    startAt: EVENT_START,
  });
  return db;
}

async function run(
  db: FakeFirestore,
  args: { data?: Record<string, unknown> } = {},
): Promise<RegisterFamilyResult> {
  return registerFamily({
    db,
    request: parseRegisterFamilyRequest(args.data ?? goodRequest()),
    context: { uid: 'staff-uid', eventId: 'friday-today' },
    now: NOW,
  });
}

/** The review record this registration left behind. */
function recordFor(db: FakeFirestore, id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') {
  return db.get(`${REGISTRATIONS_COLLECTION}/${id}`)!;
}

/* -------------------------------------------------------------------------- */

describe('what it refuses', () => {
  const refusals: [string, Record<string, unknown>][] = [
    ['no children at all', { children: [] }],
    ['more children than one go takes', { children: Array.from({ length: 7 }, () => ({ firstName: 'A', lastName: 'B', grade: 1 })) }],
    ['a name with a number in it', { children: [{ firstName: 'Room 3', lastName: 'Fields', grade: 4 }] }],
    ['a name that is only punctuation', { children: [{ firstName: "''", lastName: 'Fields', grade: 4 }] }],
    ['a grade off the end of the band', { children: [{ firstName: 'Robin', lastName: 'Fields', grade: 13 }] }],
    ['a phone number that is too short', { guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5550103' } }],
    ['a phone number nobody could ring', { guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5555555555' } }],
    ['a registration id somebody made up', { registrationId: 'short' }],
  ];

  it.each(refusals)('refuses %s', (_label, overrides) => {
    expect(() => parseRegisterFamilyRequest(goodRequest(overrides))).toThrow(
      RegistrationInputError,
    );
  });

  it('accepts a number written the way people write one', () => {
    const parsed = parseRegisterFamilyRequest(
      goodRequest({ guardian: { firstName: 'Dana', lastName: 'Fields', phone: '+1 (555) 010-3344' } }),
    );
    expect(parsed.guardian?.phone).toBe('5550103344');
  });

  it('accepts allergies, now that the wizard asks', () => {
    // The kiosk used to be refused outright — its wizard had no field. It has
    // one now, gated on the same write-back capability the retired phone form
    // used.
    expect(parseRegisterFamilyRequest(goodRequest({ allergies: ['peanuts', null] })).allergies).toEqual([
      'peanuts',
      null,
    ]);
    // Absent stays absent: a wizard whose binding says "don't ask" sends no
    // key at all, and every child parses as note-less.
    expect(parseRegisterFamilyRequest(goodRequest()).allergies).toEqual([null, null]);
  });
});

describe('the documents it writes', () => {
  it('creates each child the way a quick-added visitor is created', async () => {
    const db = dbWithEvent();
    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');

    const child = db.get(`students/${result.children[0]!.studentId}`)!;
    expect(child).toMatchObject({
      firstName: 'Robin',
      lastName: 'Fields',
      grade: 4,
      status: 'active',
      isVisitor: true,
      searchName: 'robin fields',
      pcoPersonId: null,
      upstreamPushPending: true,
      createdBy: 'staff-uid',
    });
    // The one field a quick-add has not got: what tells `onStudentCreated` to
    // stand down, because this request pushes its own children.
    expect(child.registrationId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    // No grade is an absent key, never a zero — a nursery child has none.
    expect(db.get(`students/${result.children[1]!.studentId}`)).not.toHaveProperty('grade');
  });

  it('checks everybody in against the gathering, keyed by student id', async () => {
    const db = dbWithEvent();
    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');

    for (const child of result.children) {
      expect(db.get(`events/friday-today/attendance/${child.studentId}`)).toMatchObject({
        studentId: child.studentId,
        eventId: 'friday-today',
        // Read from the event document, never from the request: it decides
        // which repeat chain the visit counts towards.
        seriesId: 'friday-fellowship',
        method: 'kiosk',
        isFirstEver: true,
        checkedInBy: 'staff-uid',
      });
    }
    expect(result.checkedIn).toBe(true);
  });

  it('records one arrival for the whole form, so a pickup knows who came together', async () => {
    /*
     * One registration is one arrival by definition: these children were typed
     * into the same form and came through the same door. Without it the
     * clearest "we arrived together" the kiosk ever gets would reach the pickup
     * screen with nothing on file and fall through to the four-digit guess.
     *
     * The registration's own id, rather than a second one minted here — it is
     * already unique and already on every child's document as provenance, and
     * two ids for one act could only ever disagree.
     */
    const db = dbWithEvent();
    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');

    const arrivals = result.children.map(
      (child) =>
        (db.get(`events/friday-today/attendance/${child.studentId}`) as { arrivalId?: string })
          .arrivalId,
    );
    expect(arrivals).toHaveLength(2);
    expect(new Set(arrivals).size).toBe(1);
    expect(arrivals[0]).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('makes the family findable by their four digits immediately', async () => {
    const db = dbWithEvent();
    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');

    const ids = result.children.map((child) => child.studentId).sort();
    expect(result.last4).toBe('3344');
    // The live index, patched now rather than at the nightly rebuild.
    expect((db.get(PHONE_INDEX_DOC)!.last4 as Record<string, string[]>)['3344']).toEqual(ids);
    // And the overlay, so a rebuild cannot take it away again.
    const entries = db.get(PENDING_LAST4_DOC)!.entries as Record<string, { last4: string }>;
    expect(entries['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']).toMatchObject({ last4: '3344' });
  });

});

describe('a family already on the roster', () => {
  /*
   * The door records the suspicion and registers them anyway.
   *
   * It used to refuse and say "search for their name instead", which is an
   * instruction to check in a different child of the same name — on a screen
   * with nobody standing at it, and with a queue behind. Two rows a reviewer
   * merges on Tuesday is the cheaper mistake, and the only one somebody
   * notices.
   */
  it('registers them anyway, and tells the reviewer who they might be', async () => {
    const db = dbWithEvent();
    db.seed('students/pco_7', { status: 'active', firstName: 'Robin', lastName: 'Fields' });

    const result = await run(db);
    expect(result.status).toBe('created');
    expect(db.get(`students/${result.children[0]!.studentId}`)).toBeDefined();
    expect(db.get(`events/friday-today/attendance/${result.children[0]!.studentId}`)).toBeDefined();

    // Child 0 matched; child 1 did not. Recorded, never acted on.
    expect(recordFor(db).possibleDuplicateOf).toEqual({ '0': ['pco_7'] });
  });

  it('does not report this run\'s own children as duplicates of themselves', async () => {
    const db = dbWithEvent();
    const result = await run(db);
    expect(result.status).toBe('created');
    expect(recordFor(db).possibleDuplicateOf).toEqual({});
  });

  it('ignores somebody who has left the roster', async () => {
    const db = dbWithEvent();
    db.seed('students/pco_7', { status: 'inactive', firstName: 'Robin', lastName: 'Fields' });

    await run(db);
    expect(recordFor(db).possibleDuplicateOf).toEqual({});
  });

  it('matches on the name alone, whatever grade the office recorded', async () => {
    const db = dbWithEvent();
    db.seed('students/pco_7', { status: 'active', firstName: 'Robin', lastName: 'Fields', grade: 9 });

    await run(db);
    expect(recordFor(db).possibleDuplicateOf).toEqual({ '0': ['pco_7'] });
  });

  it('folds accents the way the upstream matcher does', async () => {
    const db = dbWithEvent();
    db.seed('students/pco_7', { status: 'active', firstName: 'José', lastName: 'Núñez' });

    await run(db, {
      data: goodRequest({ children: [{ firstName: 'Jose', lastName: 'Nunez', grade: 4 }] }),
    });
    expect(recordFor(db).possibleDuplicateOf).toEqual({ '0': ['pco_7'] });
  });

  it('refuses the same child typed twice on one form', () => {
    expect(() =>
      parseRegisterFamilyRequest(
        goodRequest({
          children: [
            { firstName: 'Robin', lastName: 'Fields', grade: 4 },
            { firstName: 'robin', lastName: 'FIELDS', grade: 6 },
          ],
        }),
      ),
    ).toThrow(RegistrationInputError);
  });
});

describe('a retried call', () => {
  it('answers the second one instead of creating a second family', async () => {
    const db = dbWithEvent();
    const first = await run(db);
    if (first.status !== 'created') throw new Error('expected created');

    const second = await run(db);
    if (second.status !== 'created') throw new Error('expected created');

    expect(second.children.map((child) => child.studentId)).toEqual(
      first.children.map((child) => child.studentId),
    );
    expect(second.last4).toBe(first.last4);
    // Two children exist, not four.
    expect([...db.data.keys()].filter((path) => path.startsWith('students/'))).toHaveLength(2);
  });

  it('finishes a run that died before it could mark itself complete', async () => {
    const db = dbWithEvent();
    // The claim exists with its ids; the batch never landed.
    db.seed(`${REGISTRATIONS_COLLECTION}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, {
      status: 'pending',
      source: 'kiosk',
      eventId: 'friday-today',
      studentIds: ['resumed-1', 'resumed-2'],
      childCount: 2,
      last4: '3344',
      checkedIn: true,
      createdAt: NOW,
    });

    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');
    expect(result.children.map((child) => child.studentId)).toEqual(['resumed-1', 'resumed-2']);
    expect(db.get('students/resumed-1')).toBeDefined();
    expect(db.get(`${REGISTRATIONS_COLLECTION}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`)!.status).toBe(
      'complete',
    );
  });
});

describe('what reaches the church database', () => {
  it('nothing — every child is held until somebody approves them', async () => {
    const db = dbWithEvent();
    const result = await run(db);

    for (const child of result.children) {
      const document = db.get(`students/${child.studentId}`)!;
      // The hold, and the queue flag beside it. Both: the child genuinely is
      // queued, and what the hold adds is that the queue does not drain on its
      // own. See backends/pendingReview.ts.
      expect(document.pendingReview).toBe(true);
      expect(document.upstreamPushPending).toBe(true);
    }
  });

  it('keeps the guardian and the allergies for the reviewer', async () => {
    const db = dbWithEvent();
    await run(db, { data: goodRequest({ allergies: ['peanuts', null] }) });

    const record = recordFor(db);
    expect(record.guardian).toEqual({
      firstName: 'Dana',
      lastName: 'Fields',
      phone: '5550103344',
    });
    expect(record.allergies).toEqual(['peanuts', null]);
    // The rules forbid the key on a student outright; this is the same claim
    // one layer up. It waits on the registration document or nowhere.
    const [studentPath] = db.writtenPaths('students/');
    expect(db.get(studentPath!)).not.toHaveProperty('allergies');
  });

  it('keeps a kiosk-typed allergy note the same way, and says which child has one', async () => {
    // The wizard's note takes the identical path the phone form's did: on the
    // registration record for the reviewer, never on a student document. The
    // result names the child so the kiosk can mark the row it just added.
    const db = dbWithEvent();
    const result = await run(db, { data: goodRequest({ allergies: [null, 'bee stings'] }) });

    expect(recordFor(db).allergies).toEqual([null, 'bee stings']);
    expect(result.children.map((child) => child.hasAllergies)).toEqual([false, true]);
    const [studentPath] = db.writtenPaths('students/');
    expect(db.get(studentPath!)).not.toHaveProperty('allergies');
  });

  it('answers a replay with the notes it kept, not the ones it was just sent', async () => {
    const db = dbWithEvent();
    await run(db, { data: goodRequest({ allergies: ['peanuts', null] }) });
    // The retry arrives note-less — a kiosk that lost its state mid-submit
    // re-sends what it still holds. The record is the truth.
    const replay = await run(db, { data: goodRequest() });
    expect(replay.children.map((child) => child.hasAllergies)).toEqual([true, false]);
  });
});

describe('adding a sibling', () => {
  function siblingRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      registrationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      children: [{ firstName: 'Ada', lastName: 'Fields', grade: 1 }],
      anchorStudentIds: ['pco_7'],
      ...overrides,
    };
  }

  function dbWithFamily(): FakeFirestore {
    const db = dbWithEvent();
    db.seed('students/pco_7', { status: 'active', firstName: 'Robin', lastName: 'Fields' });
    db.seed(PHONE_INDEX_DOC, { last4: { '3344': ['pco_7'] } });
    return db;
  }

  it('needs no adult, and finds the digits from the siblings', async () => {
    const db = dbWithFamily();
    const result = await run(db, { data: siblingRequest() });

    // Never from the request: a client that could name the digits could file a
    // child under a stranger's number.
    expect(result.last4).toBe('3344');
    expect((db.get(PHONE_INDEX_DOC)!.last4 as Record<string, string[]>)['3344']).toContain(
      result.children[0]!.studentId,
    );
    expect(recordFor(db).anchorStudentIds).toEqual(['pco_7']);
    expect(recordFor(db).guardian).toBeNull();
  });

  it('drops an anchor that names nobody', async () => {
    const db = dbWithFamily();
    await run(db, { data: siblingRequest({ anchorStudentIds: ['pco_7', 'made-up'] }) });
    expect(recordFor(db).anchorStudentIds).toEqual(['pco_7']);
  });

  it('refuses when every claimed sibling turns out to be nobody', async () => {
    const db = dbWithFamily();
    await expect(run(db, { data: siblingRequest({ anchorStudentIds: ['made-up'] }) })).rejects.toThrow(
      RegistrationInputError,
    );
  });


  it('still needs an adult when no siblings are claimed', () => {
    expect(() => parseRegisterFamilyRequest(siblingRequest({ anchorStudentIds: [] }))).toThrow(
      RegistrationInputError,
    );
  });
});

describe('where the parent is, and is not', () => {
  it('keeps the guardian off every student document', async () => {
    const db = dbWithEvent();
    const result = await run(db);

    const students = JSON.stringify(
      result.children.map((child) => db.get(`students/${child.studentId}`)),
    );
    // `noMirroredPersonalData` forbids both on a student, and this is that
    // claim one layer up. The registration document is the *only* place either
    // may wait, and it is deny-all to clients and deleted on review.
    expect(students).not.toContain('5550103344');
    expect(students).not.toContain('Dana');
  });

  it('holds them on the registration document, and nowhere else', async () => {
    const db = dbWithEvent();
    await run(db);

    const elsewhere = [...db.data.entries()].filter(
      ([path]) => !path.startsWith(REGISTRATIONS_COLLECTION),
    );
    expect(JSON.stringify(elsewhere)).not.toContain('5550103344');
    // Four digits, which is the bargain that lets the index exist at all.
    expect(JSON.stringify(elsewhere)).toContain('3344');
  });
});

/**
 * What a registration announces to the other kiosks.
 *
 * The kiosk the family is standing at already holds the answer locally; the
 * pulse is for every other lobby screen, and for the QR screen the family is
 * about to walk back to. See kiosk/pulse.ts.
 */
describe('the pulse', () => {
  function channelRevs(db: FakeFirestore): Record<string, unknown> {
    const held = db.get(PULSE_DOC) ?? {};
    return {
      roster: (held.roster as { rev?: number } | undefined)?.rev,
      phones: (held.phones as { rev?: number } | undefined)?.rev,
      registration: (held.registration as { rev?: number } | undefined)?.rev,
    };
  }

  it('announces a registration on roster and phones, and nothing else', async () => {
    const db = dbWithEvent();
    await run(db);

    const revs = channelRevs(db);
    expect(revs.roster).toBeDefined();
    expect(revs.phones).toBeDefined();
    // The retired QR flow's channel is never written by anything again.
    expect(revs.registration).toBeUndefined();
  });



  it('does not re-announce a replay of a completed registration', async () => {
    const db = dbWithEvent();
    await run(db);
    const first = channelRevs(db);

    await run(db);
    expect(channelRevs(db)).toEqual(first);
  });

  it('announces a sibling registration with no digits on roster alone', async () => {
    const db = dbWithEvent();
    db.seed('students/pco_44', { status: 'active', firstName: 'Amara', lastName: 'Osei' });

    await run(db, {
      data: goodRequest({
        children: [{ firstName: 'Kofi', lastName: 'Osei', grade: 2 }],
        guardian: null,
        anchorStudentIds: ['pco_44'],
      }),
    });

    const revs = channelRevs(db);
    expect(revs.roster).toBeDefined();
    // No digits reached the index, so there is nothing for the phones channel
    // to announce.
    expect(revs.phones).toBeUndefined();
  });
});
