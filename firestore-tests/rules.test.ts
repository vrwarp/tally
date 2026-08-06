/**
 * Firestore rules suite (PRD 4.5).
 *
 * Each `describe` names one collection so a red test names the rule that broke.
 * The recurring shape is: who may read, who may write, and which shape
 * constraints hold regardless of role — the last being where the interesting
 * bugs live, because a counselor's UI never tries to forge a `pcoPersonId` but
 * a compromised browser would.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  arrayRemove,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  deleteField,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';
import { COLLECTIONS, paths } from '@/lib/paths';
import {
  ID,
  UID,
  a32ConfigDoc,
  asAnonymous,
  asKiosk,
  asUser,
  attendanceDoc,
  eventDoc,
  initTestEnv,
  invitationDoc,
  pcoConfigDoc,
  rsvpDoc,
  seedAll,
  settingsDoc,
  studentDoc,
  userDoc,
} from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedAll(env);
});

describe('unauthenticated access', () => {
  it('denies every read', async () => {
    const db = asAnonymous(env);
    await assertFails(getDoc(doc(db, paths.student(ID.student))));
    await assertFails(getDoc(doc(db, paths.event(ID.event))));
    await assertFails(getDoc(doc(db, paths.user(UID.counselor))));
    await assertFails(getDoc(doc(db, paths.settings())));
  });

  it('denies every write', async () => {
    const db = asAnonymous(env);
    await assertFails(setDoc(doc(db, paths.student('student-anon')), studentDoc()));
    await assertFails(setDoc(doc(db, paths.event('event-anon')), eventDoc()));
    await assertFails(
      setDoc(doc(db, paths.attendance(ID.event, ID.otherStudent)), attendanceDoc()),
    );
    await assertFails(setDoc(doc(db, paths.settings()), settingsDoc()));
  });
});

describe('authorisation gate', () => {
  it('denies a signed-in user with no users document (the pending state)', async () => {
    const db = asUser(env, UID.stranger);
    await assertFails(getDoc(doc(db, paths.student(ID.student))));
    await assertFails(getDocs(collection(db, paths.events())));
    await assertFails(setDoc(doc(db, paths.student('student-new')), studentDoc()));
  });

  it('lets a pending user read their own (missing) profile so AuthProvider can resolve', async () => {
    const db = asUser(env, UID.stranger);
    await assertSucceeds(getDoc(doc(db, paths.user(UID.stranger))));
  });

  it('denies a user whose profile is active:false', async () => {
    const db = asUser(env, UID.inactive);
    await assertFails(getDoc(doc(db, paths.student(ID.student))));
    await assertFails(getDoc(doc(db, paths.settings())));
    await assertFails(
      setDoc(doc(db, paths.attendance(ID.event, ID.otherStudent)), attendanceDoc()),
    );
  });

  it('still lets a deactivated user read their own profile', async () => {
    const db = asUser(env, UID.inactive);
    await assertSucceeds(getDoc(doc(db, paths.user(UID.inactive))));
  });
});

describe('users', () => {
  it('lets any authorised user list the team', async () => {
    await assertSucceeds(getDocs(collection(asUser(env, UID.counselor), paths.users())));
  });

  it('denies listing the team to a pending user', async () => {
    await assertFails(getDocs(collection(asUser(env, UID.stranger), paths.users())));
  });

  it('lets a user stamp their own lastSeenAt', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      updateDoc(doc(db, paths.user(UID.counselor)), { lastSeenAt: new Date() }),
    );
  });

  it('rejects a counselor touching a field outside the heartbeat', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.user(UID.counselor)), { displayName: 'Renamed' }),
    );
  });

  it('rejects a counselor stamping the heartbeat on someone else', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.user(UID.core)), { lastSeenAt: new Date() }),
    );
  });

  it('rejects a counselor smuggling a role change alongside the heartbeat', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.user(UID.counselor)), {
        lastSeenAt: new Date(),
        role: 'admin',
      }),
    );
  });

  it('rejects a counselor promoting themselves', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(updateDoc(doc(db, paths.user(UID.counselor)), { role: 'admin' }));
  });

  it('rejects a counselor reactivating themselves', async () => {
    const db = asUser(env, UID.inactive);
    await assertFails(updateDoc(doc(db, paths.user(UID.inactive)), { active: true }));
  });

  it('rejects a counselor editing anything else on their own document', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.user(UID.counselor)), { displayName: 'Sam the Admin' }),
    );
  });

  it("rejects a counselor writing another user's document", async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(updateDoc(doc(db, paths.user(UID.core)), { role: 'counselor' }));
  });

  it('rejects a core member granting roles', async () => {
    const db = asUser(env, UID.core);
    await assertFails(updateDoc(doc(db, paths.user(UID.counselor)), { role: 'core' }));
  });

  it("lets an admin change another user's role", async () => {
    const db = asUser(env, UID.admin);
    await assertSucceeds(updateDoc(doc(db, paths.user(UID.counselor)), { role: 'core' }));
  });

  it('lets an admin invite a new team member', async () => {
    const db = asUser(env, UID.admin);
    await assertSucceeds(
      setDoc(doc(db, paths.user('uid-new')), userDoc({ email: 'new@example.org' })),
    );
  });

  it('rejects an unknown role value', async () => {
    const db = asUser(env, UID.admin);
    await assertFails(updateDoc(doc(db, paths.user(UID.counselor)), { role: 'superuser' }));
  });

  it('rejects an admin changing their own role or active flag', async () => {
    const db = asUser(env, UID.admin);
    await assertFails(updateDoc(doc(db, paths.user(UID.admin)), { role: 'counselor' }));
    await assertFails(updateDoc(doc(db, paths.user(UID.admin)), { active: false }));
  });
});

/**
 * The allowlist that decides who may sign in at all.
 *
 * It moved out of Planning Center because a List is generated from filter
 * rules, so "these particular twelve adults may see a roster of minors" was
 * only expressible by inventing a custom field on every person in the church —
 * an access decision stored in a system edited by a different set of people
 * from the ones who should be making it.
 */
