/**
 * Attendees, the real server.
 *
 * The same chain attendees32.spec.ts proves — browser -> callable -> Cloud
 * Function -> real HTTP — but the far end is attendees32 itself, built from a
 * pinned ref and loaded with its golden congregation by
 * docker-compose.integration.yml. What this proves that the simulator cannot
 * is that the two codebases agree. Reads: the roster sweep, a meet's history.
 * Writes: a profile edit, a fold that asks the server to merge and to undo, a
 * visitor pushed as a new person, a parent added to a family, and a family
 * registered at the door and approved. The kiosk itself is driven for the
 * last two kinds: a check-in of a golden youth, and a registration.
 *
 * Runs only with a real server (E2E.a32.live); the people and the meet are
 * the golden congregation's youth group, which the server's setup command
 * provisioned Tally against.
 */
import type { Page } from '@playwright/test';
import { E2E } from '../playwright.config';
import {
  a32FamiliesOf,
  a32FamilyOf,
  a32MeetMembers,
  a32Patch,
  a32Person,
  a32Record,
  a32Relations,
  a32Remove,
  a32RemoveTwins,
  a32RemoveWithFamily,
  a32Search,
  a32Twin,
} from './support/attendees';
import { gotoReady, TEAM } from './support/auth';
import {
  a32PersonIdOf,
  callFunction,
  deleteDocument,
  drainStudentNow,
  readCollection,
  removeA32Residue,
  uidOf,
  waitForEditState,
  writeDocument,
} from './support/emulator';
import { expect, test } from './support/fixtures';
import { bindTo, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';
import { REGISTRATIONS, removeRegistration, seedRegistration } from './support/registrations';
import { rosterAction } from './support/rosterActions';

/** A youth of the golden congregation, with a mother and a phone of her own. */
const HANNAH = 'Hannah Liu';
/** How the server shows her: the Chinese name sits between the two. */
const HANNAH_ROW = /Hannah\b.*\bLiu/;
/** The phone the fold test's twin gets, which is how a leftover twin is found. */
const TWIN_PHONE = '+15105550601';
/** A surname nobody in the congregation has, new for every run, so what a test made is findable. */
const SURNAME = `Tallyrun${Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')}`;

/** Relation titles the server may file a parent or a child under. */
const PARENT_TITLES = ['parent', 'father', 'mother', 'guardian'];
const CHILD_TITLES = ['child', 'son', 'daughter', 'ward'];

function titleOf(relations: Record<string, number>, id: number): string | undefined {
  return Object.keys(relations).find((title) => relations[title] === id);
}

/** The family the kiosk test registers, under a surname of its own. */
const KIOSK_SURNAME = `${SURNAME}k`;

async function eventNamed(title: string): Promise<{ id: string }> {
  const found = (await readCollection('events')).find((doc) => doc.data.title === title);
  if (!found) throw new Error(`The seed produced no "${title}"; see scripts/seed.ts.`);
  return { id: found.id };
}

/** One child through the kiosk's three questions. */
async function enterChild(kiosk: Page, first: string, last: string, grade: string) {
  await typeOnKiosk(kiosk, first);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await kiosk.locator('[data-key="clear"]').click();
  await typeOnKiosk(kiosk, last);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await kiosk.getByRole('button', { name: grade, exact: true }).click();
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
}

/** The adult, asked once after the first child. */
async function enterGuardian(kiosk: Page, first: string, last: string, phone: string) {
  await typeOnKiosk(kiosk, first);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await kiosk.locator('[data-key="clear"]').click();
  await typeOnKiosk(kiosk, last);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await typeOnKiosk(kiosk, phone);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
}

/** Takes a kiosk-registered family back out of Tally: its record, its students, their check-ins. */
async function removeKioskFamily(surname: string, eventId: string): Promise<void> {
  const registrations = (await readCollection(REGISTRATIONS)).filter(
    (doc) => (doc.data.guardian as { lastName?: string } | null)?.lastName === surname,
  );
  for (const registration of registrations) {
    for (const studentId of (registration.data.studentIds as string[] | undefined) ?? []) {
      await deleteDocument(`events/${eventId}/attendance/${studentId}`);
      await deleteDocument(`students/${studentId}`);
    }
    await deleteDocument(`${REGISTRATIONS}/${registration.id}`);
  }
  // Approval removes the record first; the students it left are still ours.
  for (const student of (await readCollection('students')).filter((doc) => doc.data.lastName === surname)) {
    await deleteDocument(`events/${eventId}/attendance/${student.id}`);
    await deleteDocument(`students/${student.id}`);
  }
}

/** Everyone on the server with this run's surname, by first name. */
async function peopleNamed(surname: string): Promise<Record<string, Record<string, unknown>>> {
  const rows = (await a32Search(surname)).filter((row) => row.last_name === surname);
  return Object.fromEntries(rows.map((row) => [String(row.first_name), row]));
}
/** GOLDEN_MEET_IDS["youth_group"] in the golden builder. */
const YOUTH_GROUP_MEET_ID = 100;

async function pumpA32(studentId: string, states: readonly string[], timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await waitForEditState(studentId, states, 1_500);
      return;
    } catch (cause) {
      if (Date.now() >= deadline) throw cause;
    }
    await drainStudentNow(studentId);
  }
}

