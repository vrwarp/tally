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
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { paths } from '@/lib/paths';
import {
  ID,
  UID,
  asAnonymous,
  asUser,
  attendanceDoc,
  eventDoc,
  initTestEnv,
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

  it('lets a counselor choose their own small group', async () => {
    // Journey 2 depends on this being self-service.
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      updateDoc(doc(db, paths.user(UID.counselor)), { assignedGroupId: '8th-grade-boys' }),
    );
  });

  it('rejects a counselor assigning a group to someone else', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.user(UID.core)), { assignedGroupId: '8th-grade-boys' }),
    );
  });

  it('rejects a counselor smuggling a role change alongside their group', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.user(UID.counselor)), {
        assignedGroupId: '8th-grade-boys',
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
    // have one until somebody assigns a group or checks them in.
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      setDoc(doc(db, paths.student('pco_4100010')), {
        firstName: 'Amara',
        lastName: 'Okonkwo',
        grade: 8,
        searchName: 'amara okonkwo',
        smallGroupId: 'grade-8-girls',
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

  it('rejects grades outside 6..12', async () => {
    const db = asUser(env, UID.counselor);
    // Off-model on purpose: `Grade` makes these unrepresentable in TypeScript,
    // which is exactly why the rule has to say it too.
    await assertFails(setDoc(doc(db, paths.student('student-g5')), { ...studentDoc(), grade: 5 }));
    await assertFails(
      setDoc(doc(db, paths.student('student-g13')), { ...studentDoc(), grade: 13 }),
    );
  });

  it('accepts the boundary grades', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(setDoc(doc(db, paths.student('student-g6')), studentDoc({ grade: 6 })));
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

  it('lets core create, update and delete events', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(setDoc(doc(db, paths.event('event-new')), eventDoc()));
    await assertSucceeds(updateDoc(doc(db, paths.event(ID.event)), { title: 'Renamed' }));
    await assertSucceeds(deleteDoc(doc(db, paths.event('event-new'))));
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
});

describe('rsvps', () => {
  it('lets a counselor flip waiver and payment at the bus door', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(
      updateDoc(doc(db, paths.rsvp(ID.event, ID.student)), {
        waiverSigned: true,
        paymentReceived: true,
        updatedAt: new Date(),
        updatedBy: UID.counselor,
      }),
    );
  });

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
  it('lets counselors read small groups and series but not write them', async () => {
    const db = asUser(env, UID.counselor);
    await assertSucceeds(getDocs(collection(db, paths.smallGroups())));
    await assertSucceeds(getDocs(collection(db, paths.eventSeries())));
    await assertFails(
      setDoc(doc(db, paths.smallGroup('group-new')), {
        name: 'New',
        grades: [7],
        gender: 'mixed',
        order: 1,
      }),
    );
    await assertFails(
      setDoc(doc(db, paths.series('series-new')), {
        title: 'Wednesday',
        dayOfWeek: 3,
        startTime: '19:00',
        endTime: '21:00',
        checkInOpensMinutesBefore: 60,
        checkInClosesMinutesAfter: 60,
        defaultGroupingMode: 'all',
        active: true,
        order: 2,
      }),
    );
  });

  it('lets core write small groups', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.smallGroup('group-new')), {
        name: 'New',
        grades: [7],
        gender: 'mixed',
        order: 1,
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

/*
 * `config/pcoSync` and `accessRoster` had their own suites here.
 *
 * Both collections are gone: there is no scheduled sync to track, and the
 * allowlist is a live Planning Center lookup rather than a mirrored list. The
 * "default deny" suite below is what now covers them — an attempt to write
 * either path is an unmodelled collection, which is exactly the right answer.
 */

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