describe('invitations', () => {
  const key = 'newcomer@example,org';

  it('lets an admin invite somebody', async () => {
    const db = asUser(env, UID.admin);
    await assertSucceeds(setDoc(doc(db, paths.invitation(key)), invitationDoc()));
    await assertSucceeds(getDoc(doc(db, paths.invitation(key))));
    await assertSucceeds(deleteDoc(doc(db, paths.invitation(key))));
  });

  it('keeps the list away from the core team, let alone counselors', async () => {
    /*
     * Not a hierarchy oversight. This is a list of church staff email
     * addresses and who may do what with a roster of minors; the core team runs
     * the ministry, and granting access is a different job from running it.
     */
    for (const uid of [UID.core, UID.counselor]) {
      const db = asUser(env, uid);
      await assertFails(getDocs(collection(db, paths.invitations())));
      await assertFails(setDoc(doc(db, paths.invitation(key)), invitationDoc()));
    }
  });

  it('rejects a role nobody wrote code for', async () => {
    // The invitation decides the role somebody arrives with, so a made-up value
    // here is an attempt to arrive as something the app does not model.
    await assertFails(
      setDoc(
        doc(asUser(env, UID.admin), paths.invitation(key)),
        invitationDoc({ role: 'superuser' as never }),
      ),
    );
  });

  it('rejects an invitation with no address on it', async () => {
    await assertFails(
      setDoc(doc(asUser(env, UID.admin), paths.invitation(key)), invitationDoc({ email: '' })),
    );
  });

  it('refuses fields the shape does not admit', async () => {
    // Closed on purpose: an invitation is an access decision, and a field
    // nobody validates is a field somebody will later trust.
    await assertFails(
      setDoc(doc(asUser(env, UID.admin), paths.invitation(key)), {
        ...invitationDoc(),
        grantsEverything: true,
      }),
    );
  });

  it('lets an admin pause an invitation without retyping it in September', async () => {
    const db = asUser(env, UID.admin);
    await assertSucceeds(setDoc(doc(db, paths.invitation(key)), invitationDoc()));
    await assertSucceeds(setDoc(doc(db, paths.invitation(key)), invitationDoc({ active: false })));
  });
});

describe('students', () => {
  it('lets a counselor read the roster', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(getDoc(doc(db, paths.student(ID.student))));
    await assertSucceeds(getDocs(collection(db, paths.students())));
  });

  it('lets a counselor quick-add a student with no Planning Center id', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      setDoc(
        doc(db, paths.student('student-new')),
        studentDoc({ isVisitor: true, pcoPersonId: null, pcoPushPending: true }),
      ),
    );
  });

  it('rejects a forged pcoPersonId on create', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(doc(db, paths.student('student-forged')), studentDoc({ pcoPersonId: 'pco-999' })),
    );
  });

  it('rejects claiming a pcoPersonId on update', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(updateDoc(doc(db, paths.student(ID.student)), { pcoPersonId: 'pco-999' }));
  });

  /*
   * The generic linkage pair is the same claim in its backend-agnostic shape
   * — `upstreamBackend: 'a32'` binds a Tally row onto a person in the
   * Attendees database exactly the way a forged `pcoPersonId` would bind one
   * onto a Planning Center person. Server-written only, both halves.
   */
  it('rejects a forged upstream linkage on create', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(
        doc(db, paths.student('student-forged-upstream')),
        { ...studentDoc({ pcoPersonId: null }), upstreamBackend: 'a32', upstreamPersonId: '9f0c' },
      ),
    );
  });

  it('rejects claiming an upstream linkage on update', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), {
        upstreamBackend: 'a32',
        upstreamPersonId: '9f0c',
      }),
    );
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { upstreamPersonId: '9f0c' }),
    );
  });

  /*
   * The mirror removal, made enforceable.
   *
   * Parent contact and allergies live in Planning Center and nowhere else. A
   * future screen that "just" saves a phone number here would be rebuilding the
   * copy this design exists to remove — one document at a time, and without
   * anybody deciding to. The database says no, so it cannot happen quietly.
   */
  it('refuses to store a minor\'s parent contact', async () => {
    const db = asUser(env, UID.counselor);

    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { parentPhone: '555-0100' }),
    );
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { parentEmail: 'parent@example.org' }),
    );
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { parentName: 'Alex Rivera' }),
    );
  });

  it('refuses to store medical notes', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(updateDoc(doc(db, paths.student(ID.student)), { allergies: 'Peanuts' }));
  });

  it('refuses them on create too, not only on update', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(doc(db, paths.student('student-contact')), {
        ...studentDoc(),
        parentPhone: '555-0100',
      }),
    );
  });

  it('lets a counselor annotate a Planning Center student', async () => {
    // `students/pco_*` documents are created on demand — most students never
    // have one until somebody annotates them or checks them in.
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      setDoc(doc(db, paths.student('pco_4100010')), {
        firstName: 'Amara',
        lastName: 'Okonkwo',
        grade: 8,
        searchName: 'amara okonkwo',
        notes: 'Plays trumpet.',
        updatedAt: new Date(),
        updatedBy: UID.counselor,
      }),
    );
  });

  it('lets check-in stamp the attendance dates', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      updateDoc(doc(db, paths.student(ID.student)), {
        firstAttendedAt: new Date(),
        lastAttendedAt: new Date(),
      }),
    );
  });

  it('rejects grades outside K..12', async () => {
    const db = asUser(env, UID.counselor);
    // Off-model on purpose: `Grade` makes these unrepresentable in TypeScript,
    // which is exactly why the rule has to say it too. Below kindergarten
    // there is no grade at all — that is an absent field, not a negative one.
    await assertFails(
      setDoc(doc(db, paths.student('student-gneg')), { ...studentDoc(), grade: -1 }),
    );
    await assertFails(
      setDoc(doc(db, paths.student('student-g13')), { ...studentDoc(), grade: 13 }),
    );
  });

  it('accepts the boundary grades', async () => {
    const db = asUser(env, UID.counselor);
    // 0 is kindergarten — a children's ministry roster, on the same rules.
    await assertSucceeds(setDoc(doc(db, paths.student('student-gk')), studentDoc({ grade: 0 })));
    await assertSucceeds(setDoc(doc(db, paths.student('student-g12')), studentDoc({ grade: 12 })));
  });

  it('rejects an empty name', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(setDoc(doc(db, paths.student('student-blank')), studentDoc({ firstName: '' })));
    await assertFails(
      setDoc(doc(db, paths.student('student-blank2')), studentDoc({ lastName: '' })),
    );
  });

  it('rejects an unknown status', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(updateDoc(doc(db, paths.student(ID.student)), { status: 'archived' }));
  });

  it('lets a counselor deactivate a student', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(updateDoc(doc(db, paths.student(ID.student)), { status: 'inactive' }));
  });

  it('denies deletion to everyone, because attendance references students', async () => {
    await assertFails(deleteDoc(doc(asUser(env, UID.counselor), paths.student(ID.student))));
    await assertFails(deleteDoc(doc(asUser(env, UID.core), paths.student(ID.student))));
    await assertFails(deleteDoc(doc(asUser(env, UID.admin), paths.student(ID.student))));
  });
});