function membership(personId: string, firstName: string, lastName: string) {
  return {
    upstreamBackend: 'a32',
    upstreamPersonId: personId,
    status: 'active',
    firstName,
    lastName,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
  };
}

test.describe('Attendees, the real server', () => {
  test.skip(
    !E2E.a32.live,
    'needs the real server: docker compose -f docker-compose.integration.yml run --rm e2e',
  );

  test.beforeAll(async () => {
    await a32RemoveTwins(HANNAH, TWIN_PHONE);
  });

  test.afterAll(async () => {
    await removeA32Residue();
    await a32RemoveTwins(HANNAH, TWIN_PHONE);
    // What the write tests made, should one of them have stopped short of its own cleanup.
    for (const surname of [SURNAME, KIOSK_SURNAME]) {
      for (const row of Object.values(await peopleNamed(surname))) await a32RemoveWithFamily(String(row.id));
    }
  });

  test('a golden youth joins the roster and reads back whole', async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable();
    await signedInAs('core');
    await gotoReady(page, '/students');

    await (await rosterAction(page, /add from directory/i, { timeout: 20_000 })).click();
    const dialog = page.getByRole('dialog', { name: /add a student/i });
    await dialog.getByLabel(/search your directories/i).fill(HANNAH);

    const hannah = dialog.locator('li').filter({ hasText: HANNAH_ROW });
    await hannah.waitFor({ timeout: 20_000 });
    await expect(hannah.getByText('Attendees')).toBeVisible();
    await hannah.getByRole('button', { name: /^add$/i }).click();
    await expect(hannah.getByText(/on the roster/i)).toBeVisible({ timeout: 20_000 });

    // The generic linkage, with the server's UUID; nothing the server owns is copied in.
    const personId = await a32PersonIdOf(HANNAH);
    const students = await firestore.until(
      'students',
      (docs) => docs.some((doc) => doc.id === `a32_${personId}`),
      "Hannah's membership document",
    );
    const doc = students.find((row) => row.id === `a32_${personId}`)!;
    expect(doc.data.upstreamBackend).toBe('a32');
    expect(doc.data.pcoPersonId ?? null).toBeNull();
    expect(doc.data.contactPhone ?? null).toBeNull();

    await dialog.getByRole('button', { name: /done/i }).click();
    const row = page.getByRole('link', { name: HANNAH_ROW });
    await expect(row).toBeVisible({ timeout: 20_000 });

    // Her page reads the household from the server: her mother, by name.
    await row.click();
    await expect(page.getByText(/Meiling\b.*\bLiu/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Attendees' })).toBeVisible();
  });

  test('an edit goes through the queue and lands on the server', async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable('full');
    await signedInAs('admin');

    const personId = await a32PersonIdOf(HANNAH);
    const studentId = `a32_${personId}`;
    await writeDocument(`students/${studentId}`, membership(personId, 'Hannah', 'Liu'));
    try {
      await gotoReady(page, `/students/${studentId}`);
      await page.getByRole('button', { name: 'Edit profile' }).click();
      const dialog = page.getByRole('dialog');
      const lastName = dialog.getByLabel(/^Last name/);
      await expect(lastName).toBeEnabled({ timeout: 20_000 });
      await lastName.fill('Liu-Hsu');
      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(dialog).toBeHidden();

      const strip = page.getByRole('main').getByRole('status');
      await expect(strip).toContainText('Attendees');
      await pumpA32(studentId, ['landed'], 60_000);
      await expect(strip).toContainText('Saved in Attendees');
      await firestore.until(
        'upstreamEdits',
        (docs) => docs.some((doc) => doc.data.studentId === studentId && doc.data.state === 'landed'),
        'the edit to land',
      );

      // The server holds the new name.
      const record = await a32Record(personId);
      expect(record.status).toBe(200);
      expect(record.body?.last_name).toBe('Liu-Hsu');
    } finally {
      await a32Patch(personId, { last_name: 'Liu' });
    }
  });

  test("the youth group's history imports as Tally events", async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable();
    await signedInAs('core');
    await gotoReady(page, '/events');

    await page.getByRole('button', { name: /^import$/i }).click();
    const dialog = page.getByRole('dialog', { name: /import history/i });
    const meet = dialog.locator('li').filter({ hasText: 'Youth Group' });
    await meet.waitFor({ timeout: 30_000 });
    await expect(meet.getByText('Attendees')).toBeVisible();

    await meet.getByRole('button', { name: /^import$/i }).click();
    await expect(dialog.getByText(/is in Tally/)).toBeVisible({ timeout: 120_000 });

    const events = await firestore.collection('events');
    const root = events.find((doc) => doc.id === `a32-meet-${E2E.a32.meetSlug}`);
    expect(root).toBeTruthy();
    expect(root!.data.createdBy).toBe('attendees32');

    const students = await firestore.collection('students');
    const imported = students.filter((doc) => doc.data.createdBy === 'attendees32');
    expect(imported.length).toBeGreaterThan(0);
    for (const student of imported) {
      expect(student.data.upstreamBackend).toBe('a32');
      expect(student.data.pcoPersonId ?? null).toBeNull();
    }

    await meet.getByRole('button', { name: /re-import/i }).click();
    await expect(dialog.getByText(/is in Tally/)).toBeVisible({ timeout: 120_000 });
    const after = await firestore.collection('events');
    expect(after.length).toBe(events.length);
  });

  test('a fold of two of its people merges them on the server, and undo puts them back', async ({
    attendees,
    signedInAs,
  }) => {
    await attendees.enable('full');
    // `uidOf` needs the admin's users document, which the first sign-in writes.
    await signedInAs('admin');
    const personId = await a32PersonIdOf(HANNAH);
    const original = (await a32Record(personId)).body!;
    // A second record of Hannah on the server, in the youth group like her.
    const twin = await a32Twin(original, TWIN_PHONE, YOUTH_GROUP_MEET_ID);
    const twinId = String(twin.id);
    const primaryStudent = `a32_${personId}`;
    const duplicateStudent = `a32_${twinId}`;
    const admin = { uid: await uidOf(TEAM.admin), email: TEAM.admin };
    try {
      await writeDocument(`students/${primaryStudent}`, membership(personId, 'Hannah', 'Liu'));
      await writeDocument(`students/${duplicateStudent}`, membership(twinId, 'Hannah', 'Liu'));

      // Tally folds the duplicate into the primary, and asks the server first.
      await callFunction('mergeStudents', { keeperId: primaryStudent, foldId: duplicateStudent }, admin);

      const folded = (await readCollection('students')).find((doc) => doc.id === duplicateStudent)?.data;
      expect(folded?.mergedIntoStudentId).toBe(primaryStudent);
      expect((folded?.upstreamMerge as Record<string, unknown> | undefined)?.duplicatePersonId).toBe(twinId);
      // The server merged too: the twin's id now forwards to Hannah's.
      const merged = await a32Record(twinId);
      expect(merged.status).toBe(410);
      expect((await a32Record(personId)).status).toBe(200);

      // Undo asks the server first as well; both records are back.
      await callFunction('mergeStudents', { keeperId: primaryStudent, foldId: duplicateStudent, undo: true }, admin);
      expect((await a32Record(twinId)).status).toBe(200);
      const restored = (await readCollection('students')).find((doc) => doc.id === duplicateStudent)?.data;
      expect(restored?.mergedIntoStudentId ?? null).toBeNull();
      expect(restored?.upstreamMerge ?? null).toBeNull();
    } finally {
      await a32Remove(twinId);
    }
  });

  test('a visitor added by hand is created on the server, in a family and in the youth group', async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable();
    // Two backends are connected, so the push needs telling where new people go.
    await writeDocument('config/backends', { defaultPushBackend: 'a32' });
    await signedInAs('core');
    let studentId: string | null = null;
    let personId: string | null = null;
    try {
      await gotoReady(page, '/students');
      await (await rosterAction(page, /add by hand/i)).click();
      const editor = page.getByRole('dialog', { name: /add a student/i });
      await editor.getByLabel(/first name/i).fill('Keanu');
      await editor.getByLabel(/last name/i).fill(SURNAME);
      await editor.getByRole('button', { name: /add student/i }).click();

      // The push runs on the student-created trigger and writes the linkage back.
      const pushed = (doc: { data: Record<string, unknown> }) =>
        doc.data.lastName === SURNAME && doc.data.upstreamBackend === 'a32' && Boolean(doc.data.upstreamPersonId);
      const students = await firestore.until('students', (docs) => docs.some(pushed), 'the visitor linked to Attendees');
      const keanu = students.find(pushed)!;
      studentId = keanu.id;
      personId = String(keanu.data.upstreamPersonId);

      const record = (await a32Record(personId)).body!;
      expect(record.first_name).toBe('Keanu');
      expect(record.last_name).toBe(SURNAME);
      expect(String(record.division)).toBe(E2E.a32.divisionId);
      // A family of their own, as a child in it, and a seat in the configured meet.
      const relations = await a32Relations();
      const family = a32FamilyOf(record);
      expect(family).not.toBeNull();
      expect(CHILD_TITLES).toContain(titleOf(relations, family!.role));
      expect(await a32MeetMembers()).toContain(personId);
    } finally {
      if (personId) await a32RemoveWithFamily(personId);
      if (studentId) await firestore.remove(`students/${studentId}`);
      await firestore.remove('config/backends');
    }
  });

  test('a parent added from Tally joins the family on the server', async ({ signedInAs, attendees }) => {
    await attendees.enable('full');
    await signedInAs('admin');
    const admin = { uid: await uidOf(TEAM.admin), email: TEAM.admin };
    const child = await a32Person('Noa', SURNAME, '+15105550711', YOUTH_GROUP_MEET_ID);
    const childId = String(child.id);
    const studentId = `a32_${childId}`;
    let parentId: string | null = null;
    try {
      await writeDocument(`students/${studentId}`, membership(childId, 'Noa', SURNAME));
      const result = (await callFunction(
        'addParent',
        { studentId, firstName: 'Lani', lastName: SURNAME, phone: '+15105550712', createNew: true },
        admin,
      )) as { status: string; parentPersonId: string | null; createdPerson: boolean; createdHousehold: boolean };
      expect(result.parentPersonId, result.status).toBeTruthy();
      expect(result.createdPerson).toBe(true);
      parentId = String(result.parentPersonId);

      // The parent is a record of their own, with the phone that was typed.
      const parent = (await a32Record(parentId)).body!;
      expect(parent.last_name).toBe(SURNAME);
      const contacts = ((parent.infos as { contacts?: Record<string, unknown> }).contacts ?? {}) as Record<string, unknown>;
      expect(Object.values(contacts).some((value) => typeof value === 'string' && value.endsWith('5550712'))).toBe(true);

      // One family holds both, each under the right relation.
      const relations = await a32Relations();
      const childFamily = a32FamilyOf((await a32Record(childId)).body!);
      const parentFamily = a32FamilyOf(parent);
      expect(childFamily).not.toBeNull();
      expect(parentFamily?.id).toBe(childFamily!.id);
      expect(childFamily!.attendees).toEqual(expect.arrayContaining([childId, parentId]));
      expect(CHILD_TITLES).toContain(titleOf(relations, childFamily!.role));
      expect(PARENT_TITLES).toContain(titleOf(relations, parentFamily!.role));
    } finally {
      if (parentId) await a32RemoveWithFamily(parentId);
      await a32RemoveWithFamily(childId);
      await deleteDocument(`students/${studentId}`);
    }
  });

  test('a family registered at the door reaches the server once a leader approves it', async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable('full');
    await writeDocument('config/backends', { defaultPushBackend: 'a32' });
    await signedInAs('core');
    const registrationId = `live-approve-${SURNAME}`;
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Sofia', lastName: SURNAME, phone: '5105550713' },
      children: [
        { firstName: 'Bruno', lastName: SURNAME, grade: 7 },
        { firstName: 'Cleo', lastName: SURNAME, grade: 9 },
      ],
    });
    try {
      await gotoReady(page, '/review');
      const card = page.locator('section', { hasText: `Sofia ${SURNAME}` }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByRole('button', { name: /Approve and add/i }).click();
      await card.getByRole('button', { name: /^Yes — add/i }).click();

      // Two children pushed, then one household built around the adult.
      await expect
        .poll(async () => Object.keys(await peopleNamed(SURNAME)).length, {
          timeout: 90_000,
          message: 'the children and their guardian reach Attendees',
        })
        .toBe(3);
      const people = await peopleNamed(SURNAME);
      expect(Object.keys(people).sort()).toEqual(['Bruno', 'Cleo', 'Sofia']);
      const ids = Object.fromEntries(Object.entries(people).map(([first, row]) => [first, String(row.id)]));

      const members = await a32MeetMembers();
      expect(members).toContain(ids.Bruno);
      expect(members).toContain(ids.Cleo);

      // One family holds all three, and neither child is left in a second one.
      const family = a32FamilyOf((await a32Record(ids.Sofia)).body!);
      expect(family).not.toBeNull();
      expect(family!.attendees).toEqual(expect.arrayContaining([ids.Bruno, ids.Cleo, ids.Sofia]));
      for (const first of ['Bruno', 'Cleo']) {
        const families = a32FamiliesOf((await a32Record(ids[first]!)).body!);
        expect(families.map((row) => row.id), `${first}'s families`).toEqual([family!.id]);
      }

      // The hold comes off in Tally, and the record is gone.
      const students = await firestore.collection('students');
      const ours = students.filter((doc) => doc.data.lastName === SURNAME);
      expect(ours).toHaveLength(2);
      expect(ours.every((doc) => doc.data.pendingReview === false)).toBe(true);
      await expect
        .poll(async () => (await firestore.collection(REGISTRATIONS)).some((doc) => doc.id === registrationId), {
          timeout: 30_000,
        })
        .toBe(false);
    } finally {
      for (const row of Object.values(await peopleNamed(SURNAME))) await a32RemoveWithFamily(String(row.id));
      await removeRegistration(registrationId, 2);
      await firestore.remove('config/backends');
    }
  });

  test('the kiosk finds a golden youth and checks her in', async ({ browser, page, signedInAs, attendees }) => {
    test.setTimeout(120_000);
    await attendees.enable();
    await signedInAs('core');
    const personId = await a32PersonIdOf(HANNAH);
    const studentId = `a32_${personId}`;
    // One Hannah on the kiosk: not hers from an earlier test, and not her twin's.
    await removeA32Residue();
    await writeDocument(`students/${studentId}`, { ...membership(personId, 'Hannah', 'Liu'), grade: 7 });
    // A gathering of this run's own, open now, so the check-in has one place to land.
    const gatheringId = `live-youth-${SURNAME}`;
    const minutes = (offset: number) => new Date(Date.now() + offset * 60_000);
    await writeDocument(`events/${gatheringId}`, {
      title: 'Youth Group (live)',
      description: null,
      icon: null,
      mode: 'oneoff',
      seriesId: null,
      recurrence: null,
      recurrenceRootId: null,
      predictFromChain: null,
      startAt: minutes(-30),
      endAt: minutes(90),
      checkInOpensAt: minutes(-60),
      checkInClosesAt: minutes(120),
      location: null,
      notes: null,
      requiresRsvp: false,
      requiresCheckOut: false,
      status: 'scheduled',
      createdAt: minutes(-200),
      updatedAt: minutes(-200),
      createdBy: 'e2e',
    });
    const { context, page: kiosk } = await openKiosk(browser);
    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /youth group \(live\)/i);

      // The kiosk reads the roster, backends included, after it is bound; the
      // cache it writes says when that read has landed.
      await kiosk.waitForFunction(
        ([key, id]) => (localStorage.getItem(key!) ?? '').includes(id!),
        ['tally:kiosk:roster', studentId],
        { timeout: 60_000 },
      );
      await typeOnKiosk(kiosk, 'Hannah');
      const row = kiosk.getByRole('button', { name: HANNAH_ROW }).first();
      const noMatch = kiosk.getByText(/^no match$/i);
      await expect(row.or(noMatch)).toBeVisible({ timeout: 20_000 });
      // A gathering with no regulars yet scopes to nobody; widen to the roster.
      if (await noMatch.isVisible()) await kiosk.getByRole('button', { name: /Search everyone/i }).click();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/welcome/i)).toBeVisible();

      // The kiosk uploads on its own clock, up to UPLOAD_DEADLINE_MS after the tap.
      await expect
        .poll(
          async () =>
            (await readCollection(`events/${gatheringId}/attendance`)).some(
              (doc) => doc.data.studentId === studentId && doc.data.method === 'kiosk',
            ),
          { timeout: 60_000, message: "Hannah's kiosk check-in lands on the gathering" },
        )
        .toBe(true);
      expect((await readCollection('kioskParkedRecords')).filter((doc) => doc.data.studentId === studentId)).toEqual([]);
    } finally {
      await context.close();
      for (const doc of await readCollection(`events/${gatheringId}/attendance`)) {
        await deleteDocument(`events/${gatheringId}/attendance/${doc.id}`);
      }
      for (const doc of await readCollection('kioskParkedRecords')) {
        if (doc.data.studentId === studentId) await deleteDocument(`kioskParkedRecords/${doc.id}`);
      }
      await deleteDocument(`events/${gatheringId}`);
      await deleteDocument(`students/${studentId}`);
    }
  });

  test('a family registered at the kiosk reaches the server once a leader approves it', async ({
    browser,
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    test.setTimeout(240_000);
    await attendees.enable('full');
    await writeDocument('config/backends', { defaultPushBackend: 'a32' });
    await signedInAs('core');
    const nursery = await eventNamed('Nursery');
    const { context, page: kiosk } = await openKiosk(browser);
    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      await kiosk.getByRole('button', { name: /Register your child/i }).click();
      await enterChild(kiosk, 'Wren', KIOSK_SURNAME, '4th grade');
      // Full write-back means the server can hold an allergy note, so the kiosk asks.
      await expect(kiosk.getByText(/Any allergies the leaders should know about/i)).toBeVisible();
      await typeOnKiosk(kiosk, 'peanuts');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await enterGuardian(kiosk, 'Dana', KIOSK_SURNAME, '5105550714');
      await kiosk.getByRole('button', { name: /Add another child/i }).click();
      await typeOnKiosk(kiosk, 'Fox');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: '2nd grade', exact: true }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /^No allergies$/ }).click();
      await kiosk.getByRole('button', { name: 'Check in Wren and Fox' }).click();
      await expect(kiosk.getByText('Wren and Fox are checked in. Welcome!')).toBeVisible({ timeout: 20_000 });

      // Nothing has reached the server yet: the children wait for a leader.
      expect(Object.keys(await peopleNamed(KIOSK_SURNAME))).toHaveLength(0);

      await gotoReady(page, '/review');
      const card = page.locator('section', { hasText: `Dana ${KIOSK_SURNAME}` }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByRole('button', { name: /Approve and add/i }).click();
      await card.getByRole('button', { name: /^Yes — add/i }).click();

      await expect
        .poll(async () => Object.keys(await peopleNamed(KIOSK_SURNAME)).length, {
          timeout: 90_000,
          message: 'the children and their guardian reach Attendees',
        })
        .toBe(3);
      const people = await peopleNamed(KIOSK_SURNAME);
      expect(Object.keys(people).sort()).toEqual(['Dana', 'Fox', 'Wren']);
      const ids = Object.fromEntries(Object.entries(people).map(([first, row]) => [first, String(row.id)]));

      const members = await a32MeetMembers();
      expect(members).toContain(ids.Wren);
      expect(members).toContain(ids.Fox);

      const family = a32FamilyOf((await a32Record(ids.Dana)).body!);
      expect(family).not.toBeNull();
      expect(family!.attendees).toEqual(expect.arrayContaining([ids.Wren, ids.Fox, ids.Dana]));
      for (const first of ['Wren', 'Fox']) {
        const families = a32FamiliesOf((await a32Record(ids[first]!)).body!);
        expect(families.map((row) => row.id), `${first}'s families`).toEqual([family!.id]);
      }
      // The allergy note went with Wren, into the field the server keeps it in.
      const wren = (await a32Record(ids.Wren!)).body!;
      expect(String((wren.infos as { fixed?: { food_pref?: unknown } }).fixed?.food_pref ?? '')).toMatch(/peanuts/i);

      // The check-in the kiosk wrote is still theirs, under the same student ids.
      const attendance = await firestore.collection(`events/${nursery.id}/attendance`);
      const ours = (await firestore.collection('students')).filter((doc) => doc.data.lastName === KIOSK_SURNAME);
      expect(ours).toHaveLength(2);
      expect(ours.every((doc) => doc.data.pendingReview === false && doc.data.upstreamBackend === 'a32')).toBe(true);
      expect(attendance.filter((doc) => ours.some((student) => student.id === doc.data.studentId))).toHaveLength(2);
    } finally {
      await context.close();
      for (const row of Object.values(await peopleNamed(KIOSK_SURNAME))) await a32RemoveWithFamily(String(row.id));
      await removeKioskFamily(KIOSK_SURNAME, nursery.id);
      await firestore.remove('config/backends');
    }
  });
});
