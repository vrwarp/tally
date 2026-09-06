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
  Bytes,
  Timestamp,
  arrayRemove,
  collection,
  type Firestore,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  deleteField,
  serverTimestamp,
  writeBatch,
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
        studentDoc({ isVisitor: true, pcoPersonId: null, upstreamPushPending: true }),
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
      updateDoc(doc(db, paths.student(ID.student)), { contactPhone: '555-0100' }),
    );
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { contactEmail: 'parent@example.org' }),
    );
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { contactName: 'Alex Rivera' }),
    );
  });

  /*
   * The names those three fields carried before the terminology change. The
   * rule denies both spellings, and it has to: a deny-list that tracked only
   * the current name would let the next rename quietly reopen the hole. Nothing
   * in the app writes these any more, which is exactly why the rule is the only
   * thing left holding the line.
   */
  it('refuses the pre-rename spellings of the same three fields', async () => {
    const db = asUser(env, UID.counselor);

    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { parentPhone: '555-0100' }),
    );
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { parentEmail: 'adult@example.org' }),
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
        contactPhone: '555-0100',
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

  it('rejects grades outside Pre-K..12', async () => {
    const db = asUser(env, UID.counselor);
    // Off-model on purpose: `Grade` makes these unrepresentable in TypeScript,
    // which is exactly why the rule has to say it too. Below Pre-K there is no
    // grade at all — that is an absent field, not a smaller negative one.
    await assertFails(
      setDoc(doc(db, paths.student('student-gneg')), { ...studentDoc(), grade: -2 }),
    );
    await assertFails(
      setDoc(doc(db, paths.student('student-g13')), { ...studentDoc(), grade: 13 }),
    );
  });

  it('accepts the boundary grades', async () => {
    const db = asUser(env, UID.counselor);
    // -1 is Pre-K and 0 is kindergarten — a children's ministry roster, on the
    // same rules.
    await assertSucceeds(setDoc(doc(db, paths.student('student-gpk')), studentDoc({ grade: -1 })));
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

  it('accepts a gathering that lends the kiosk no colours', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.event('event-unthemed')), { ...eventDoc(), kioskTheme: null }),
    );
  });

  it('accepts a well-formed kiosk theme', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.event('event-themed')), {
        ...eventDoc(),
        kioskTheme: { ground: 'light', accent: 'ember', confirm: 'teal', backdrop: 'amber' },
      }),
    );
  });

  it('rejects a malformed kiosk theme', async () => {
    /*
     * Only the ground and the bounds are pinned; the hue wheel is not, because
     * `sanitizeKioskTheme` already reads a name it does not ship as that slot's
     * default. So `accent: 'chartreuse'` is *accepted* here on purpose and lands
     * as sky — what the fence stops is the shape that makes the document
     * nonsense, and a field big enough to be something other than a name.
     */
    const db = asUser(env, UID.core);
    const good = { ground: 'dark', accent: 'sky', confirm: 'forest', backdrop: 'indigo' };

    for (const kioskTheme of [
      { ...good, ground: 'sepia' },
      { ...good, ground: 7 },
      { ...good, accent: 42 },
      { ...good, confirm: '' },
      { ...good, backdrop: 'x'.repeat(33) },
      'ember',
    ]) {
      await assertFails(
        setDoc(doc(db, paths.event('event-bad-theme')), { ...eventDoc(), kioskTheme }),
      );
    }
  });

  it('lets a hue it has never heard of through, for the reader to fall back on', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.event('event-future-hue')), {
        ...eventDoc(),
        kioskTheme: { ground: 'dark', accent: 'chartreuse', confirm: 'forest', backdrop: 'indigo' },
      }),
    );
  });

  it('accepts a kiosk backdrop pointer, and its absence', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(
      setDoc(doc(db, paths.event('event-photo')), {
        ...eventDoc(),
        kioskBackdropId: 'b0123456789abcdef',
      }),
    );
    await assertSucceeds(
      setDoc(doc(db, paths.event('event-no-photo')), { ...eventDoc(), kioskBackdropId: null }),
    );
  });

  it('rejects a backdrop pointer that is not the shape this repo mints', async () => {
    /*
     * Tighter than a hue name because of where the value travels: the kiosk
     * turns it into a `kioskBackdrops/{id}` document path and a cache key.
     * See `lib/kioskBackdrop.ts`.
     */
    const db = asUser(env, UID.core);
    for (const kioskBackdropId of [
      42,
      '',
      'b0123', // too short to be a digest prefix
      'B0123456789ABCDEF', // minted lowercase; a second spelling is a second path
      'b0123456789abcdeg', // not hex
      'kioskBackdrops/b0123456789abcdef', // a path, not an id
    ]) {
      await assertFails(
        setDoc(doc(db, paths.event('event-bad-photo')), { ...eventDoc(), kioskBackdropId }),
      );
    }
  });

  describe('the chain references', () => {
    /*
     * `seriesId`, `recurrenceRootId` and `predictFromChain` are the three
     * fields `chainKey()` chooses between, and whichever it picks becomes a
     * document id — `skippedNights/{chainKey}`, `eventAccess/{chainKey}`, and
     * the path these rules interpolate to find a gathering's access list.
     *
     * Nothing here is an escalation: every malformed value fails closed. What
     * they are is an outage one core member can write from the event editor,
     * on the one gathering whose ACL then cannot be found.
     */
    it('accepts null, which is what most gatherings carry', async () => {
      const db = asUser(env, UID.core);
      await assertSucceeds(
        setDoc(doc(db, paths.event('event-no-chain')), {
          ...eventDoc(),
          seriesId: null,
          recurrenceRootId: null,
          predictFromChain: null,
        }),
      );
    });

    it('accepts an ordinary chain id', async () => {
      const db = asUser(env, UID.core);
      await assertSucceeds(
        setDoc(doc(db, paths.event('event-chained')), {
          ...eventDoc(),
          seriesId: 'sunday-school',
          recurrenceRootId: 'event-root-1',
          predictFromChain: 'friday-fellowship',
        }),
      );
    });

    it('rejects a value that would slice into a different path', async () => {
      const db = asUser(env, UID.core);

      for (const seriesId of [
        // The one that matters: a slash makes `eventAccess/$(key)` name a
        // document two levels down that the writer chose.
        'sunday/school',
        '../events/event-1',
        // Relative-path names: legal strings, illegal document ids.
        '.',
        '..',
        // Non-strings do not interpolate at all.
        42,
        true,
        { seriesId: 'sunday-school' },
        ['sunday-school'],
        // Empty is not a document id either, and `?? ` would not fall through
        // it — `chainKey()` uses `??`, so '' wins over the root and the id.
        '',
        'x'.repeat(201),
      ]) {
        await assertFails(
          setDoc(doc(db, paths.event('event-bad-chain')), { ...eventDoc(), seriesId }),
        );
      }
    });

    it('rejects it on recurrenceRootId and predictFromChain too', async () => {
      // Same field, three names. `chainKey()` falls through seriesId to the
      // root, and the roster reads `predictFromChain` to borrow another
      // gathering's history — all three end up as ids.
      const db = asUser(env, UID.core);

      await assertFails(
        setDoc(doc(db, paths.event('event-bad-root')), {
          ...eventDoc(),
          seriesId: null,
          recurrenceRootId: 'sunday/school',
        }),
      );
      await assertFails(
        setDoc(doc(db, paths.event('event-bad-predict')), {
          ...eventDoc(),
          predictFromChain: 'sunday/school',
        }),
      );
    });
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
  it('is now refused to everybody, including the core team', async () => {
    /*
     * The wildcard rule this used to assert is gone, and its absence is the
     * feature rather than a regression.
     *
     * `attendance` documents carry `seriesId`, and `firestore.indexes.json`
     * declares a collection-group index on it — so this exact query, with the
     * filter changed, returned an entire restricted gathering's register, every
     * night of it, to anybody with a browser console. A rule at a wildcard path
     * cannot narrow that: there is no single parent event to ask about, which
     * is also why it was silently overriding the per-event gate.
     *
     * The profile's history now goes through `getStudentAttendance`, which runs
     * on the Admin SDK, reads each record's parent event and drops what the
     * caller may not see. The indexes stay declared, because that callable uses
     * them.
     */
    for (const db of [asUser(env, UID.counselor), asUser(env, UID.core), asUser(env, UID.admin)]) {
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

describe('the attendance freeze (upstreamRecordMissing)', () => {
  /** Server-writes a student whose Planning Center record is known gone. */
  async function seedFrozenStudent(studentId: string): Promise<void> {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), paths.student(studentId)),
        studentDoc({ pcoPersonId: '77001', upstreamPushPending: false, upstreamRecordMissing: true }),
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

  /*
   * The third verb, and the one the old name hid. `attendanceFrozen()` guards
   * `create`, `update` and `delete` alike — it was called `checkInFrozen()`
   * while it did all three, which read as though a pickup slipped through.
   * It does not, and should not: a collection recorded against a student the
   * system of record no longer holds is exactly as unreconcilable as an
   * arrival, and the volunteer at the door would never learn it had failed.
   */
  it('refuses to collect a frozen student', async () => {
    await seedFrozenStudent(ID.student);
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.attendance(ID.event, ID.student)), {
        checkedOutAt: serverTimestamp(),
        checkedOutBy: UID.counselor,
      }),
    );
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
        studentDoc({ upstreamRecordMissing: true }),
      ),
    );
  });

  it('rejects a client thawing the flag by update', async () => {
    await seedFrozenStudent(ID.otherStudent);
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.student(ID.otherStudent)), { upstreamRecordMissing: false }),
    );
  });

  it('rejects a client freezing somebody else by update', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(
      updateDoc(doc(db, paths.student(ID.student)), { upstreamRecordMissing: true }),
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
        studentDoc({ upstreamPushPending: true, pendingReview: true }),
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
    // -1 is Pre-K, the bottom of the range; -2 is nothing.
    await assertFails(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ minGrade: -2 })));
    await assertFails(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ maxGrade: 13 })));
    await assertSucceeds(setDoc(doc(db, paths.planningCenter()), pcoConfigDoc({ minGrade: -1 })));
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
    // Parity with the Planning Center band above, on the same range.
    await assertFails(setDoc(doc(db, paths.attendees32()), a32ConfigDoc({ minGrade: -2 })));
    await assertFails(setDoc(doc(db, paths.attendees32()), a32ConfigDoc({ maxGrade: 13 })));
    await assertSucceeds(setDoc(doc(db, paths.attendees32()), a32ConfigDoc({ minGrade: -1 })));
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
describe('upstreamEdits', () => {
  /**
   * A browser may ask for work and may never claim work was done.
   *
   * Everything below is that one sentence, tested from both sides: the shape a
   * fresh job has to have, and every field a client would have to lie about to
   * pretend a job had run.
   */
  const editPath = (id = 'edit-1') => `${COLLECTIONS.upstreamEdits}/${id}`;

  const job = (over: Record<string, unknown> = {}) => ({
    studentId: ID.student,
    patch: { lastName: 'Chen-Ito' },
    baseline: { lastName: 'Chen' },
    state: 'queued',
    attempts: 0,
    nextAttemptAt: null,
    leaseUntil: null,
    failure: null,
    message: null,
    field: null,
    observed: null,
    survivorPersonId: null,
    survivorName: null,
    createdAt: serverTimestamp(),
    createdBy: UID.core,
    createdByName: 'Dana Ruiz',
    updatedAt: serverTimestamp(),
    startedAt: null,
    settledAt: null,
    ...over,
  });

  it('lets the core team queue an edit', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(setDoc(doc(db, editPath()), job()));
  });

  /**
   * A counselor's one screen is check-in, and nothing on it reaches the
   * church's people database. The listener is never even opened for them.
   */
  it('refuses a counselor, on read and on write', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(setDoc(doc(db, editPath()), job()));
    await assertFails(getDoc(doc(db, editPath())));
  });

  it('refuses a job somebody else claims to have queued', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, editPath()), job({ createdBy: UID.admin })));
  });

  /** Every one of these is a client pretending the drain has already run. */
  it('refuses a job that arrives already done', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, editPath()), job({ state: 'landed' })));
    await assertFails(setDoc(doc(db, editPath()), job({ attempts: 3 })));
    await assertFails(setDoc(doc(db, editPath()), job({ failure: 'auth' })));
    await assertFails(setDoc(doc(db, editPath()), job({ message: 'Saved.' })));
    await assertFails(setDoc(doc(db, editPath()), job({ survivorPersonId: '377' })));
    await assertFails(setDoc(doc(db, editPath()), job({ settledAt: serverTimestamp() })));
  });

  it('refuses a job with nothing in it to do', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, editPath()), job({ patch: {} })));
  });

  /**
   * The queue may not carry `status`. Who is on the roster is Tally's own list
   * and is never written upstream in any mode, so a job that could name it
   * would be a way to reach the church's database with a decision that was
   * never theirs.
   */
  it('refuses a field the queue does not carry', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, editPath()), job({ patch: { status: 'inactive' } })));
    await assertFails(setDoc(doc(db, editPath()), job({ patch: { notes: 'anything' } })));
  });

  it('refuses a grade outside Pre-K to 12', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, editPath()), job({ patch: { grade: 13 } })));
    await assertFails(setDoc(doc(db, editPath()), job({ patch: { grade: -2 } })));
    await assertSucceeds(setDoc(doc(db, editPath('pre-k')), job({ patch: { grade: -1 } })));
  });

  it('lets a leader cancel a job nothing has claimed', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(setDoc(doc(db, editPath()), job()));
    await assertSucceeds(
      updateDoc(doc(db, editPath()), {
        state: 'cancelled',
        updatedAt: serverTimestamp(),
        settledAt: serverTimestamp(),
      }),
    );
  });

  /**
   * The patch may already be on its way, so a cancel here cannot keep its
   * promise — and the screen does not offer one.
   */
  it('refuses a cancel once a worker holds it', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), editPath()), job({ state: 'sending' }));
    });
    const db = asUser(env, UID.core);
    await assertFails(
      updateDoc(doc(db, editPath()), { state: 'cancelled', updatedAt: serverTimestamp() }),
    );
  });

  it('lets a leader send a refused edit again', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), editPath()),
        job({ state: 'failed', attempts: 8, failure: 'validation', message: 'No.' }),
      );
    });
    const db = asUser(env, UID.core);
    await assertSucceeds(
      updateDoc(doc(db, editPath()), {
        state: 'queued',
        attempts: 0,
        failure: null,
        message: null,
        field: null,
        nextAttemptAt: null,
        leaseUntil: null,
        settledAt: null,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('refuses a retry that also rewrites what the edit says', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), editPath()), job({ state: 'failed', attempts: 8 }));
    });
    const db = asUser(env, UID.core);
    await assertFails(
      updateDoc(doc(db, editPath()), {
        state: 'queued',
        attempts: 0,
        patch: { lastName: 'Somebody Else' },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  /** The sweeper owns removal: a job a client could delete is one whose
      failure a client could hide. */
  it('refuses a delete from anybody', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), editPath()), job());
    });
    await assertFails(deleteDoc(doc(asUser(env, UID.core), editPath())));
    await assertFails(deleteDoc(doc(asUser(env, UID.admin), editPath())));
  });
});

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

