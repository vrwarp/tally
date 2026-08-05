/**
 * Everything the kiosk does against Firebase, behind one dynamic import.
 *
 * The UI loads this module with `import()` after first paint — see KioskApp —
 * so the shell and keyboard are on screen before any of the SDK has parsed.
 * This module is the only place under src/kiosk/ that may import Firebase, and
 * it must only ever import `firebase/firestore/lite`: the whole reason the
 * kiosk is a separate page is to never download the realtime Firestore chunk.
 * `scripts/check-kiosk-budget.mjs` fails the build if that regresses.
 *
 * Lite means REST — no sockets, no listeners, no reconnect timers. The kiosk
 * reads on its own schedule and every read is explicit, which is exactly the
 * memory posture a device that runs for weeks needs.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  connectAuthEmulator,
  signInWithCustomToken,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  deleteField,
  serverTimestamp,
  where,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore/lite';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { parseStudentId } from '@/lib/backendIds';
import { missingKeys, parseFirebaseConfig } from '@/lib/firebaseConfig';
import { sanitizeLabelTemplate, type LabelTemplate } from '@/lib/labelTemplate';
import { paths } from '@/lib/paths';
import {
  attendancePayload,
  checkOutPayload,
  isFirstEver,
  studentDatePatch,
  type CheckInStudent,
} from '@/services/attendancePayloads';
import type { Grade, PcoRosterPerson } from '@/types';
import type { KioskBinding } from './binding';
import type { KioskStudent } from './search';
import {
  KIOSK_KEYS,
  readCachedRoster,
  readCachedRosterOfAnyVersion,
  readJson,
  writeCachedRoster,
  writeJson,
} from './storage';

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                   */
/* -------------------------------------------------------------------------- */

const env = import.meta.env;
const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true';
const DEMO_PROJECT_ID = 'demo-tally';

function readConfig() {
  const raw = env.VITE_FIREBASE_CONFIG?.trim();
  const demo = {
    apiKey: 'demo-api-key',
    authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
    projectId: DEMO_PROJECT_ID,
    storageBucket: `${DEMO_PROJECT_ID}.firebasestorage.app`,
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
  };

  if (!raw) {
    if (USE_EMULATORS) return demo;
    throw new Error('Missing VITE_FIREBASE_CONFIG. See src/lib/firebase.ts.');
  }
  const config = parseFirebaseConfig(raw);
  if (USE_EMULATORS) return { ...demo, ...config };

  const missing = missingKeys(config as Record<string, unknown>);
  if (missing.length > 0) {
    throw new Error(`VITE_FIREBASE_CONFIG is missing ${missing.join(', ')}.`);
  }
  // No authDomain gymnastics here: the kiosk never opens a popup or redirect —
  // its whole sign-in is a custom token from the pairing flow.
  return config;
}

const app: FirebaseApp = initializeApp(readConfig(), 'kiosk');

/**
 * No popup/redirect resolver, same reasoning as src/lib/firebase.ts — and
 * doubly so here, where nothing can ever open a popup. Persistence keeps the
 * paired session across reboots until the approver's account is deactivated.
 */
const auth: Auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});

const db: Firestore = getFirestore(app);
const functions = getFunctions(app);

if (USE_EMULATORS) {
  const host = env.VITE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:${Number(env.VITE_EMULATOR_AUTH_PORT ?? 9099)}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, host, Number(env.VITE_EMULATOR_FIRESTORE_PORT ?? 8080));
  connectFunctionsEmulator(functions, host, Number(env.VITE_EMULATOR_FUNCTIONS_PORT ?? 5001));
}

/* -------------------------------------------------------------------------- */
/* Callables                                                                   */
/* -------------------------------------------------------------------------- */

export interface KioskEventEntry {
  chain: string;
  id: string | null;
  title: string;
  startAt: number;
  endAt: number;
  checkInOpensAt: number;
  checkInClosesAt: number;
  seriesId: string | null;
  location: string | null;
  requiresCheckOut: boolean;
  labelTemplate: LabelTemplate | null;
}

