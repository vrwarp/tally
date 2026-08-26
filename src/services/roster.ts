/**
 * The roster: the people backends, read on demand, merged with what Tally owns.
 *
 * There is no `students` mirror any more. A roster is built from two sources:
 *
 *   1. The connected people backends — Planning Center, Attendees — through the
 *      `getRoster` callable. This is where names, grades and "is there an
 *      allergy" come from, and it is authoritative.
 *   2. Firestore `students/`, which holds only what the backends have no
 *      opinion about — a note somebody typed, when this student first turned
 *      up — plus the full record for a quick-added visitor who does not exist
 *      upstream yet.
 *
 * Most students never get a Firestore document at all. One is written the first
 * time Tally has something of its own to say about them, which for a typical
 * student is the first time they are checked in.
 *
 * ## Why there is still a browser-side cache
 *
 * Because a counselor at a church door has one bar of signal and cannot wait for
 * a Cloud Function to page through Planning Center before the first name
 * appears. That is a different thing from the mirror this design removed: it
 * lives in this tab, it is never queried, nothing else reads it, and it is
 * replaced wholesale by the next successful read. It is what the browser would
 * do for any other network response.
 *
 * With more than one backend connected the replacement is per backend rather
 * than wholesale: a read that reached Planning Center but not Attendees keeps
 * the Attendees students it was already holding, because "one backend is down"
 * must not blank half the roster at a church door.
 */
import { getRoster, type RosterBackendStatus } from '@/services/functions';
import { fromRosterPerson } from '@/services/converters';
import { parseStudentId, type BackendId, type PcoRosterPerson, type Student } from '@/types';

export { mergeRoster } from '@/features/roster/mergeRoster';

/** Where the last good roster is parked so a cold start has something to draw. */
const CACHE_KEY = 'tally:roster';

/**
 * How old a stored roster may be before it is treated as a last resort rather
 * than as an answer.
 *
 * Long, on purpose: a stale roster is enormously better than an empty one when
 * the alternative is a counselor unable to check anybody in. It is only ever
 * shown while a fresh read is in flight, or after one has failed — or, per
 * backend, while that backend stays unreachable.
 */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface RosterSnapshot {
  students: Student[];
  /** When the backends were actually read. Null for a roster from storage. */
  fetchedAt: Date | null;
  /** True when this came out of local storage rather than off the network. */
  offline: boolean;
  /**
   * Each backend's own outcome, when the server reported them. A failed entry
   * means that backend's students on this snapshot are its last good copy —
   * worth a banner, not a blank.
   */
  perBackend?: RosterBackendStatus[];
}

interface StoredRoster {
  people: PcoRosterPerson[];
  storedAt: number;
  /**
   * When each backend's slice was last actually read off the network. Absent
   * on a roster stored before backends could fail separately — `storedAt`
   * answers for everybody then. This is what ends the per-backend retention:
   * a backend down for longer than `STALE_AFTER_MS` stops being carried.
   */
  freshAt?: Partial<Record<BackendId, number>>;
}

/** Which backend a stored person belongs to; their row id says. */
function backendOfPerson(person: PcoRosterPerson): BackendId {
  return person.backendId ?? parseStudentId(person.id)?.backendId ?? 'pco';
}

/* -------------------------------------------------------------------------- */
/* Local storage                                                               */
/* -------------------------------------------------------------------------- */

function readStored(): StoredRoster | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredRoster>;
    if (!Array.isArray(parsed.people) || typeof parsed.storedAt !== 'number') return null;
    if (Date.now() - parsed.storedAt > STALE_AFTER_MS) return null;

    return {
      people: parsed.people,
      storedAt: parsed.storedAt,
      ...(parsed.freshAt && typeof parsed.freshAt === 'object' ? { freshAt: parsed.freshAt } : {}),
    };
  } catch {
    // Corrupt JSON, a quota error, Safari in private mode. None of these are
    // worth a broken screen — the roster simply has to be fetched.
    return null;
  }
}

function writeStored(stored: StoredRoster): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(stored));
  } catch {
    /* Out of quota is not a reason to fail a check-in. */
  }
}