describe('transitions', () => {
  const chain = ID.series;
  const path = paths.transition(chain, ID.student);
  const release = (over: Record<string, unknown> = {}) => ({
    chainKey: chain,
    studentId: ID.student,
    reason: 'moved-on',
    note: null,
    releasedBy: UID.core,
    releasedByName: 'Dana Ruiz',
    releasedAt: serverTimestamp(),
    ...over,
  });

  it('lets core release a student from a gathering, and change the answer', async () => {
    const db = asUser(env, UID.core);
    await assertSucceeds(setDoc(doc(db, path), release()));
    // Re-performing the act replaces the one document — a changed mind about
    // the reason, with a note, is the same address.
    await assertSucceeds(setDoc(doc(db, path), release({ reason: 'departed', note: 'graduated' })));
  });

  it('refuses a counselor — who a gathering expects is the call list’s own rank', async () => {
    const db = asUser(env, UID.counselor);
    await assertFails(setDoc(doc(db, path), release({ releasedBy: UID.counselor })));
  });

  it('refuses a document filed under the wrong pair', async () => {
    // The composite id is the address and the fields are the claim; a document
    // disagreeing with its own path would answer for a pair it is not about.
    const db = asUser(env, UID.core);
    await assertFails(
      setDoc(doc(db, paths.transition(chain, 'someone-else')), release()),
    );
    await assertFails(setDoc(doc(db, path), release({ chainKey: 'another-chain' })));
  });

  it('refuses a forged author', async () => {
    // The ledger says who decided; that has to be the session that wrote it.
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, path), release({ releasedBy: UID.admin })));
  });

  it('refuses any reason outside the two that differ in effect', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, path), release({ reason: 'other' })));
    await assertFails(setDoc(doc(db, path), release({ reason: null })));
  });

  it('refuses extra keys — a seed cannot be smuggled onto the record', async () => {
    const db = asUser(env, UID.core);
    await assertFails(setDoc(doc(db, path), release({ seeded: true })));
  });

  it('lets core undo, and nobody below', async () => {
    await assertSucceeds(setDoc(doc(asUser(env, UID.core), path), release()));
    await assertFails(deleteDoc(doc(asUser(env, UID.counselor), path)));
    await assertSucceeds(deleteDoc(doc(asUser(env, UID.core), path)));
  });

  it('lets any active member read it, and nobody outside', async () => {
    await assertSucceeds(setDoc(doc(asUser(env, UID.core), path), release()));
    await assertSucceeds(getDoc(doc(asUser(env, UID.counselor), path)));
    await assertFails(getDoc(doc(asUser(env, UID.inactive), path)));
    await assertFails(getDoc(doc(asAnonymous(env), path)));
  });
});