describe('events', () => {
  it('lets a counselor read events but not write them', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(getDoc(doc(db, paths.event(ID.event))));
    await assertFails(setDoc(doc(db, paths.event('event-new')), eventDoc()));
    await assertFails(updateDoc(doc(db, paths.event(ID.event)), { startAt: new Date() }));
    await assertFails(deleteDoc(doc(db, paths.event(ID.event))));
  });

  it('lets core create and update events', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(setDoc(doc(db, paths.event('event-new')), eventDoc()));
    await assertSucceeds(updateDoc(doc(db, paths.event(ID.event)), { title: 'Renamed' }));
  });

  /**
   * Deleting a gathering is offered — it just cannot happen from a browser.
   *
   * The document is only half of a gathering; its attendance is a subcollection
   * that a document delete leaves standing, unreachable and still counted. So
   * the whole act goes through `deleteEvents`, which runs on the Admin SDK and
   * bypasses this rule, and the rule closes the half-way door behind it.
   */
  it('lets nobody delete an event from a client, including an admin', async () => {
    await assertFails(deleteDoc(doc(asUser(env, UID.core), paths.event(ID.event))));
    await assertFails(deleteDoc(doc(asUser(env, UID.admin), paths.event(ID.event))));
  });

  it('rejects a non-timestamp schedule', async () => {
    const db = asUser(env, UID.core);
    await assertFails(updateDoc(doc(db, paths.event(ID.event)), { startAt: '2026-02-13' }));
  });

  it('rejects an unknown mode', async () => {
    const db = asUser(env, UID.core);
    await assertFails(
      setDoc(doc(db, paths.event('event-bad')), { ...eventDoc(), mode: 'retreat' }),
    );
  });

  it('accepts an event that does not repeat', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.event('event-plain')), { ...eventDoc(), recurrence: null }),
    );
  });

  it('rejects a malformed recurrence rule', async () => {
    const db = asUser(env, UID.core);
    const base = eventDoc().recurrence!;

    for (const recurrence of [
      { ...base, frequency: 'fortnightly' },
      { ...base, interval: 0 },
      { ...base, interval: 'weekly' },
      { ...base, weekdays: 'MO' },
      { ...base, monthlyMode: 'whenever' },
      // RFC 5545: an end date and an occurrence tally must not both apply.
      { ...base, until: '2026-10-20', count: 13 },
      'weekly',
    ]) {
      await assertFails(
        setDoc(doc(db, paths.event('event-bad-recurrence')), { ...eventDoc(), recurrence }),
      );
    }
  });

  it('accepts a gathering that prints no label', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.event('event-no-label')), { ...eventDoc(), labelTemplate: null }),
    );
  });

  it('accepts a well-formed label template', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.event('event-labelled')), {
        ...eventDoc(),
        labelTemplate: DEFAULT_LABEL_TEMPLATE,
      }),
    );
  });

  it('rejects a malformed label template', async () => {
    // The client expands this on a shelf in a lobby with nobody watching, so
    // the shape is pinned here as well as in lib/labelTemplate.ts.
    const db = asUser(env, UID.core);

    for (const labelTemplate of [
      { ...DEFAULT_LABEL_TEMPLATE, lines: 'the name' },
      // Empty means "prints nothing", which is written as null, not as this.
      { ...DEFAULT_LABEL_TEMPLATE, lines: [] },
      { ...DEFAULT_LABEL_TEMPLATE, lines: Array.from({ length: 7 }, () => ({ text: 'x' })) },
      { ...DEFAULT_LABEL_TEMPLATE, copies: 0 },
      { ...DEFAULT_LABEL_TEMPLATE, copies: 99 },
      { ...DEFAULT_LABEL_TEMPLATE, copies: 'two' },
      { lines: DEFAULT_LABEL_TEMPLATE.lines },
      'the first name, big',
    ]) {
      await assertFails(
        setDoc(doc(db, paths.event('event-bad-label')), { ...eventDoc(), labelTemplate }),
      );
    }
  });
});

describe('attendance', () => {
  it('lets a counselor check a student in', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      setDoc(
        doc(db, paths.attendance(ID.event, ID.otherStudent)),
        attendanceDoc({ studentId: ID.otherStudent, checkedInBy: UID.counselor }),
      ),
    );
  });

  it('rejects a document whose id does not match studentId', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(
        doc(db, paths.attendance(ID.event, ID.otherStudent)),
        attendanceDoc({ studentId: ID.student, checkedInBy: UID.counselor }),
      ),
    );
  });

  it('rejects an eventId that does not match the parent event', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(
        doc(db, paths.attendance(ID.event, ID.otherStudent)),
        attendanceDoc({ studentId: ID.otherStudent, eventId: 'event-elsewhere' }),
      ),
    );
  });

  it("rejects checking someone in under another counselor's uid", async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(
        doc(db, paths.attendance(ID.event, ID.otherStudent)),
        attendanceDoc({ studentId: ID.otherStudent, checkedInBy: UID.core }),
      ),
    );
  });

  /*
   * `arrivalId` decides which siblings a pickup screen arrives pre-ticked for,
   * and the only thing that writes it is an unattended screen in a lobby. So
   * the shape is the database's business: an opaque bounded string, absent, or
   * refused.
   */
  it('takes an arrival id, and takes its absence', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      setDoc(
        doc(db, paths.attendance(ID.event, ID.otherStudent)),
        { ...attendanceDoc({ studentId: ID.otherStudent }), arrivalId: 'a-9f0c3d' },
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(db, paths.attendance(ID.event, ID.otherStudent)),
        attendanceDoc({ studentId: ID.otherStudent }),
      ),
    );
  });

  it('refuses an arrival id that is not an opaque bounded string', async () => {
    const db = asUser(env, UID.counselor);
    const record = attendanceDoc({ studentId: ID.otherStudent });
    const at = doc(db, paths.attendance(ID.event, ID.otherStudent));

    // A list here would be a lobby session smuggling structure into a read the
    // next parent acts on.
    await assertFails(setDoc(at, { ...record, arrivalId: [ID.student] }));
    await assertFails(setDoc(at, { ...record, arrivalId: { id: 'a-1' } }));
    await assertFails(setDoc(at, { ...record, arrivalId: 7 }));
    await assertFails(setDoc(at, { ...record, arrivalId: '' }));
    await assertFails(setDoc(at, { ...record, arrivalId: 'a'.repeat(65) }));
  });

  it('lets a counselor read and undo a check-in', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(getDocs(collection(db, paths.attendanceCollection(ID.event))));
    await assertSucceeds(deleteDoc(doc(db, paths.attendance(ID.event, ID.student))));
  });

  it('denies attendance to unauthorised callers', async () => {
    await assertFails(
      getDocs(collection(asAnonymous(env), paths.attendanceCollection(ID.event))),
    );
    await assertFails(
      getDocs(collection(asUser(env, UID.stranger), paths.attendanceCollection(ID.event))),
    );
  });

  /*
   * The collection-group read behind a student's full history.
   *
   * It needs a rule at a wildcard path — the nested rule above cannot authorise
   * a collection-group query however permissive it is — so this is the test
   * that the wildcard exists and is scoped to the same people.
   */
  it('lets an active member read one student\u2019s attendance across every event', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(db, COLLECTIONS.attendance),
          where('studentId', '==', ID.student),
          orderBy('checkedInAt', 'desc'),
        ),
      ),
    );
  });

  it('denies that same sweep to everyone else', async () => {
    for (const db of [asAnonymous(env), asUser(env, UID.stranger)]) {
      await assertFails(
        getDocs(
          query(
            collectionGroup(db, COLLECTIONS.attendance),
            where('studentId', '==', ID.student),
            orderBy('checkedInAt', 'desc'),
          ),
        ),
      );
    }
  });
});