const startKioskPairing = httpsCallable<void, { code: string; secret: string; expiresInSeconds: number }>(
  functions,
  'startKioskPairing',
);
const claimKioskToken = httpsCallable<
  { code: string; secret: string },
  { status: 'pending' | 'not-found' | 'expired' } | { status: 'ready'; token: string }
>(functions, 'claimKioskToken');
const getKioskEvents = httpsCallable<{ days?: number } | void, { events: KioskEventEntry[] }>(
  functions,
  'getKioskEvents',
);
const materializeOccurrence = httpsCallable<
  { chain: string; startAt: number },
  { id: string; created: boolean }
>(functions, 'materializeOccurrence');
// Type-only mirror of the server's RosterResponse — the kiosk reads `people`.
const getRoster = httpsCallable<{ force?: boolean } | void, { people: PcoRosterPerson[] }>(
  functions,
  'getRoster',
);
const refreshKioskPhoneIndex = httpsCallable<
  { force?: boolean } | void,
  { students: number; entries: number; builtAt: string }
>(functions, 'refreshKioskPhoneIndex');
/**
 * The same callable the check-in screen's allergy badge uses, asked one child at
 * a time. See `fetchAllergyNote`.
 */
const getAllergyNotes = httpsCallable<
  {
    pcoPersonIds?: readonly string[];
    personKeys?: ReadonlyArray<{ backendId: string; personId: string }>;
  },
  { notes: Record<string, string> }
>(functions, 'getAllergyNotes');

/* -------------------------------------------------------------------------- */
/* Auth & pairing                                                              */
/* -------------------------------------------------------------------------- */

/** The signed-in staff uid this kiosk writes as, or null before pairing. */
export async function restoredUid(): Promise<string | null> {
  await auth.authStateReady();
  return auth.currentUser?.uid ?? null;
}

export async function beginPairing(): Promise<{ code: string; secret: string; expiresInSeconds: number }> {
  const { data } = await startKioskPairing();
  return data;
}