/**
 * Who may work one gathering.
 *
 * This block governs the access list itself, not the gatherings it protects —
 * the gates on `events`, `attendance` and `rsvps` are tested where they live.
 * The distinction matters because the interesting failures here are about
 * *changing the fence*, and a fence somebody outside can move is not a fence.
 *
 * `sunday-school` is seeded restricted to `counselor` and `core`. `outsider`
 * and `outsiderCore` are active members in good standing who are simply not on
 * it, which is what separates this fence from the app's front door.
 */
describe('eventAccess', () => {
  const chain = ID.restrictedSeries;
  const openChain = ID.series;

  const acl = (over: Record<string, unknown> = {}) => ({
    chainKey: chain,
    restricted: true,
    members: [UID.counselor, UID.core],
    updatedAt: serverTimestamp(),
    updatedBy: UID.core,
    ...over,
  });

  describe('reading it', () => {
    it('is readable by any active member, including one not on the gathering', async () => {
      // This is what lets the locked screen say "Miriam or Dana can add you"
      // instead of just refusing. Locked, not hidden.
      await assertSucceeds(getDoc(doc(asUser(env, UID.outsider), paths.eventAccess(chain))));
      await assertSucceeds(getDoc(doc(asUser(env, UID.counselor), paths.eventAccess(chain))));
    });

    it('refuses somebody with no active membership', async () => {
      await assertFails(getDoc(doc(asUser(env, UID.inactive), paths.eventAccess(chain))));
      await assertFails(getDoc(doc(asAnonymous(env), paths.eventAccess(chain))));
    });
  });

  describe('restricting a gathering that was open', () => {
    it('lets a core member close one, keeping themselves on it', async () => {
      const db = asUser(env, UID.core);
      await assertSucceeds(
        setDoc(doc(db, paths.eventAccess(openChain)), acl({ chainKey: openChain })),
      );
    });

    it('refuses a counselor', async () => {
      // Adding somebody to a gathering you work hands out access you already
      // have. Closing one takes access away from everybody else, which is a
      // decision about the gathering rather than about a person.
      const db = asUser(env, UID.counselor);
      await assertFails(
        setDoc(
          doc(db, paths.eventAccess(openChain)),
          acl({ chainKey: openChain, members: [UID.counselor], updatedBy: UID.counselor }),
        ),
      );
    });

    it('refuses closing the door from outside it', async () => {
      // The lockout this feature makes easiest: restrict Friday Fellowship,
      // leave yourself off, and nobody below an admin can reopen it — because
      // reopening requires being on it.
      const db = asUser(env, UID.core);
      await assertFails(
        setDoc(
          doc(db, paths.eventAccess(openChain)),
          acl({ chainKey: openChain, members: [UID.counselor] }),
        ),
      );
    });

    it('refuses a document that claims nothing', async () => {
      // `restricted: false` with no prior document is a no-op that would cost
      // a billed read on every gated request forever. Absence is how a
      // gathering says it is open.
      const db = asUser(env, UID.core);
      await assertFails(
        setDoc(
          doc(db, paths.eventAccess(openChain)),
          acl({ chainKey: openChain, restricted: false }),
        ),
      );
    });

    it('refuses a document filed under the wrong chain', async () => {
      const db = asUser(env, UID.core);
      await assertFails(setDoc(doc(db, paths.eventAccess(openChain)), acl()));
    });

    it('refuses signing somebody else name to the write', async () => {
      const db = asUser(env, UID.core);
      await assertFails(
        setDoc(
          doc(db, paths.eventAccess(openChain)),
          acl({ chainKey: openChain, updatedBy: UID.admin }),
        ),
      );
    });

    it('refuses a malformed list', async () => {
      const db = asUser(env, UID.core);

      for (const over of [
        { members: UID.core },
        { members: Array.from({ length: 201 }, (_, i) => `uid-${i}`).concat(UID.core) },
        { restricted: 'yes' },
        { updatedAt: 'now' },
      ]) {
        await assertFails(
          setDoc(doc(db, paths.eventAccess(openChain)), acl({ chainKey: openChain, ...over })),
        );
      }
    });
  });

  describe('adding somebody', () => {
    it('lets a counselor already on it add another', async () => {
      // Priya is on Friday Fellowship, Jo turns up at the door, and Priya adds
      // her without finding an admin. The permissive half, working as intended.
      const db = asUser(env, UID.counselor);
      await assertSucceeds(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          members: [UID.counselor, UID.core, UID.outsider],
          updatedAt: serverTimestamp(),
          updatedBy: UID.counselor,
        }),
      );
    });

    it('refuses a counselor who is not on it', async () => {
      // Otherwise the fence is a door with the handle on the outside.
      const db = asUser(env, UID.outsider);
      await assertFails(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          members: [UID.counselor, UID.core, UID.outsider],
          updatedAt: serverTimestamp(),
          updatedBy: UID.outsider,
        }),
      );
    });

    it('refuses a core member who is not on it', async () => {
      // Rank is not a way in. Core removes and reopens, but only on the
      // gatherings they work; the break-glass is admin.
      const db = asUser(env, UID.outsiderCore);
      await assertFails(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          members: [UID.counselor, UID.core, UID.outsiderCore],
          updatedAt: serverTimestamp(),
          updatedBy: UID.outsiderCore,
        }),
      );
    });
  });

  describe('removing somebody', () => {
    it('lets a core member on it remove a helper', async () => {
      const db = asUser(env, UID.core);
      await assertSucceeds(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          members: [UID.core],
          updatedAt: serverTimestamp(),
          updatedBy: UID.core,
        }),
      );
    });

    it('refuses a counselor, who may only add', async () => {
      // Not symmetric with adding: a counselor handing out the access they
      // have is one thing, a counselor evicting the person who set the
      // gathering up is another.
      const db = asUser(env, UID.counselor);
      await assertFails(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          members: [UID.counselor],
          updatedAt: serverTimestamp(),
          updatedBy: UID.counselor,
        }),
      );
    });

    it('refuses removing yourself, whatever your rank', async () => {
      // Same lockout as closing the door from outside, arrived at one edit
      // later.
      const db = asUser(env, UID.core);
      await assertFails(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          members: [UID.counselor],
          updatedAt: serverTimestamp(),
          updatedBy: UID.core,
        }),
      );
    });
  });

  describe('reopening it', () => {
    it('lets a core member on it reopen, keeping the list', async () => {
      // Keeping the list is the point: changing your mind twice should not
      // mean rebuilding four names from memory.
      const db = asUser(env, UID.core);
      await assertSucceeds(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          restricted: false,
          members: [UID.counselor, UID.core],
          updatedAt: serverTimestamp(),
          updatedBy: UID.core,
        }),
      );
    });

    it('refuses a counselor, who may not flip the switch', async () => {
      const db = asUser(env, UID.counselor);
      await assertFails(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          restricted: false,
          members: [UID.counselor, UID.core],
          updatedAt: serverTimestamp(),
          updatedBy: UID.counselor,
        }),
      );
    });

    it('refuses deleting the document, even for an admin', async () => {
      // Deleting reopens the gathering to everybody — the same outcome as
      // `restricted: false`, reached by a verb the rules would have handed
      // over for free had this been written `allow write:`.
      await assertFails(deleteDoc(doc(asUser(env, UID.admin), paths.eventAccess(chain))));
      await assertFails(deleteDoc(doc(asUser(env, UID.core), paths.eventAccess(chain))));
    });
  });

  describe('the break-glass', () => {
    it('lets an admin who is not on it fix a lockout', async () => {
      // The scenario: one core member restricted the gathering the whole
      // ministry works and left everybody off. Somebody has to be able to undo
      // that without a database console.
      const db = asUser(env, UID.admin);
      await assertSucceeds(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          restricted: false,
          members: [UID.counselor, UID.core],
          updatedAt: serverTimestamp(),
          updatedBy: UID.admin,
        }),
      );
    });

    it('lets an admin rewrite the list without joining it', async () => {
      // An admin tidying somebody else's gathering is not locking themselves
      // out, because they never needed to be on it.
      const db = asUser(env, UID.admin);
      await assertSucceeds(
        updateDoc(doc(db, paths.eventAccess(chain)), {
          members: [UID.core],
          updatedAt: serverTimestamp(),
          updatedBy: UID.admin,
        }),
      );
    });
  });
});

