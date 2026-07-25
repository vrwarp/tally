/**
 * The roster: Planning Center, read on demand, merged with what Tally owns.
 *
 * There is no `students` mirror any more. A roster is built from two sources:
 *
 *   1. Planning Center, through the `getRoster` callable. This is where names,
 *      grades and "is there an allergy" come from, and it is authoritative.
 *   2. Firestore `students/`, which holds only what Planning Center has no
 *      opinion about — the small group a counselor assigned, a note somebody
 *      typed, when this student first turned up — plus the full record for a
 *      quick-added visitor who does not exist upstream yet.
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
 */
import { getRoster } from '@/services/functions';
import { fromRosterPerson } from '@/services/converters';
import type { PcoRosterPerson, Student } from '@/types';

export { mergeRoster } from '@/features/roster/mergeRoster';

/** Where the last good roster is parked so a cold start has something to draw. */
const CACHE_KEY = 'tally:roster';

/**
 * How old a stored roster may be before it is treated as a last resort rather
 * than as an answer.
 *
 * Long, on purpose: a stale roster is enormously better than an empty one when
 * the alternative is a counselor unable to check anybody in. It is only ever
 * shown while a fresh read is in flight, or after one has failed.
 */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface RosterSnapshot {
  students: Student[];
  /** When Planning Center was actually read. Null for a roster from storage. */
  fetchedAt: Date | null;
  /** True when this came out of local storage rather than off the network. */
  offline: boolean;
}

interface StoredRoster {
  people: PcoRosterPerson[];
  storedAt: number;
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

    return { people: parsed.people, storedAt: parsed.storedAt };
  } catch {
    // Corrupt JSON, a quota error, Safari in private mode. None of these are
    // worth a broken screen — the roster simply has to be fetched.
    return null;
  }
}

function writeStored(people: PcoRosterPerson[]): void {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ people, storedAt: Date.now() } satisfies StoredRoster),
    );
  } catch {
    /* Out of quota is not a reason to fail a check-in. */
  }
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
 * Reads the roster from Planning Center.
 *
 * Throws on failure rather than silently returning the stored copy: the caller
 * decides whether falling back is appropriate, because "showing you Friday's
 * roster because we cannot reach Planning Center" is something a counselor
 * should be told rather than something that should look like success.
 */
export async function fetchRoster(now = new Date()): Promise<RosterSnapshot> {
  const response = await getRoster();
  const people = response.data.people ?? [];

  writeStored(people);

  return {
    students: people.map((person) => fromRosterPerson(person, now)),
    fetchedAt: new Date(response.data.fetchedAt),
    offline: false,
  };
}