/** One poll. Returns the uid once the token has been redeemed. */
export async function pollPairing(
  code: string,
  secret: string,
): Promise<'pending' | 'gone' | { uid: string }> {
  const { data } = await claimKioskToken({ code, secret });
  if (data.status === 'ready') {
    const credential = await signInWithCustomToken(auth, data.token);
    return { uid: credential.user.uid };
  }
  if (data.status === 'pending') return 'pending';
  return 'gone';
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export async function listEvents(): Promise<KioskEventEntry[]> {
  const { data } = await getKioskEvents();
  return data.events;
}

/**
 * Turns a chooser entry into a binding, materialising the occurrence when no
 * document stands for it yet.
 */
export async function bindEntry(entry: KioskEventEntry): Promise<KioskBinding> {
  let eventId = entry.id;
  if (!eventId) {
    const { data } = await materializeOccurrence({ chain: entry.chain, startAt: entry.startAt });
    eventId = data.id;
  }
  return {
    eventId,
    seriesId: entry.seriesId,
    title: entry.title,
    startAtMs: entry.startAt,
    endAtMs: entry.endAt,
    checkInClosesAtMs: entry.checkInClosesAt,
    requiresCheckOut: entry.requiresCheckOut,
    // Sanitised even though the server sent it: this is the value the kiosk
    // will read back out of localStorage for the rest of the evening, and the
    // renderer should never be handed a shape it has to defend against.
    labelTemplate: sanitizeLabelTemplate(entry.labelTemplate),
    boundAtMs: Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/* Roster                                                                      */
/* -------------------------------------------------------------------------- */

const ROSTER_REFRESH_MS = 6 * 60 * 60_000;

function rosterFromResponse(people: PcoRosterPerson[]): KioskStudent[] {
  return people
    .filter((person) => person.status === 'active')
    .map((person) => ({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      grade: person.grade,
      searchName: person.searchName,
      // The flag, never the note — the roster read carries one and not the
      // other on purpose, and the kiosk is the last place to blur that. What it
      // buys is the label asking about one child instead of four hundred.
      hasAllergies: person.hasAllergies === true,
    }));
}

/**
 * The searchable roster: the backends' people plus Tally's own documents —
 * the latter cover quick-added visitors no backend holds yet. Backend rows
 * win a collision because names are owned upstream.
 */
async function fetchRosterNow(): Promise<KioskStudent[]> {
  const [{ data }, docs] = await Promise.all([
    getRoster(),
    getDocs(query(collection(db, paths.students()), where('status', '==', 'active'))),
  ]);

  const byId = new Map<string, KioskStudent>();
  for (const snapshot of docs.docs) {
    const data = snapshot.data();
    const firstName = typeof data.firstName === 'string' ? data.firstName : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName : '';
    if (!firstName && !lastName) continue;
    byId.set(snapshot.id, {
      id: snapshot.id,
      firstName,
      lastName,
      grade: typeof data.grade === 'number' ? data.grade : null,
      searchName:
        typeof data.searchName === 'string' && data.searchName
          ? data.searchName
          : `${firstName} ${lastName}`.trim().toLowerCase(),
      // Always false, and not for want of looking: `noMirroredPersonalData` in
      // firestore.rules refuses an `allergies` key on a student document, so a
      // visitor no backend holds yet has nowhere for one to be. Once their push
      // lands they come back through `rosterFromResponse` with the real answer.
      hasAllergies: false,
    });
  }
  for (const student of rosterFromResponse(data.people)) byId.set(student.id, student);

  return [...byId.values()];
}

/**
 * The roster, cached-first: a reboot paints from localStorage and refreshes
 * behind the screen. `onUpdate` fires when a fresh copy differs in size —
 * cheap change detection is enough for a list that changes weekly.
 */
export async function loadRoster(onUpdate: (students: KioskStudent[]) => void): Promise<KioskStudent[]> {
  const stored = readCachedRoster();
  const fresh = () =>
    fetchRosterNow()
      .then((students) => {
        writeCachedRoster(students);
        onUpdate(students);
        return students;
      })
      // Any shape will do once the network has failed: an old cache still
      // answers "who is on the roster", and the alternative is a lobby screen
      // that cannot check anybody in. See `readCachedRosterOfAnyVersion`.
      .catch(() => stored?.students ?? readCachedRosterOfAnyVersion()?.students ?? []);

  if (stored) {
    if (Date.now() - stored.fetchedAtMs > ROSTER_REFRESH_MS) void fresh();
    return stored.students;
  }
  return fresh();
}

/* -------------------------------------------------------------------------- */
/* Allergies                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One child's allergy line, for a label that asks for it.
 *
 * The narrowest read in the kiosk, and narrow on purpose. `useAllergyNotes` on
 * the check-in screen asks about every flagged row it is rendering, because a
 * counselor is looking at all of them; a kiosk is looking at exactly one child,
 * the one whose parent is standing in front of it, so it asks about exactly one.
 * A roster of four hundred never crosses the wire and never lands in
 * localStorage — the caller in `printing/index.ts` holds the answer in memory
 * only, for as long as it takes to draw the sticker.
 *
 * Callers gate this on `hasAllergies`, so a child with nothing on file costs no
 * request at all. Null means "no note to print": nobody has one on file, or the
 * student is a visitor no backend holds. A *failed* read throws, because the
 * caller has a different answer for that — see `ALLERGY_UNREAD`.
 */
export async function fetchAllergyNote(studentId: string): Promise<string | null> {
  const key = parseStudentId(studentId);
  // A Tally-owned id has no upstream person to ask about. Their document cannot
  // hold allergies either, so there is nothing to have missed.
  if (!key) return null;

  const { data } = await getAllergyNotes(
    // Bare ids have always meant Planning Center to this callable and still do;
    // the named shape is for everybody else. Same split as `useAllergyNotes`.
    key.backendId === 'pco' ? { pcoPersonIds: [key.personId] } : { personKeys: [key] },
  );

  const note = data.notes[key.personId];
  return typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
}

/* -------------------------------------------------------------------------- */
/* Phone index                                                                 */
/* -------------------------------------------------------------------------- */

interface StoredPhoneIndex {
  fetchedAtMs: number;
  builtAtMs: number | null;
  last4: Record<string, string[]>;
}

const PHONE_INDEX_STALE_MS = 24 * 60 * 60_000;

async function fetchPhoneIndexNow(): Promise<StoredPhoneIndex> {
  const snapshot = await getDoc(doc(db, 'kioskIndex/phones'));
  const data = snapshot.exists() ? snapshot.data() : null;
  const builtAt = data?.builtAt;
  return {
    fetchedAtMs: Date.now(),
    builtAtMs:
      builtAt && typeof (builtAt as { toDate?: unknown }).toDate === 'function'
        ? (builtAt as { toDate(): Date }).toDate().getTime()
        : null,
    last4:
      data && typeof data.last4 === 'object' && data.last4 !== null
        ? (data.last4 as Record<string, string[]>)
        : {},
  };
}

/**
 * The last-4 map, cached-first like the roster. When the *stored index
 * document* is stale — missing, or built more than a day ago — the kiosk asks
 * the server to rebuild and refetches, so a family added this week is
 * findable tonight without anybody thinking about it.
 */
export async function loadPhoneIndex(
  onUpdate: (last4: Record<string, string[]>) => void,
): Promise<Record<string, string[]>> {
  const stored = readJson<StoredPhoneIndex>(KIOSK_KEYS.phoneIndex);

  const refresh = async (): Promise<StoredPhoneIndex> => {
    let index = await fetchPhoneIndexNow();
    if (index.builtAtMs === null || Date.now() - index.builtAtMs > PHONE_INDEX_STALE_MS) {
      try {
        await refreshKioskPhoneIndex();
        index = await fetchPhoneIndexNow();
      } catch {
        // The backends may be down; the stored index still answers.
      }
    }
    writeJson(KIOSK_KEYS.phoneIndex, index);
    onUpdate(index.last4);
    return index;
  };

  if (stored && stored.last4 && Object.keys(stored.last4).length > 0) {
    if (Date.now() - stored.fetchedAtMs > PHONE_INDEX_STALE_MS) void refresh().catch(() => {});
    return stored.last4;
  }
  return (await refresh().catch(() => ({ fetchedAtMs: 0, builtAtMs: null, last4: {} }))).last4;
}

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Who is already checked in, and who has been collected — one explicit read,
 * no listener.
 *
 * The register used to be reduced to its ids on the way past. A pickup screen
 * needs to tell "here" from "gone", which is the same read of the same
 * documents at the same cost: only the discarding changes.
 */
export interface KioskAttendance {
  present: Set<string>;
  checkedOut: Set<string>;
}

export async function fetchAttendance(eventId: string): Promise<KioskAttendance> {
  const snapshot = await getDocs(collection(db, paths.attendanceCollection(eventId)));
  return {
    present: new Set(snapshot.docs.map((docSnapshot) => docSnapshot.id)),
    checkedOut: new Set(
      snapshot.docs
        .filter((docSnapshot) => docSnapshot.get('checkedOutAt') != null)
        .map((docSnapshot) => docSnapshot.id),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Check-in                                                                    */
/* -------------------------------------------------------------------------- */

const CLOCK = { serverTimestamp, deleteField };
const MAX_QUEUED = 50;

interface PendingCheckIn {
  kind?: 'check-in';
  eventId: string;
  seriesId: string | null;
  startAtMs: number;
  studentId: string;
  student: { firstName: string; lastName: string; grade: number | null; searchName: string };
  uid: string;
  queuedAtMs: number;
}

/**
 * A pickup the network dropped. Far smaller than a check-in because it patches
 * a document that already exists — there is no student to describe.
 *
 * `kind` is optional on the check-in above so a queue written before pickup
 * existed still reads: an entry with no discriminator is a check-in, which is
 * all it could have been.
 */
interface PendingCheckOut {
  kind: 'check-out';
  eventId: string;
  studentId: string;
  uid: string;
  queuedAtMs: number;
}

type PendingWrite = PendingCheckIn | PendingCheckOut;

function toDateOrNull(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate(): Date }).toDate();
  }
  return null;
}

/**
 * The same two writes `src/services/attendance.ts#checkIn` makes, through the
 * lite SDK, sharing the payload builders so the documents cannot drift.
 *
 * Reads the student document first for the two dates `isFirstEver` and the
 * patch depend on — the roster payload does not carry them. The confirm screen
 * calls `warmStudentDates` when it opens, so by the time a thumb reaches the
 * button this read has usually already resolved.
 */
export async function performCheckIn(args: {
  binding: Pick<KioskBinding, 'eventId' | 'seriesId' | 'startAtMs'>;
  student: { id: string; firstName: string; lastName: string; grade: number | null; searchName: string };
  uid: string;
}): Promise<void> {
  const { binding, student, uid } = args;

  const dates = await studentDates(student.id);

  const checkInStudent: CheckInStudent = {
    id: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    // Straight through. `KioskStudent.grade` has always been nullable; it was
    // the domain model underneath that could not hold the answer.
    grade: student.grade as Grade | null,
    searchName: student.searchName,
    firstAttendedAt: dates.firstAttendedAt,
    lastAttendedAt: dates.lastAttendedAt,
  };

  const event = { id: binding.eventId, seriesId: binding.seriesId, startAt: new Date(binding.startAtMs) };

  const batch = writeBatch(db);
  batch.set(
    doc(db, paths.attendance(event.id, student.id)),
    attendancePayload(CLOCK, {
      event,
      studentId: student.id,
      uid,
      method: 'kiosk',
      isFirstEver: isFirstEver(checkInStudent),
    }),
  );
  const patch = studentDatePatch(CLOCK, checkInStudent, event, uid);
  if (patch) batch.set(doc(db, paths.student(student.id)), patch, { merge: true });

  await batch.commit();
}

/**
 * Records a pickup from the lobby.
 *
 * `updateDoc`, emphatically not the `writeBatch.set` that `performCheckIn`
 * uses: a whole-document set reads as "touches every key" to the rules'
 * `touchesOnly`, so the check-out rule would refuse it. It also means a pickup
 * for a child nobody checked in fails rather than inventing a record.
 *
 * No undo counterpart, deliberately. The kiosk has never offered one for
 * check-in either — a bystander clearing a collection somebody witnessed is
 * not a self-serve action — and the rules enforce that rather than trusting
 * this file to keep the promise.
 */
export async function performCheckOut(args: {
  eventId: string;
  studentId: string;
  uid: string;
}): Promise<void> {
  await updateDoc(
    doc(db, paths.attendance(args.eventId, args.studentId)),
    checkOutPayload(CLOCK, args.uid),
  );
}

const dateCache = new Map<string, Promise<{ firstAttendedAt: Date | null; lastAttendedAt: Date | null }>>();

function studentDates(studentId: string): Promise<{ firstAttendedAt: Date | null; lastAttendedAt: Date | null }> {
  let promise = dateCache.get(studentId);
  if (!promise) {
    promise = getDoc(doc(db, paths.student(studentId)))
      .then((snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        return {
          firstAttendedAt: toDateOrNull(data?.firstAttendedAt),
          lastAttendedAt: toDateOrNull(data?.lastAttendedAt),
        };
      })
      .catch(() => {
        dateCache.delete(studentId);
        return { firstAttendedAt: null, lastAttendedAt: null };
      });
    dateCache.set(studentId, promise);
  }
  return promise;
}

/** Called when the confirm screen opens, so the write is not gated on a read. */
export function warmStudentDates(studentId: string): void {
  void studentDates(studentId);
}

/** After a write lands, the cached dates are stale — the write moved them. */
export function forgetStudentDates(studentId: string): void {
  dateCache.delete(studentId);
}

/* -------------------------------------------------------------------------- */
/* The retry queue                                                             */
/* -------------------------------------------------------------------------- */

/*
 * A check-in the network dropped is retried until it lands. Safe because the
 * attendance document id *is* the student id: replaying a write that actually
 * landed converges on the same document. The replay stamps its own moment
 * rather than the original one — the queue exists for blips measured in
 * seconds, and a serverTimestamp sentinel cannot be serialized anyway.
 */

function readQueue(): PendingWrite[] {
  const stored = readJson<PendingWrite[]>(KIOSK_KEYS.pending);
  return Array.isArray(stored) ? stored : [];
}

/** A pickup the network dropped. Same convergence argument as a check-in. */
export function enqueueCheckOut(args: {
  binding: Pick<KioskBinding, 'eventId'>;
  student: { id: string };
  uid: string;
}): void {
  const queue = readQueue().filter(
    (entry) =>
      !(
        entry.kind === 'check-out' &&
        entry.eventId === args.binding.eventId &&
        entry.studentId === args.student.id
      ),
  );
  queue.push({
    kind: 'check-out',
    eventId: args.binding.eventId,
    studentId: args.student.id,
    uid: args.uid,
    queuedAtMs: Date.now(),
  });
  writeJson(KIOSK_KEYS.pending, queue.slice(-MAX_QUEUED));
}

export function enqueueCheckIn(args: {
  binding: Pick<KioskBinding, 'eventId' | 'seriesId' | 'startAtMs'>;
  student: { id: string; firstName: string; lastName: string; grade: number | null; searchName: string };
  uid: string;
}): void {
  const queue = readQueue().filter(
    (entry) => !(entry.eventId === args.binding.eventId && entry.studentId === args.student.id),
  );
  queue.push({
    eventId: args.binding.eventId,
    seriesId: args.binding.seriesId,
    startAtMs: args.binding.startAtMs,
    studentId: args.student.id,
    student: {
      firstName: args.student.firstName,
      lastName: args.student.lastName,
      grade: args.student.grade,
      searchName: args.student.searchName,
    },
    uid: args.uid,
    queuedAtMs: Date.now(),
  });
  writeJson(KIOSK_KEYS.pending, queue.slice(-MAX_QUEUED));
}

/** Attempts everything queued; returns how many are still stuck. */
export async function replayQueue(): Promise<number> {
  const queue = readQueue();
  if (queue.length === 0) return 0;

  const stuck: PendingWrite[] = [];
  for (const entry of queue) {
    try {
      if (entry.kind === 'check-out') {
        await performCheckOut({ eventId: entry.eventId, studentId: entry.studentId, uid: entry.uid });
      } else {
        await performCheckIn({
          binding: { eventId: entry.eventId, seriesId: entry.seriesId, startAtMs: entry.startAtMs },
          student: { id: entry.studentId, ...entry.student },
          uid: entry.uid,
        });
      }
    } catch (error) {
      // permission-denied is not "try later", it is "this write will never be
      // accepted" — the student is frozen, the kiosk may only create a
      // check-in, or a pickup is already recorded and only staff may move one.
      // Either way retrying forever helps nobody.
      if ((error as { code?: string }).code?.includes('permission-denied')) continue;
      stuck.push(entry);
    }
  }
  writeJson(KIOSK_KEYS.pending, stuck);
  return stuck.length;
}
