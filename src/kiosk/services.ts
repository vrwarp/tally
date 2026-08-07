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
import type {
  Grade,
  PcoRosterPerson,
  RegisterFamilyRequest,
  RegisterFamilyResult,
} from '@/types';
import type { KioskBinding } from './binding';
import { joinKioskRoster } from './roster';
import type { KioskStudent } from './search';
import {
  KIOSK_KEYS,
  participationScope,
  readCachedRoster,
  readCachedRosterOfAnyVersion,
  readJson,
  writeCachedRoster,
  writeCachedPulse,
  writeJson,
  type CachedParticipation,
  type CachedPulse,
  type KioskParticipationScope,
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
  /** See the server's `KioskEventEntry` — `predictionChain`, not `chainKey`. */
  predictsFrom: string | null;
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
  /**
   * Whether the wizard should ask about allergies. Optional on the wire so a
   * new bundle against old functions reads `undefined` — and `undefined` must
   * mean "don't ask": old functions refuse a kiosk allergy note outright, so
   * asking the question there would fail the whole registration, not merely
   * drop the answer.
   */
  allergiesSupported?: boolean;
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
const refreshKioskParticipation = httpsCallable<
  void,
  { chains: number; instances: number; students: number; builtAt: string }
>(functions, 'refreshKioskParticipation');
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
const registerFamilyCallable = httpsCallable<RegisterFamilyRequest, RegisterFamilyResult>(
  functions,
  'registerFamily',
);
const mintRegistrationCodeCallable = httpsCallable<
  { eventId?: string } | void,
  { code: string; expiresAt: number; rotateAfterMs: number }
>(functions, 'mintRegistrationCode');

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
    // Carried, not derived: the roster's notion of which chain predicts for a
    // gathering lives in the app's bundle and the kiosk does not download it.
    predictsFrom: entry.predictsFrom ?? null,
    title: entry.title,
    startAtMs: entry.startAt,
    endAtMs: entry.endAt,
    checkInClosesAtMs: entry.checkInClosesAt,
    requiresCheckOut: entry.requiresCheckOut,
    // Sanitised even though the server sent it: this is the value the kiosk
    // will read back out of localStorage for the rest of the evening, and the
    // renderer should never be handed a shape it has to defend against.
    labelTemplate: sanitizeLabelTemplate(entry.labelTemplate),
    // Only ever an explicit true: absent, null, or anything else a stale
    // server sent reads as "don't ask" (see the entry field's comment).
    allergiesSupported: entry.allergiesSupported === true,
    boundAtMs: Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/* Roster                                                                      */
/* -------------------------------------------------------------------------- */

const ROSTER_REFRESH_MS = 6 * 60 * 60_000;

/**
 * The searchable roster: the backends' people plus Tally's own documents —
 * the latter cover quick-added visitors no backend holds yet.
 *
 * The join itself is in `./roster`, pure and tested: it is by *linkage* rather
 * than by id, because a pushed visitor is reachable under two of them and this
 * used to draw both.
 */
async function fetchRosterNow(force = false): Promise<KioskStudent[]> {
  const [{ data }, docs] = await Promise.all([
    getRoster({ force }),
    getDocs(query(collection(db, paths.students()), where('status', '==', 'active'))),
  ]);

  return joinKioskRoster(
    docs.docs.map((snapshot) => ({ id: snapshot.id, data: snapshot.data() })),
    data.people,
  );
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
/* Participation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Who has been to this gathering, and who comes to it regularly.
 *
 * The two answers the lobby screen has never had. Without them the search is
 * every active student in Tally — a parent at Friday Fellowship typing four
 * digits can be shown a family who has only ever come to Sunday nursery, or a
 * stranger who happens to share a phone tail — and every child answering to a
 * household's number arrives pre-ticked whether or not they come to this.
 *
 * Both are computed nightly by `functions/src/kiosk/participation.ts` and read
 * here as one document. The kiosk cannot work them out for itself: it holds no
 * event history, and sweeping a year of registers is not something to do with a
 * parent standing at the screen.
 */
export type KioskParticipation = KioskParticipationScope;

const PARTICIPATION_STALE_MS = 24 * 60 * 60_000;

async function fetchParticipationNow(): Promise<CachedParticipation> {
  const snapshot = await getDoc(doc(db, 'kioskIndex/participation'));
  const data = snapshot.exists() ? snapshot.data() : null;
  const builtAt = data?.builtAt;
  return {
    fetchedAtMs: Date.now(),
    builtAtMs:
      builtAt && typeof (builtAt as { toDate?: unknown }).toDate === 'function'
        ? (builtAt as { toDate(): Date }).toDate().getTime()
        : null,
    chains:
      data && typeof data.chains === 'object' && data.chains !== null
        ? (data.chains as CachedParticipation['chains'])
        : {},
  };
}

/**
 * The scope for one chain, cached-first exactly as `loadPhoneIndex` is.
 *
 * Same staleness posture too: when the *stored document* is missing or was built
 * more than a day ago, the kiosk asks the server to rebuild and refetches — so a
 * gathering that met for the first time last night scopes correctly tonight
 * without anybody thinking about it.
 *
 * Every failure lands on `NO_PARTICIPATION`, which every caller reads as "search
 * everybody, tick everybody" — the behaviour the kiosk had before this existed.
 * That direction is not an accident: a scope that fails closed is a family who
 * cannot find themselves.
 */
export async function loadParticipation(
  chain: string | null | undefined,
  onUpdate: (scope: KioskParticipation) => void,
): Promise<KioskParticipation> {
  const stored = readJson<CachedParticipation>(KIOSK_KEYS.participation);

  const refresh = async (): Promise<CachedParticipation> => {
    let index = await fetchParticipationNow();
    if (index.builtAtMs === null || Date.now() - index.builtAtMs > PARTICIPATION_STALE_MS) {
      try {
        await refreshKioskParticipation();
        index = await fetchParticipationNow();
      } catch {
        // Nothing to rebuild from, or no permission. The stored copy still
        // answers, and an absent one means an unscoped search.
      }
    }
    writeJson(KIOSK_KEYS.participation, index);
    onUpdate(participationScope(index, chain));
    return index;
  };

  if (stored && stored.chains) {
    if (Date.now() - stored.fetchedAtMs > PARTICIPATION_STALE_MS) void refresh().catch(() => {});
    return participationScope(stored, chain);
  }
  return participationScope(await refresh().catch(() => null), chain);
}

/* -------------------------------------------------------------------------- */
/* The pulse                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The live revisions of the sentinel the functions bump whenever kiosk-visible
 * data changes — see functions/src/kiosk/pulse.ts for who bumps and when.
 *
 * This is what retired the "I've registered" ritual: instead of a parent
 * pressing a button to force a refetch, the kiosk reads this one small document
 * on a short cadence and refetches only the channels whose revision moved. The
 * revisions are opaque change markers — compared with `!==`, never ordered —
 * and the `registration` channel additionally names the gathering a QR
 * registration was made against, so the kiosk showing that QR can bring the
 * search screen up before the family has walked back to it.
 */
export interface KioskPulse {
  roster: number;
  phones: number;
  participation: number;
  registration: { rev: number; eventId: string | null };
}

function pulseChannel(data: Record<string, unknown> | null, name: string): number {
  const held = (data?.[name] ?? {}) as Record<string, unknown>;
  return typeof held.rev === 'number' && Number.isFinite(held.rev) ? held.rev : 0;
}

/**
 * One cheap read of the pulse, or null for "no signal".
 *
 * Null covers a document nobody has bumped yet, an unreachable network, and a
 * deployment whose functions predate the pulse — and in every one of those the
 * TTLs the loaders already run under keep governing. Fail open, always.
 */
export async function fetchPulse(): Promise<KioskPulse | null> {
  try {
    const snapshot = await getDoc(doc(db, 'kioskIndex/pulse'));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    const registration = (data?.registration ?? {}) as Record<string, unknown>;
    return {
      roster: pulseChannel(data, 'roster'),
      phones: pulseChannel(data, 'phones'),
      participation: pulseChannel(data, 'participation'),
      registration: {
        rev: pulseChannel(data, 'registration'),
        eventId: typeof registration.eventId === 'string' ? registration.eventId : null,
      },
    };
  } catch {
    return null;
  }
}

/** Remembers which revisions this kiosk has acted on, across reboots. */
export function rememberPulse(pulse: CachedPulse): void {
  writeCachedPulse(pulse);
}

/*
 * The three soft refetchers the poll routes to, deliberately *unforced*: the
 * pulse already said the stored data changed, so plain reads suffice — no
 * rebuild callables, no `force: true`, no sweep of the backends. Each follows
 * the loaders' shape (write the cache, then tell the screen) and swallows its
 * errors, because a failed refetch leaves the kiosk exactly where it was and
 * the next poll tries again.
 */

/**
 * Re-reads the roster because the pulse said it moved.
 *
 * The `getRoster` half may serve the server's cached backend people, and that
 * is fine: a just-registered or just-quick-added child's document comes from
 * the direct students query, which is never cached. The backend half of the
 * signal only ever follows the nightly index build, which has just swept the
 * backends itself.
 */
export async function refetchRoster(onUpdate: (students: KioskStudent[]) => void): Promise<void> {
  try {
    const students = await fetchRosterNow();
    writeCachedRoster(students);
    onUpdate(students);
  } catch {
    // The kiosk keeps what it had; the next poll tries again.
  }
}

export async function refetchPhoneIndex(
  onUpdate: (last4: Record<string, string[]>) => void,
): Promise<void> {
  try {
    const index = await fetchPhoneIndexNow();
    writeJson(KIOSK_KEYS.phoneIndex, index);
    onUpdate(index.last4);
  } catch {
    // Same posture as refetchRoster.
  }
}

export async function refetchParticipation(
  chain: string | null | undefined,
  onUpdate: (scope: KioskParticipation) => void,
): Promise<void> {
  try {
    const index = await fetchParticipationNow();
    writeJson(KIOSK_KEYS.participation, index);
    onUpdate(participationScope(index, chain));
  } catch {
    // Same posture as refetchRoster.
  }
}

/* -------------------------------------------------------------------------- */
/* Checking again, on demand                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Both halves of what the search matches against, pulled again from upstream —
 * the button a family gets when the kiosk cannot find them.
 *
 * Forced, and that is the entire point. Every other read on this page is
 * cached-first with a TTL measured in hours, and the server's own copy of the
 * church is cached behind that again, so an unforced "look again" would re-read
 * exactly the answer that just failed to find somebody and report it as news.
 * A family standing at a screen being told to go and find a leader is worth one
 * real read.
 *
 * Concurrently, and reported through callbacks the way `loadRoster` does rather
 * than in the return value, because the two are different sweeps of different
 * sizes and the person who asked is standing at the kiosk watching. A name that
 * has arrived has arrived; making it wait behind a rebuild of every phone number
 * in the church would be holding back the answer to look tidy.
 *
 * `allSettled` for the same reason: half an answer is still an answer, and the
 * caller keeps what it already had for the half that failed. Only a refresh
 * where *neither* half landed rejects, so "couldn't reach the network" on screen
 * means what it says.
 */
export async function refreshDirectory(
  onRoster: (students: KioskStudent[]) => void,
  onPhoneIndex: (last4: Record<string, string[]>) => void,
): Promise<void> {
  const [roster, phones] = await Promise.allSettled([
    fetchRosterNow(true).then((students) => {
      writeCachedRoster(students);
      onRoster(students);
    }),
    refreshKioskPhoneIndex({ force: true })
      .then(() => fetchPhoneIndexNow())
      .then((index) => {
        writeJson(KIOSK_KEYS.phoneIndex, index);
        onPhoneIndex(index.last4);
      }),
  ]);

  if (roster.status === 'rejected' && phones.status === 'rejected') throw roster.reason;
}

/* -------------------------------------------------------------------------- */
/* Self-registration                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A family typing themselves in.
 *
 * Everything a registration writes happens on the server — see
 * functions/src/kiosk/registration.ts for why a kiosk session cannot create a
 * usable student itself. The `registrationId` is minted by the caller once per
 * wizard run and re-sent on a retry, which is what makes a lost response safe
 * to retry rather than a second family.
 */
export async function registerFamily(
  request: RegisterFamilyRequest,
): Promise<RegisterFamilyResult> {
  const { data } = await registerFamilyCallable(request);
  return data;
}

/**
 * Folds a completed registration into what this kiosk holds locally, so the
 * family is searchable the moment they walk back to the screen.
 *
 * The server has already patched `kioskIndex/phones`, but the kiosk reads that
 * document on a 24-hour cadence — it would not see its own registration until
 * tomorrow. Rather than force a refetch while a parent waits, the answer that
 * came back with the response is merged into both caches directly. A refetch
 * later can only agree with it.
 */
export function applyRegistration(result: {
  children: readonly {
    studentId: string;
    firstName: string;
    lastName: string;
    grade: number | null;
    searchName: string;
    hasAllergies?: boolean;
  }[];
  last4: string;
}): KioskStudent[] {
  const students: KioskStudent[] = result.children.map((child) => ({
    id: child.studentId,
    firstName: child.firstName,
    lastName: child.lastName,
    grade: child.grade as Grade | null,
    searchName: child.searchName,
    // The callable's echo, because nothing else knows tonight: the roster
    // read answers false for every Tally-owned student by rule, and the note
    // itself is on the registration record, not the student. The marker
    // survives locally until the next roster rebuild — an evening-of
    // affordance, made permanent when approval pushes the note upstream.
    hasAllergies: child.hasAllergies === true,
  }));

  const cached = readCachedRoster();
  if (cached) {
    const byId = new Map(cached.students.map((student) => [student.id, student]));
    for (const student of students) byId.set(student.id, student);
    writeCachedRoster([...byId.values()]);
  }

  // Empty for a sibling registration whose family answers to no digits at all
  // — their household number never reached a backend. Writing it would file
  // every such child under one nameless bucket that the search can never hit.
  const storedIndex = result.last4 ? readJson<StoredPhoneIndex>(KIOSK_KEYS.phoneIndex) : null;
  if (storedIndex && storedIndex.last4) {
    const held = storedIndex.last4[result.last4] ?? [];
    writeJson(KIOSK_KEYS.phoneIndex, {
      ...storedIndex,
      last4: {
        ...storedIndex.last4,
        [result.last4]: [...new Set([...held, ...students.map((student) => student.id)])].sort(),
      },
    } satisfies StoredPhoneIndex);
  }

  return students;
}

/** The short-lived code the kiosk puts in its QR. See functions/src/kiosk/registrationCodes.ts. */
export async function mintRegistrationCode(
  eventId: string,
): Promise<{ code: string; rotateAfterMs: number }> {
  // The code remembers the gathering, so a registration made against it can
  // wake this kiosk's QR screen — see `fetchPulse` and the auto-advance in
  // KioskApp. Nothing else about the code changes.
  const { data } = await mintRegistrationCodeCallable({ eventId });
  return { code: data.code, rotateAfterMs: data.rotateAfterMs };
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
  /**
   * Student id -> the arrival that put them here, for the ones that carry one.
   *
   * Missing for anything the main app wrote and for everything recorded before
   * arrivals existed. That absence is meaningful and is not the same as an
   * arrival of one — see `attendancePayload`.
   */
  arrivals: Map<string, string>;
}

export async function fetchAttendance(eventId: string): Promise<KioskAttendance> {
  const snapshot = await getDocs(collection(db, paths.attendanceCollection(eventId)));
  const arrivals = new Map<string, string>();
  for (const docSnapshot of snapshot.docs) {
    const arrivalId: unknown = docSnapshot.get('arrivalId');
    if (typeof arrivalId === 'string' && arrivalId) arrivals.set(docSnapshot.id, arrivalId);
  }
  return {
    present: new Set(snapshot.docs.map((docSnapshot) => docSnapshot.id)),
    checkedOut: new Set(
      snapshot.docs
        .filter((docSnapshot) => docSnapshot.get('checkedOutAt') != null)
        .map((docSnapshot) => docSnapshot.id),
    ),
    arrivals,
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
  /**
   * Optional for the same reason `kind` is: a queue written before arrivals
   * existed still replays, as a check-in that makes no claim about who else
   * came through the door with them.
   */
  arrivalId?: string;
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
  /** The arrival this child was part of — see `attendancePayload`. */
  arrivalId?: string;
}): Promise<void> {
  const { binding, student, uid, arrivalId } = args;

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
      arrivalId,
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
  arrivalId?: string;
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
    arrivalId: args.arrivalId,
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
          arrivalId: entry.arrivalId,
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