/**
 * Recording that somebody collected a child.
 *
 * `ID.student` is seeded as already checked in, by `UID.counselor`. The claim
 * that matters most here is the first one: the volunteer who takes a child in
 * is rarely the one who hands them back, so a check-out must not be gated on
 * `checkedInBy == uid` the way an ordinary attendance update is.
 */
describe('check-out', () => {
  it('lets a different counselor record the pickup', async () => {
    await assertSucceeds(
      updateDoc(doc(asUser(env, UID.core), paths.attendance(ID.event, ID.student)), {
        checkedOutAt: serverTimestamp(),
        checkedOutBy: UID.core,
      }),
    );
  });

  it('refuses a pickup recorded under somebody else\'s name', async () => {
    await assertFails(
      updateDoc(doc(asUser(env, UID.core), paths.attendance(ID.event, ID.student)), {
        checkedOutAt: serverTimestamp(),
        checkedOutBy: UID.counselor,
      }),
    );
  });

  it('refuses a check-out that also rewrites the check-in', async () => {
    // The whole point of the narrow key set: the rest of the record is a fact
    // about the arrival and has to survive being handed to a second volunteer.
    //
    // Deliberately not testing `checkedInBy` here. Claiming a record as your
    // own has always been a legal *ordinary* attendance update — `validAttendance`
    // asks only that the caller name themselves — so it succeeds by that path
    // rather than this one, and asserting otherwise would be asserting a rule
    // Tally does not have.
    for (const extra of [
      { checkedInAt: serverTimestamp() },
      { method: 'manual' },
      { isFirstEver: true },
    ]) {
      await assertFails(
        updateDoc(doc(asUser(env, UID.core), paths.attendance(ID.event, ID.student)), {
          checkedOutAt: serverTimestamp(),
          checkedOutBy: UID.core,
          ...extra,
        }),
      );
    }
  });

  it('lets a counselor put somebody back in the room', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      updateDoc(doc(db, paths.attendance(ID.event, ID.student)), {
        checkedOutAt: serverTimestamp(),
        checkedOutBy: UID.core,
      }),
    );
    // Both fields deleted, naming nobody — which is why the authorship check
    // only applies when a time is being written.
    await assertSucceeds(
      updateDoc(doc(db, paths.attendance(ID.event, ID.student)), {
        checkedOutAt: deleteField(),
        checkedOutBy: deleteField(),
      }),
    );
  });

  it('refuses a pickup for a child nobody checked in', async () => {
    // `updateDoc` on a document that does not exist. A half-record invented by
    // a pickup is a bug, not a shortcut.
    await assertFails(
      updateDoc(doc(asUser(env, UID.core), paths.attendance(ID.event, ID.otherStudent)), {
        checkedOutAt: serverTimestamp(),
        checkedOutBy: UID.core,
      }),
    );
  });

  it('refuses one from somebody with no role at all', async () => {
    await assertFails(
      updateDoc(doc(asUser(env, UID.stranger), paths.attendance(ID.event, ID.student)), {
        checkedOutAt: serverTimestamp(),
        checkedOutBy: UID.stranger,
      }),
    );
  });
});

describe('the check-in freeze (pcoRecordMissing)', () => {
  /** Server-writes a student whose Planning Center record is known gone. */
  async function seedFrozenStudent(studentId: string): Promise<void> {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), paths.student(studentId)),
        studentDoc({ pcoPersonId: '77001', pcoPushPending: false, pcoRecordMissing: true }),
      );
    });
  }

  it('refuses to check a frozen student in — past events included', async () => {
    await seedFrozenStudent(ID.otherStudent);
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(
        doc(db, paths.attendance(ID.event, ID.otherStudent)),
        attendanceDoc({ studentId: ID.otherStudent, checkedInBy: UID.counselor }),
      ),
    );
  });

  it('refuses to undo a frozen student’s existing check-in', async () => {
    await seedFrozenStudent(ID.student);
    const db = asUser(env, UID.counselor);
    await assertFails(deleteDoc(doc(db, paths.attendance(ID.event, ID.student))));
  });

  it('still lets a student with no document be checked in (quick-add creates it)', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      setDoc(
        doc(db, paths.attendance(ID.event, 'brand-new-student')),
        attendanceDoc({ studentId: 'brand-new-student', checkedInBy: UID.counselor }),
      ),
    );
  });

  it('rejects a client asserting the flag on create', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(
        doc(db, paths.student('forged-frozen')),
        studentDoc({ pcoRecordMissing: true }),
      ),
    );
  });

  it('rejects a client thawing the flag by update', async () => {
    await seedFrozenStudent(ID.otherStudent);
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.student(ID.otherStudent)), { pcoRecordMissing: false }),
    );
  });

  it('rejects a client freezing somebody else by update', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { pcoRecordMissing: true }),
    );
  });
});