/**
 * Replaces one person in the roster parked on this device.
 *
 * So that a save survives a reload. The in-memory roster is corrected from a
 * write's own answer rather than by re-reading the backend (see
 * `applyRosterPerson`), and without this the copy in storage would still hold
 * the pre-edit row — which is what a cold start paints from, so a leader who
 * saved a birthday and reloaded would watch it disappear until the first read
 * came back.
 *
 * A person the stored roster does not hold is not added: storage mirrors the
 * last read, and a row that read never returned is not this function's to
 * invent. `storedAt` and `freshAt` are deliberately left alone: correcting one
 * person does not make the other four hundred any fresher.
 */
export function rememberRosterPerson(person: PcoRosterPerson): void {
  const stored = readStored();
  if (!stored) return;
  if (!stored.people.some((held) => held.id === person.id)) return;

  writeStored({
    ...stored,
    people: stored.people.map((held) => (held.id === person.id ? person : held)),
  });
}

/** Called on sign-out: the next person to use this device is not this person. */
export function forgetRoster(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* Nothing to do about it, and nothing depends on it. */
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** The roster held from a previous session, or null. Never throws. */
export function cachedRoster(now = new Date()): RosterSnapshot | null {
  const stored = readStored();
  if (!stored) return null;

  return {
    students: stored.people.map((person) => fromRosterPerson(person, now)),
    fetchedAt: null,
    offline: true,
  };
}

/**
 * Reads the roster from every connected backend.
 *
 * Throws on failure rather than silently returning the stored copy: the caller
 * decides whether falling back is appropriate, because "showing you Friday's
 * roster because we cannot reach Planning Center" is something a counselor
 * should be told rather than something that should look like success.
 *
 * A *partial* failure — some backends answered, some did not — is not a throw.
 * The server already decided it was an answer, and this function's job is to
 * keep the failed backends' people from vanishing: their last good copy is
 * lifted out of storage and kept on the roster, for as long as the staleness
 * window allows. The `perBackend` report says which rows those are.
 */
export async function fetchRoster(now = new Date(), force = false): Promise<RosterSnapshot> {
  const response = await getRoster({ force });
  const fresh = response.data.people ?? [];
  const perBackend = response.data.perBackend;
  const readAt = Date.now();

  const failed = new Set((perBackend ?? []).filter((entry) => !entry.ok).map((entry) => entry.backendId));
  /*
   * Stryker disable next-line ConditionalExpression,EqualityOperator: reading
   * storage unconditionally answers the same — nothing is carried when nothing
   * failed, and the freshness stamps below only consult `stored` for a backend
   * that did. The guard is here so the common case does not parse a few hundred
   * people out of `localStorage` on every read.
   */
  const stored = failed.size > 0 ? readStored() : null;

  let people = fresh;
  if (stored) {
    const kept = stored.people.filter((held) => {
      const backendId = backendOfPerson(held);
      if (!failed.has(backendId)) return false;
      // Held only while the copy is younger than the staleness window — a
      // backend gone for a week has expired, same as a whole stored roster.
      return readAt - (stored.freshAt?.[backendId] ?? stored.storedAt) <= STALE_AFTER_MS;
    });
    if (kept.length > 0) {
      people = [...fresh, ...kept].sort((a, b) =>
        a.searchName < b.searchName ? -1 : a.searchName > b.searchName ? 1 : 0,
      );
    }
  }

  // Every answering backend's slice is fresh as of now; a failed backend keeps
  // the timestamp its carried copy really has.
  let freshAt: StoredRoster['freshAt'];
  for (const entry of perBackend ?? []) {
    const at = entry.ok ? readAt : (stored?.freshAt?.[entry.backendId] ?? stored?.storedAt);
    if (at !== undefined) freshAt = { ...(freshAt ?? {}), [entry.backendId]: at };
  }

  writeStored({ people, storedAt: readAt, ...(freshAt ? { freshAt } : {}) });

  return {
    students: people.map((person) => fromRosterPerson(person, now)),
    fetchedAt: new Date(response.data.fetchedAt),
    offline: false,
    ...(perBackend ? { perBackend } : {}),
  };
}