/**
 * The gates themselves — what an access list actually closes.
 *
 * Everything above tests the fence; this tests what stands behind it. The
 * shape of every case is the same pair: `outsider` is refused on
 * `sunday-school`, and the identical operation on `event-1` — which nobody has
 * restricted — still succeeds. The second half is the one that matters most. A
 * feature that protects a restricted gathering by breaking every open one is
 * not a feature.
 */
describe('working a restricted gathering', () => {
  const locked = ID.restrictedEvent;
  const open = ID.event;

  describe('the register', () => {
    it('refuses somebody who is not on the gathering', async () => {
      const db = asUser(env, UID.outsider);

      await assertFails(getDoc(doc(db, paths.attendance(locked, ID.student))));
      await assertFails(
        setDoc(
          doc(db, paths.attendance(locked, ID.otherStudent)),
          attendanceDoc({
            studentId: ID.otherStudent,
            eventId: locked,
            checkedInBy: UID.outsider,
          }),
        ),
      );
      await assertFails(deleteDoc(doc(db, paths.attendance(locked, ID.student))));
    });

    it('admits somebody who is', async () => {
      const db = asUser(env, UID.counselor);

      await assertSucceeds(getDocs(collection(db, paths.attendanceCollection(locked))));
      await assertSucceeds(
        setDoc(
          doc(db, paths.attendance(locked, ID.otherStudent)),
          attendanceDoc({
            studentId: ID.otherStudent,
            eventId: locked,
            checkedInBy: UID.counselor,
          }),
        ),
      );
    });

    it('leaves an unrestricted gathering exactly as it was', async () => {
      // The regression that matters most in the whole feature.
      const db = asUser(env, UID.outsider);

      await assertSucceeds(getDocs(collection(db, paths.attendanceCollection(open))));
      await assertSucceeds(
        setDoc(
          doc(db, paths.attendance(open, ID.otherStudent)),
          attendanceDoc({ studentId: ID.otherStudent, checkedInBy: UID.outsider }),
        ),
      );
    });

    it('lets an admin through regardless', async () => {
      await assertSucceeds(
        getDocs(collection(asUser(env, UID.admin), paths.attendanceCollection(locked))),
      );
    });

    it('refuses a list of the register too, which took denying the wildcard', async () => {
      /*
       * This was the last hole, and it was not in the nested rule.
       *
       * `match /{path=**}/attendance/{studentId}` existed so a student's
       * profile could run one collection-group query instead of a read per
       * night — but a wildcard path also matches an ordinary subcollection
       * query at `events/{id}/attendance`, and rules are OR'd across every
       * matching path. Its `allow list: if isActive()` was granting exactly
       * what the nested rule denied: `get` on one record was refused and
       * `list` of the whole register was not.
       *
       * It could not be narrowed — rules cannot tell a collection-group query
       * from a subcollection one, which is why the wildcard had to exist — so
       * it is denied outright and the profile's two questions go through
       * `getStudentAttendance`, which can read the parent event and filter.
       */
      await assertFails(
        getDocs(collection(asUser(env, UID.outsider), paths.attendanceCollection(locked))),
      );
    });

    it('lets somebody on the gathering list it', async () => {
      // The other half: denying the wildcard must not cost a member the read
      // they are entitled to through the nested rule.
      await assertSucceeds(
        getDocs(collection(asUser(env, UID.counselor), paths.attendanceCollection(locked))),
      );
    });
  });

  describe('the RSVP list', () => {
    it('refuses an outsider and admits a member', async () => {
      await assertFails(getDoc(doc(asUser(env, UID.outsider), paths.rsvp(locked, ID.student))));
      await assertSucceeds(getDoc(doc(asUser(env, UID.core), paths.rsvp(locked, ID.student))));
    });

    it('refuses a core member who is not on it', async () => {
      // RSVP writes are core-only, so this is the case where rank alone would
      // have been enough before.
      await assertFails(
        setDoc(
          doc(asUser(env, UID.outsiderCore), paths.rsvp(locked, ID.otherStudent)),
          rsvpDoc({ studentId: ID.otherStudent, eventId: locked, updatedBy: UID.outsiderCore }),
        ),
      );
    });
  });

  describe('the skipped-nights registry', () => {
    it('is gated on the chain, without an event lookup', async () => {
      // The chain *is* the document id here, which is why this one costs one
      // billed read rather than two.
      const registry = {
        chainKey: ID.restrictedSeries,
        skipped: [],
        examinedFrom: Timestamp.fromDate(new Date('2025-08-02T00:00:00Z')),
        updatedAt: serverTimestamp(),
      };

      await assertFails(
        setDoc(doc(asUser(env, UID.outsider), paths.skippedNights(ID.restrictedSeries)), registry),
      );
      await assertFails(
        getDoc(doc(asUser(env, UID.outsider), paths.skippedNights(ID.restrictedSeries))),
      );
      await assertSucceeds(
        setDoc(doc(asUser(env, UID.counselor), paths.skippedNights(ID.restrictedSeries)), registry),
      );
    });
  });

  describe('editing the gathering', () => {
    it('refuses a core member who is not on it', async () => {
      await assertFails(
        setDoc(
          doc(asUser(env, UID.outsiderCore), paths.event(locked)),
          eventDoc({ title: 'Renamed', seriesId: ID.restrictedSeries }),
        ),
      );
    });

    it('refuses escaping the ACL by switching the gathering to a one-off', async () => {
      /*
       * The front door this closes. `buildEventPayload` nulls `seriesId` and
       * `recurrenceRootId` when `mode` becomes `'oneoff'` — a supported action
       * in the event editor. Without checking the *old* chain too, a core
       * member outside the gathering could collapse its `chainKey` to its own
       * event id, for which no access document exists, and walk out with the
       * gathering and its whole register.
       */
      await assertFails(
        setDoc(
          doc(asUser(env, UID.outsiderCore), paths.event(locked)),
          eventDoc({
            title: 'Sunday School',
            mode: 'oneoff',
            seriesId: null,
            recurrenceRootId: null,
            recurrence: null,
          }),
        ),
      );
    });

    it('refuses repointing it at a chain the writer can read', async () => {
      // The same escape by a different verb: keep the event, change which
      // gathering it claims to belong to.
      await assertFails(
        setDoc(
          doc(asUser(env, UID.outsiderCore), paths.event(locked)),
          eventDoc({ title: 'Sunday School', seriesId: ID.series }),
        ),
      );
    });

    it('lets somebody on the gathering edit it', async () => {
      await assertSucceeds(
        setDoc(
          doc(asUser(env, UID.core), paths.event(locked)),
          eventDoc({ title: 'Sunday School, 9am', seriesId: ID.restrictedSeries }),
        ),
      );
    });

    it('still lets a core member create an ordinary gathering', async () => {
      // `create` has no old chain to leave, and an unrestricted new one waves
      // straight through — which is every event anybody makes.
      await assertSucceeds(
        setDoc(doc(asUser(env, UID.outsiderCore), paths.event('event-new')), eventDoc()),
      );
    });
  });

  describe('the lookup budget', () => {
    it('still commits a batch the size the RSVP screen writes', async () => {
      /*
       * `addRsvps` writes up to 400 documents in one batch, and every one of
       * them now costs an `eventAccess` lookup on top of the profile and the
       * event. Rules cache accesses by path within a request, so this should be
       * three lookups rather than twelve hundred — and if that ever stops being
       * true, this is the test that says so rather than a leader discovering it
       * on a retreat sign-up sheet.
       */
      const db = asUser(env, UID.core);
      const batch = writeBatch(db as never);

      for (let index = 0; index < 400; index += 1) {
        batch.set(
          doc(db, paths.rsvp(open, `bulk-student-${index}`)),
          rsvpDoc({ studentId: `bulk-student-${index}` }),
        );
      }

      await assertSucceeds(batch.commit());
    });
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

    /*
     * The pulse rides the same block, pinned by name because its threat is
     * different: writing it would let a client spoof "your caches changed"
     * onto every lobby screen and drive every kiosk into refetch loops.
     */
    it('covers the pulse: kiosk sessions read it, nobody writes it', async () => {
      await assertSucceeds(getDoc(doc(asKiosk(env, UID.counselor), 'kioskIndex/pulse')));
      await assertSucceeds(getDoc(doc(asUser(env, UID.counselor), 'kioskIndex/pulse')));
      await assertFails(getDoc(doc(asUser(env, UID.stranger), 'kioskIndex/pulse')));
      await assertFails(getDoc(doc(asAnonymous(env), 'kioskIndex/pulse')));
      await assertFails(
        setDoc(doc(asUser(env, UID.admin), 'kioskIndex/pulse'), { roster: { rev: 999 } }),
      );
      await assertFails(
        setDoc(doc(asKiosk(env, UID.counselor), 'kioskIndex/pulse'), {
          roster: { rev: 999 },
        }),
      );
    });
  });

  describe('kioskBackdrops', () => {
    /** A well-formed photograph, small enough to write in a test. */
    const backdropDoc = (updatedBy: string) => ({
      image: Bytes.fromUint8Array(new Uint8Array([137, 1, 2, 3])),
      contentType: 'image/webp',
      width: 1920,
      height: 1200,
      updatedAt: serverTimestamp(),
      updatedBy,
    });
    const at = (db: Firestore, id = 'b0123456789abcdef') => doc(db, 'kioskBackdrops', id);

    it('is readable by active members, kiosk sessions included', async () => {
      await assertSucceeds(getDoc(at(asUser(env, UID.counselor))));
      await assertSucceeds(getDoc(at(asKiosk(env, UID.counselor))));
      await assertFails(getDoc(at(asUser(env, UID.stranger))));
      await assertFails(getDoc(at(asAnonymous(env))));
    });

    it('is never listed — ids arrive on the binding, not by browsing', async () => {
      await assertFails(getDocs(collection(asUser(env, UID.admin), 'kioskBackdrops')));
    });

    it('is created by core with a well-formed image, and by nobody below', async () => {
      await assertSucceeds(setDoc(at(asUser(env, UID.core)), backdropDoc(UID.core)));
      await assertFails(
        setDoc(at(asUser(env, UID.counselor), 'b89abcdef0123456'), backdropDoc(UID.counselor)),
      );
      await assertFails(
        setDoc(at(asKiosk(env, UID.counselor), 'b89abcdef0123456'), backdropDoc(UID.counselor)),
      );
    });

    it('rejects an id that is not the content-addressed shape', async () => {
      const db = asUser(env, UID.core);
      for (const id of ['photo', 'B0123456789ABCDEF', 'b0123', 'b0123456789abcdeg']) {
        await assertFails(setDoc(at(db, id), backdropDoc(UID.core)));
      }
    });

    it('rejects a malformed image, oversize included', async () => {
      const db = asUser(env, UID.core);
      const good = backdropDoc(UID.core);
      for (const bad of [
        { ...good, image: 'not bytes' },
        { ...good, image: Bytes.fromUint8Array(new Uint8Array(0)) },
        // One byte past KIOSK_BACKDROP_MAX_BYTES — the rules' copy of the cap.
        { ...good, image: Bytes.fromUint8Array(new Uint8Array(600_001)) },
        { ...good, contentType: 'image/png' },
        { ...good, width: 0 },
        { ...good, height: 2048 },
        { ...good, updatedAt: 'today' },
        // Attribution is the writer's own uid, not a claim about somebody else.
        { ...good, updatedBy: UID.admin },
      ]) {
        await assertFails(setDoc(at(db, 'b456789abcdef012'), bad));
      }
    });

    it('is create-only: under a content-addressed id, an update is a lie', async () => {
      await assertSucceeds(setDoc(at(asUser(env, UID.core), 'bfedcba9876543210'), backdropDoc(UID.core)));
      await assertFails(
        setDoc(at(asUser(env, UID.admin), 'bfedcba9876543210'), backdropDoc(UID.admin)),
      );
      await assertFails(
        updateDoc(at(asUser(env, UID.admin), 'bfedcba9876543210'), { width: 800 }),
      );
      // And never deleted from a client: nothing records which gatherings
      // still wear an image, so a delete could undress somebody else's kiosk.
      await assertFails(deleteDoc(at(asUser(env, UID.admin), 'bfedcba9876543210')));
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
        setDoc(doc(db, paths.student('lobby-invented')), { ...base, upstreamPushPending: true }),
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

    /**
     * The check-in the database itself used to refuse.
     *
     * A Pre-K child's grade rides on this patch, and the patch shares a batch
     * with their attendance record — so while this rule's floor was `0`, a
     * `grade: -1` failed validation, the batch failed with it, and a
     * four-year-old could not be checked in at all. The "-1th grade" on the
     * lobby screen was the visible half of that bug; this was the other half.
     */
    it('may check in a Pre-K child, whose grade rides on the patch', async () => {
      await assertSucceeds(
        setDoc(doc(asKiosk(env, UID.counselor), paths.student('kiosk-prek-student')), {
          ...datePatch(),
          grade: -1,
        }),
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