describe('the review hold (pendingReview)', () => {
  /*
   * The hold is the *only* thing that keeps a self-registered family out of the
   * church's people database (functions/src/backends/pendingReview.ts). A
   * client that could clear it would have a direct, unreviewed line into
   * Planning Center; one that could set it could quietly freeze a student a
   * leader added by hand. Neither direction, then — and the database is what
   * says so, not a reviewer.
   */
  async function seedHeldStudent(studentId: string): Promise<void> {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), paths.student(studentId)),
        studentDoc({ pcoPushPending: true, pendingReview: true }),
      );
    });
  }

  it('rejects a client holding a student it creates', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(doc(db, paths.student('forged-hold')), studentDoc({ pendingReview: true })),
    );
  });

  it('rejects a client approving a held student itself', async () => {
    await seedHeldStudent(ID.otherStudent);
    const db = asUser(env, UID.admin);
    await assertFails(
      updateDoc(doc(db, paths.student(ID.otherStudent)), { pendingReview: false }),
    );
  });

  it('rejects a kiosk clearing its own registration’s hold', async () => {
    await seedHeldStudent(ID.otherStudent);
    const db = asKiosk(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.student(ID.otherStudent)), { pendingReview: false }),
    );
  });

  it('still lets an ordinary edit through on a held student', async () => {
    await seedHeldStudent(ID.otherStudent);
    const db = asUser(env, UID.counselor);
    // A counselor correcting a name must not be blocked by the hold: it gates
    // the push, not the roster.
    await assertSucceeds(
      updateDoc(doc(db, paths.student(ID.otherStudent)), { firstName: 'Robin' }),
    );
  });
});

describe('rsvps', () => {
  it('rejects a counselor changing the RSVP status', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(updateDoc(doc(db, paths.rsvp(ID.event, ID.student)), { status: 'no' }));
  });

  it('rejects a counselor adding or removing someone from the trip', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(
        doc(db, paths.rsvp(ID.event, ID.otherStudent)),
        rsvpDoc({ studentId: ID.otherStudent }),
      ),
    );
    await assertFails(deleteDoc(doc(db, paths.rsvp(ID.event, ID.student))));
  });

  it('lets core create, restatus and delete RSVPs', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(
        doc(db, paths.rsvp(ID.event, ID.otherStudent)),
        rsvpDoc({ studentId: ID.otherStudent }),
      ),
    );
    await assertSucceeds(updateDoc(doc(db, paths.rsvp(ID.event, ID.student)), { status: 'no' }));
    await assertSucceeds(deleteDoc(doc(db, paths.rsvp(ID.event, ID.student))));
  });

  it('rejects an RSVP whose id does not match studentId', async () => {
    const db = asUser(env, UID.core);
    await assertFails(
      setDoc(doc(db, paths.rsvp(ID.event, ID.otherStudent)), rsvpDoc({ studentId: ID.student })),
    );
  });

  it('lets any authorised user read RSVPs', async () => {
    await assertSucceeds(
      getDocs(collection(asUser(env, UID.counselor), paths.rsvpCollection(ID.event))),
    );
  });
});

describe('reference data', () => {
  it('lets counselors read the series but not write them', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(getDocs(collection(db, paths.eventSeries())));
    await assertFails(
      setDoc(doc(db, paths.series('series-new')), {
        title: 'Wednesday',
        dayOfWeek: 3,
        startTime: '19:00',
        endTime: '21:00',
        checkInOpensMinutesBefore: 60,
        checkInClosesMinutesAfter: 60,
        active: true,
        order: 2,
      }),
    );
  });

  it('lets core write the series', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.series('series-new')), {
        title: 'Wednesday',
        dayOfWeek: 3,
        startTime: '19:00',
        endTime: '21:00',
        checkInOpensMinutesBefore: 60,
        checkInClosesMinutesAfter: 60,
        active: true,
        order: 2,
      }),
    );
  });
});

describe('config/settings', () => {
  it('lets any authorised user read settings', async () => {
    await assertSucceeds(getDoc(doc(asUser(env, UID.counselor), paths.settings())));
  });

  it('rejects a counselor writing settings', async () => {
    await assertFails(setDoc(doc(asUser(env, UID.counselor), paths.settings()), settingsDoc()));
  });

  it('lets core write settings', async () => {
    await assertSucceeds(setDoc(doc(asUser(env, UID.core), paths.settings()), settingsDoc()));
  });

  it('rejects a window smaller than the threshold it gates', async () => {
    const db = asUser(env, UID.core);
    await assertFails(
      setDoc(
        doc(db, paths.settings()),
        settingsDoc({ predictiveMinAttended: 4, predictiveOfLastN: 3 }),
      ),
    );
  });

  it('rejects a zero threshold', async () => {
    const db = asUser(env, UID.core);
    await assertFails(
      setDoc(
        doc(db, paths.settings()),
        settingsDoc({ predictiveMinAttended: 0, predictiveOfLastN: 3 }),
      ),
    );
  });
});

/**
 * The Planning Center settings, which are the closest thing Tally has to a
 * control that reaches outside itself: they decide which children the app can
 * see, and how much of the church's permanent database it may write to.
 */
describe('config/planningCenter', () => {
  it('lets core read and write the settings', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc()));
    await assertSucceeds(getDoc(doc(db, paths.planningCenter())));
  });

  it('keeps it away from counselors entirely', async () => {
    // Nothing a door volunteer's screen does depends on this document — the
    // server resolves the configuration before answering any callable — so
    // there is no reason for their device to hold it.
    const db = asUser(env, UID.counselor);
    await assertFails(getDoc(doc(db, paths.planningCenter())));
    await assertFails(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc()));
  });

  it('rejects a write-back mode nobody wrote code for', async () => {
    // The stakes are asymmetric: an unrecognised mode that fell through to
    // `full` would start editing the church's real people database.
    await assertFails(
      setDoc(
        doc(asUser(env, UID.core), paths.planningCenter()),
        pcoConfigDoc({ writeBack: 'everything' as never }),
      ),
    );
  });

  it('rejects a grade band outside the grades the app understands', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ minGrade: -1 })));
    await assertFails(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ maxGrade: 13 })));
  });

  it('rejects a band whose top is below its bottom', async () => {
    await assertFails(
      setDoc(
        doc(asUser(env, UID.core), paths.planningCenter()),
        pcoConfigDoc({ minGrade: 10, maxGrade: 8 }),
      ),
    );
  });

  it('refuses to let a cache become a mirror', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ cacheTtlSeconds: 86_400 })));
    await assertFails(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ cacheTtlSeconds: -1 })));
  });

  it('stops the core team pointing Tally at another host', async () => {
    /*
     * The API root decides where the church's Personal Access Token gets sent
     * on every request. Core team runs the ministry; choosing the address the
     * credentials travel to is an admin decision.
     */
    await assertFails(
      setDoc(
        doc(asUser(env, UID.core), paths.planningCenter()),
        pcoConfigDoc({ baseUrl: 'https://not-planning-center.example/people/v2' }),
      ),
    );
  });

  it('lets an admin set the API root, and only to an http(s) address', async () => {
    const db = asUser(env, UID.admin);
    await assertSucceeds(
      setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ baseUrl: 'https://proxy.example.org/people/v2' })),
    );
    await assertFails(
      setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ baseUrl: 'ftp://files.example.org' })),
    );
  });

  it('lets core keep editing everything else once an admin has set the root', async () => {
    // The guard is on *changing* the address, not on the document containing
    // one: otherwise one admin decision would lock the core team out of the
    // roster settings for good.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), paths.planningCenter()),
        pcoConfigDoc({ baseUrl: 'https://proxy.example.org/people/v2' }),
      );
    });

    await assertSucceeds(
      setDoc(
        doc(asUser(env, UID.core), paths.planningCenter()),
        pcoConfigDoc({ baseUrl: 'https://proxy.example.org/people/v2', minGrade: 7 }),
      ),
    );
  });

  it('never lets credentials into the document, whoever is asking', async () => {
    /*
     * The token pair lives in Secret Manager. A document a browser can write is
     * a document a browser can read, so an admin who could stash credentials
     * here would be handing them to every core-team device that opens Settings.
     */
    await assertFails(
      setDoc(doc(asUser(env, UID.admin), paths.planningCenter()), {
        ...pcoConfigDoc(),
        appId: 'app-id',
        secret: 'secret',
      }),
    );
  });
});

/**
 * The Attendees configuration document — the `config/planningCenter`
 * reasoning applied to the second backend, with the same sharp edge: the
 * base URL decides where the integration token gets sent.
 */
describe('config/attendees32', () => {
  it('lets core read and write the settings', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(setDoc(doc(db, paths.attendees32()), a32ConfigDoc()));
    await assertSucceeds(getDoc(doc(db, paths.attendees32())));
  });

  it('keeps it away from counselors entirely', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(getDoc(doc(db, paths.attendees32())));
    await assertFails(setDoc(doc(db, paths.attendees32()), a32ConfigDoc()));
  });

  it('rejects a write-back mode nobody wrote code for', async () => {
    await assertFails(
      setDoc(doc(asUser(env, UID.core), paths.attendees32()), a32ConfigDoc({ writeBack: 'everything' })),
    );
  });

  it('rejects a grade band outside the grades the app understands', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, paths.attendees32()), a32ConfigDoc({ minGrade: -1 })));
    await assertFails(setDoc(doc(db, paths.attendees32()), a32ConfigDoc({ maxGrade: 13 })));
  });

  it('refuses to let a cache become a mirror', async () => {
    await assertFails(
      setDoc(
        doc(asUser(env, UID.core), paths.attendees32()),
        a32ConfigDoc({ cacheTtlSeconds: 86_400 }),
      ),
    );
  });

  it('stops the core team pointing Tally at another host', async () => {
    // Every Attendees request carries the integration token; the address it
    // travels to is an admin decision, exactly like the Planning Center root.
    await assertFails(
      setDoc(
        doc(asUser(env, UID.core), paths.attendees32()),
        a32ConfigDoc({ baseUrl: 'https://attendees.example.org' }),
      ),
    );
  });

  it('lets an admin set the host, and only to an http(s) address', async () => {
    const db = asUser(env, UID.admin);
    await assertSucceeds(
      setDoc(doc(db, paths.attendees32()), a32ConfigDoc({ baseUrl: 'https://attendees.example.org' })),
    );
    await assertFails(
      setDoc(doc(db, paths.attendees32()), a32ConfigDoc({ baseUrl: 'ftp://files.example.org' })),
    );
  });

  it('never lets the token into the document, whoever is asking', async () => {
    await assertFails(
      setDoc(doc(asUser(env, UID.admin), paths.attendees32()), {
        ...a32ConfigDoc(),
        token: 'drf-token',
      }),
    );
  });
});

/** Cross-backend settings: one enum, closed shape, core-owned. */
describe('config/backends', () => {
  it('lets core choose where new students get pushed', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.backends()), { defaultPushBackend: 'a32', updatedAt: serverTimestamp(), updatedBy: UID.core }),
    );
    await assertSucceeds(getDoc(doc(db, paths.backends())));
  });

  it('rejects a backend nobody wrote code for', async () => {
    await assertFails(
      setDoc(doc(asUser(env, UID.core), paths.backends()), { defaultPushBackend: 'other' }),
    );
  });

  it('keeps the shape closed', async () => {
    await assertFails(
      setDoc(doc(asUser(env, UID.core), paths.backends()), {
        defaultPushBackend: 'pco',
        token: 'stashed',
      }),
    );
  });

  it('keeps it away from counselors', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(getDoc(doc(db, paths.backends())));
    await assertFails(setDoc(doc(db, paths.backends()), { defaultPushBackend: 'pco' }));
  });
});

/*
 * `config/pcoSync` and `accessRoster` had their own suites here.
 *
 * Both collections are gone: there is no scheduled sync to track, and the
 * allowlist is a live Planning Center lookup rather than a mirrored list. The
 * "default deny" suite below is what now covers them — an attempt to write
 * either path is an unmodelled collection, which is exactly the right answer.
 */

/**
 * Which nights nobody came to.
 *
 * Derived data with a counselor's name on the writes, which is unusual enough in
 * this ruleset to be worth pinning. The justification is that every claim in the
 * document can be re-derived from registers the same counselor may already read,
 * so the worst a forged entry can do is cost the reads it was meant to save — but
 * that only holds while the document stays derived, so the shape is checked and
 * wholesale deletion is refused.
 */
describe('skippedNights', () => {
  const chain = ID.series;
  const registry = (over: Record<string, unknown> = {}) => ({
    chainKey: chain,
    skipped: [],
    examinedFrom: Timestamp.fromDate(new Date('2025-08-02T00:00:00Z')),
    updatedAt: serverTimestamp(),
    ...over,
  });

  it('lets a counselor write down a chain it has just examined', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      setDoc(doc(db, paths.skippedNights(chain)), registry({ skipped: ['event-1'] })),
    );
  });

  it('lets a counselor clear one night without touching the rest', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      setDoc(doc(db, paths.skippedNights(chain)), registry({ skipped: ['event-1'] })),
    );
    await assertSucceeds(
      setDoc(
        doc(db, paths.skippedNights(chain)),
        { chainKey: chain, skipped: arrayRemove('event-1'), updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
  });

  it('lets any active member read it', async () => {
    await assertSucceeds(getDoc(doc(asUser(env, UID.counselor), paths.skippedNights(chain))));
    await assertSucceeds(getDoc(doc(asUser(env, UID.core), paths.skippedNights(chain))));
  });

  it('refuses somebody with no active membership', async () => {
    await assertFails(getDoc(doc(asUser(env, UID.inactive), paths.skippedNights(chain))));
    await assertFails(
      setDoc(doc(asUser(env, UID.inactive), paths.skippedNights(chain)), registry()),
    );
    await assertFails(setDoc(doc(asAnonymous(env), paths.skippedNights(chain)), registry()));
  });

  it('refuses a document filed under the wrong chain', async () => {
    // The id is the chain. A document whose body disagrees with its path would
    // answer for a gathering it is not about.
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(doc(db, paths.skippedNights(chain)), registry({ chainKey: 'some-other-chain' })),
    );
  });

  it('refuses a skipped list that is not a list', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(doc(db, paths.skippedNights(chain)), registry({ skipped: 'event-1' })),
    );
  });

  it('refuses a watermark that is not a timestamp', async () => {
    // The watermark is what separates "nobody came" from "nobody has looked".
    // A string there would be read as no coverage at best and misread at worst.
    const db = asUser(env, UID.counselor);
    await assertFails(
      setDoc(doc(db, paths.skippedNights(chain)), registry({ examinedFrom: 'last August' })),
    );
  });

  it('refuses deleting the whole chain, even for an admin', async () => {
    // Forgetting the document silently un-examines a year. Correcting one night
    // is removing one night.
    await assertSucceeds(
      setDoc(doc(asUser(env, UID.counselor), paths.skippedNights(chain)), registry()),
    );
    await assertFails(deleteDoc(doc(asUser(env, UID.admin), paths.skippedNights(chain))));
  });
});


describe('kiosk', () => {
  /*
   * A kiosk session is a real member's uid carrying `kiosk: true` — minted by
   * the pairing flow, operated by the public in a lobby. These tests pin the
   * narrowing: it may create a check-in and write the date patch that rides on
   * one, and nothing else a full session of the same person could do.
   */

  describe('kioskIndex', () => {
    it('is readable by active members, kiosk sessions included', async () => {
      await assertSucceeds(getDoc(doc(asUser(env, UID.counselor), 'kioskIndex/phones')));
      await assertSucceeds(getDoc(doc(asKiosk(env, UID.counselor), 'kioskIndex/phones')));
    });

    it('is denied to strangers and signed-out callers', async () => {
      await assertFails(getDoc(doc(asUser(env, UID.stranger), 'kioskIndex/phones')));
      await assertFails(getDoc(doc(asAnonymous(env), 'kioskIndex/phones')));
    });

    it('is written by nobody — a client that could write it could make any four digits answer any student', async () => {
      await assertFails(
        setDoc(doc(asUser(env, UID.admin), 'kioskIndex/phones'), { last4: { '0134': ['x'] } }),
      );
      await assertFails(
        setDoc(doc(asKiosk(env, UID.counselor), 'kioskIndex/phones'), { last4: {} }),
      );
    });
  });

  describe('kioskPairings', () => {
    it('is invisible and untouchable, admins included', async () => {
      const db = asUser(env, UID.admin);
      await assertFails(getDoc(doc(db, 'kioskPairings/ABC234')));
      await assertFails(setDoc(doc(db, 'kioskPairings/ABC234'), { status: 'approved' }));
      await assertFails(getDocs(collection(db, 'kioskPairings')));
    });
  });

  describe('kioskRegistrations', () => {
    it('is invisible and untouchable, kiosks and admins alike', async () => {
      // Readable, it would say which families registered today and how many
      // children each brought. Writable, somebody could pre-claim an id and
      // make a family's registration hand them a stranger's students.
      for (const db of [asUser(env, UID.admin), asKiosk(env, UID.counselor), asAnonymous(env)]) {
        await assertFails(getDoc(doc(db, 'kioskRegistrations/reg-1')));
        await assertFails(setDoc(doc(db, 'kioskRegistrations/reg-1'), { status: 'complete' }));
      }
      await assertFails(getDocs(collection(asUser(env, UID.admin), 'kioskRegistrations')));
    });
  });

  describe('kioskRegistrationCodes', () => {
    it('is invisible and untouchable, kiosks included', async () => {
      // Readable, a client could register against a code it never saw on a
      // screen — which is the one thing the code exists to require. Writable,
      // it could mint itself an unauthenticated path into the church's people
      // database.
      for (const db of [asUser(env, UID.admin), asKiosk(env, UID.counselor), asAnonymous(env)]) {
        await assertFails(getDoc(doc(db, 'kioskRegistrationCodes/ABC234')));
        await assertFails(setDoc(doc(db, 'kioskRegistrationCodes/ABC234'), { submissions: 0 }));
      }
      await assertFails(getDocs(collection(asUser(env, UID.admin), 'kioskRegistrationCodes')));
    });
  });

  describe('students, from a kiosk session', () => {
    /*
     * The pin that makes the registration callable necessary in the first
     * place. A kiosk may write the eight-key date patch a check-in rides on and
     * nothing else — so it cannot create a usable roster document itself, and a
     * compromised lobby screen cannot mint students carrying whatever it likes.
     *
     * If this test ever starts failing because somebody widened the key set to
     * "make registration simpler", the thing to widen instead is the callable.
     */
    it('may not create a student carrying the fields a registration needs', async () => {
      const db = asKiosk(env, UID.counselor);
      const base = {
        firstName: 'Robin',
        lastName: 'Fields',
        grade: 4,
        searchName: 'robin fields',
        updatedAt: serverTimestamp(),
        updatedBy: UID.counselor,
      };

      await assertFails(setDoc(doc(db, paths.student('lobby-invented')), { ...base, status: 'active' }));
      await assertFails(setDoc(doc(db, paths.student('lobby-invented')), { ...base, isVisitor: true }));
      await assertFails(
        setDoc(doc(db, paths.student('lobby-invented')), { ...base, pcoPushPending: true }),
      );
      await assertFails(
        setDoc(doc(db, paths.student('lobby-invented')), { ...base, registrationId: 'reg-1' }),
      );
    });
  });

  describe('attendance, from a kiosk session', () => {
    it('may create a check-in under its own uid', async () => {
      await assertSucceeds(
        setDoc(
          doc(asKiosk(env, UID.counselor), paths.attendance(ID.event, ID.otherStudent)),
          attendanceDoc({ studentId: ID.otherStudent, checkedInBy: UID.counselor }),
        ),
      );
    });

    it('may not overwrite an existing check-in — a lobby tap must not move a counselor\'s record', async () => {
      // ID.student is seeded as already checked in; the same write from the
      // full session would be a legal update. Narrowed rather than dropped
      // when pickup arrived: a kiosk gained exactly one shape of update, and
      // this is still not it.
      await assertFails(
        setDoc(
          doc(asKiosk(env, UID.counselor), paths.attendance(ID.event, ID.student)),
          attendanceDoc({ studentId: ID.student, checkedInBy: UID.counselor }),
        ),
      );
    });

    it('may record a pickup that has not been recorded yet', async () => {
      await assertSucceeds(
        updateDoc(doc(asKiosk(env, UID.counselor), paths.attendance(ID.event, ID.student)), {
          checkedOutAt: serverTimestamp(),
          checkedOutBy: UID.counselor,
        }),
      );
    });

    it('may not move a pickup already standing', async () => {
      // Correcting a recorded collection is a staff decision made on the
      // roster, not something an unattended lobby screen does.
      const kiosk = asKiosk(env, UID.counselor);
      await assertSucceeds(
        updateDoc(doc(kiosk, paths.attendance(ID.event, ID.student)), {
          checkedOutAt: serverTimestamp(),
          checkedOutBy: UID.counselor,
        }),
      );
      await assertFails(
        updateDoc(doc(kiosk, paths.attendance(ID.event, ID.student)), {
          checkedOutAt: serverTimestamp(),
          checkedOutBy: UID.counselor,
        }),
      );
    });

    it('may not undo a pickup either — the kiosk offers no undo at all', async () => {
      const kiosk = asKiosk(env, UID.counselor);
      await assertSucceeds(
        updateDoc(doc(kiosk, paths.attendance(ID.event, ID.student)), {
          checkedOutAt: serverTimestamp(),
          checkedOutBy: UID.counselor,
        }),
      );
      await assertFails(
        updateDoc(doc(kiosk, paths.attendance(ID.event, ID.student)), {
          checkedOutAt: deleteField(),
          checkedOutBy: deleteField(),
        }),
      );
    });

    it('may not smuggle a check-in rewrite in beside a pickup', async () => {
      await assertFails(
        updateDoc(doc(asKiosk(env, UID.counselor), paths.attendance(ID.event, ID.student)), {
          checkedOutAt: serverTimestamp(),
          checkedOutBy: UID.counselor,
          method: 'manual',
        }),
      );
    });

    it('may not undo anything', async () => {
      await assertFails(
        deleteDoc(doc(asKiosk(env, UID.counselor), paths.attendance(ID.event, ID.student))),
      );
    });
  });

  describe('students, from a kiosk session', () => {
    const datePatch = () => ({
      firstAttendedAt: Timestamp.fromDate(new Date('2026-02-13T19:00:00Z')),
      lastAttendedAt: Timestamp.fromDate(new Date('2026-02-13T19:00:00Z')),
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: 8,
      searchName: 'jamie rivera',
      updatedAt: serverTimestamp(),
      updatedBy: UID.counselor,
    });

    it('may merge the check-in date patch onto an existing document', async () => {
      await assertSucceeds(
        setDoc(doc(asKiosk(env, UID.counselor), paths.student(ID.student)), datePatch(), {
          merge: true,
        }),
      );
    });

    it('may create the document the patch usually creates', async () => {
      await assertSucceeds(
        setDoc(doc(asKiosk(env, UID.counselor), paths.student('kiosk-new-student')), datePatch()),
      );
    });

    it('may not touch anything beyond the patch — notes, status, linkage', async () => {
      const db = asKiosk(env, UID.counselor);
      await assertFails(
        setDoc(
          doc(db, paths.student(ID.student)),
          { ...datePatch(), notes: 'scribbled from a lobby' },
          { merge: true },
        ),
      );
      await assertFails(
        setDoc(doc(db, paths.student(ID.student)), { status: 'inactive' }, { merge: true }),
      );
      // The same writes from the same person's full session are legal.
      await assertSucceeds(
        setDoc(
          doc(asUser(env, UID.counselor), paths.student(ID.student)),
          { notes: 'a counselor may' },
          { merge: true },
        ),
      );
    });
  });

  describe('users, from a kiosk session', () => {
    it('may not read profiles — not even its own', async () => {
      const db = asKiosk(env, UID.counselor);
      await assertFails(getDoc(doc(db, paths.user(UID.counselor))));
      await assertFails(getDocs(collection(db, COLLECTIONS.users)));
    });
  });
});

describe('default deny', () => {
  it('denies an unmodelled collection to every role', async () => {
    await assertFails(getDoc(doc(asUser(env, UID.admin), 'auditLog/entry-1')));
    await assertFails(setDoc(doc(asUser(env, UID.admin), 'auditLog/entry-1'), { note: 'hi' }));
  });

  it('denies the collections the Planning Center rework removed', async () => {
    // An admin who could recreate `accessRoster` could mint themselves an entry
    // and claim it; one who could write `config/pcoSync` could fake a healthy
    // sync. Neither path is modelled any more, and neither should come back by
    // accident.
    const db = asUser(env, UID.admin);
    await assertFails(setDoc(doc(db, 'accessRoster/mallory@example,org'), { role: 'admin' }));
    await assertFails(setDoc(doc(db, 'config/pcoSync'), { status: 'ok' }));
    await assertFails(getDocs(collection(db, 'accessRoster')));
  });
});
