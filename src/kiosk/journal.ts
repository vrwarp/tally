/**
 * Every tap at the kiosk, written down before its tick paints.
 *
 * The first of the promises in docs/kiosk-offline-recovery.md: a check-in or a
 * pickup is on this tablet's own storage before any request is made, so a
 * reload, a crash or a request that never answers cannot take it. It leaves
 * only when Tally says it has it — see `uploader.ts` — or a person decides.
 *
 * **One key per record** (`tally:kiosk:record:<id>`), never one array. The old
 * queue rewrote a whole array from the copy it read when a replay started, and
 * erased anything written while the replay ran; with a key each, a record
 * arrives by writing its own key and leaves by removing its own key, and
 * nothing can write back a stale copy of anything.
 *
 * **`localStorage`, synchronously.** The write has to finish before the tick,
 * and IndexedDB's cannot. `localStorage` survives a reload and a crashed tab —
 * the browser process holds it, not the page.
 *
 * **No count limit.** The old queue kept the newest fifty and deleted the rest.
 * Storage is the only limit here: a record is about five hundred characters,
 * and Chromium gives this origin five million. When it does fill, facts outrank
 * caches — see `write`.
 */
import type { KioskRecordKind, KioskRecordStudent, KioskRecordWire } from '@/lib/kioskLanding';
import { isRecordId } from '@/lib/kioskLanding';
import { KIOSK_KEYS, readJson, removeKey } from './storage';

/** A tap, as this tablet keeps it until Tally has it. */
export interface KioskRecord extends KioskRecordWire {
  v: 1;
  /** The gathering's title, for the staff list and a parked card. */
  gathering: string;
  /** How many times it has been sent without landing. */
  attempts: number;
  /**
   * What the last attempt ran into, for the staff row's words: no internet,
   * Tally answering but not taking it, or a pickup waiting for its arrival.
   */
  lastProblem?: 'network' | 'server' | 'arrival';
  /**
   * Carried over from the old queue, which kept the moment of the failure, not
   * of the tap. Minutes out at most; said so rather than hidden.
   */
  approximate?: true;
}

export const RECORD_PREFIX = 'tally:kiosk:record:';

type Listener = () => void;
const listeners = new Set<Listener>();

/** Records that could not be stored, held for as long as this page lives. */
const heldInMemory = new Map<string, KioskRecord>();

/** Whether a cache the door depends on was given up to make room. */
let doorCachesGivenUp = false;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeJournal(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** An id for a new record: opaque, bounded, one path segment. */
export function mintRecordId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `r-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The kiosk's own caches, least-missed first — what may be given up to make
 * room for a record.
 *
 * Every one of them is refetched when the kiosk is next online, and each
 * degrades safely until then: the pulse and the participation scope already
 * fail open, the printer log is a diagnostic, a second language falls back to
 * English. The phone index and the roster are last because the door cannot
 * find anybody without them after a reload — which is why giving either up
 * lights the mark (`doorCachesWereGivenUp`).
 */
const EVICTABLE: ReadonlyArray<{ key: string; door: boolean }> = [
  { key: KIOSK_KEYS.pulse, door: false },
  { key: KIOSK_KEYS.participation, door: false },
  { key: KIOSK_KEYS.printerLog, door: false },
  { key: KIOSK_KEYS.messages, door: false },
  { key: KIOSK_KEYS.phoneIndex, door: true },
  { key: KIOSK_KEYS.roster, door: true },
];

function tryStore(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a record down. `'stored'` means it is on the tablet's disk; `'held'`
 * means even an emptied cache could not make room, and it lives only in this
 * page until the uploader lands it — a state the kiosk makes visible, and the
 * one state in which a reload can still lose a record.
 */
export function write(record: KioskRecord): 'stored' | 'held' {
  const key = RECORD_PREFIX + record.id;
  const value = JSON.stringify(record);

  let stored = tryStore(key, value);
  for (const cache of EVICTABLE) {
    if (stored) break;
    try {
      if (localStorage.getItem(cache.key) === null) continue;
    } catch {
      // Storage is not answering at all; nothing to give up.
      break;
    }
    removeKey(cache.key);
    if (cache.door) doorCachesGivenUp = true;
    stored = tryStore(key, value);
  }

  if (stored) {
    heldInMemory.delete(record.id);
  } else {
    heldInMemory.set(record.id, record);
  }
  emit();
  return stored ? 'stored' : 'held';
}

/** Takes a record off the tablet — only ever because Tally now has it. */
export function remove(id: string): void {
  heldInMemory.delete(id);
  removeKey(RECORD_PREFIX + id);
  emit();
}

/** Notes what an attempt ran into, on the record itself. */
export function noteAttempt(id: string, problem: NonNullable<KioskRecord['lastProblem']>): void {
  const record = read(id);
  if (!record) return;
  const next: KioskRecord = { ...record, attempts: record.attempts + 1, lastProblem: problem };
  if (heldInMemory.has(id)) heldInMemory.set(id, next);
  else if (!tryStore(RECORD_PREFIX + id, JSON.stringify(next))) {
    // The count is a courtesy; the record is already on the disk as it was.
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

function isStudent(value: unknown): value is KioskRecordStudent {
  const v = value as KioskRecordStudent | null;
  return (
    !!v &&
    typeof v.firstName === 'string' &&
    typeof v.lastName === 'string' &&
    typeof v.searchName === 'string' &&
    (v.grade === null || typeof v.grade === 'number')
  );
}

function isRecord(value: unknown): value is KioskRecord {
  const v = value as KioskRecord | null;
  return (
    !!v &&
    v.v === 1 &&
    isRecordId(v.id) &&
    (v.kind === 'check-in' || v.kind === 'check-out') &&
    typeof v.eventId === 'string' &&
    v.eventId.length > 0 &&
    typeof v.studentId === 'string' &&
    v.studentId.length > 0 &&
    typeof v.tappedAtMs === 'number' &&
    Number.isFinite(v.tappedAtMs) &&
    typeof v.gathering === 'string' &&
    typeof v.attempts === 'number' &&
    (v.student === undefined || isStudent(v.student))
  );
}

function read(id: string): KioskRecord | null {
  const held = heldInMemory.get(id);
  if (held) return held;
  const stored = readJson<unknown>(RECORD_PREFIX + id);
  return isRecord(stored) ? stored : null;
}

/**
 * Every record on the tablet, oldest tap first — the order a pass sends them
 * in, so a pickup always travels behind its own arrival.
 *
 * A key that does not parse is skipped, never removed: it cannot be sent, and
 * it is not this module's to throw away.
 */
export function records(): KioskRecord[] {
  const found = new Map<string, KioskRecord>(heldInMemory);
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(RECORD_PREFIX)) continue;
      const stored = readJson<unknown>(key);
      if (isRecord(stored) && !found.has(stored.id)) found.set(stored.id, stored);
    }
  } catch {
    // Storage is not answering; what is held in memory is all there is.
  }
  return [...found.values()].sort(
    (a, b) => a.tappedAtMs - b.tappedAtMs || a.id.localeCompare(b.id),
  );
}

/** How many records exist only in this page. */
export function heldInMemoryCount(): number {
  return heldInMemory.size;
}

/** Whether the roster or phone index was given up to make room for a record. */
export function doorCachesWereGivenUp(): boolean {
  return doorCachesGivenUp;
}

/* -------------------------------------------------------------------------- */
/* The old queue                                                               */
/* -------------------------------------------------------------------------- */

interface LegacyEntry {
  kind?: KioskRecordKind;
  eventId?: unknown;
  studentId?: unknown;
  student?: unknown;
  arrivalId?: unknown;
  queuedAtMs?: unknown;
}

/**
 * Turns whatever the old retry queue left on this tablet into records, once.
 *
 * Its `queuedAtMs` is the moment the write failed, not the tap — within a
 * minute or two of it — so the record is marked approximate rather than
 * passed off as exact.
 *
 * The old key goes only once every entry is on the disk. If any had to be held
 * in memory, the old queue stays, and the next boot migrates it again: the
 * duplicates that makes are harmless — the server answers the second copy
 * `already-recorded` — and a loss would not be.
 */
export function migrateLegacyQueue(gathering = ''): number {
  const stored = readJson<unknown>(KIOSK_KEYS.pending);
  if (!Array.isArray(stored)) return 0;

  let moved = 0;
  let anyHeld = false;
  for (const raw of stored as LegacyEntry[]) {
    const kind: KioskRecordKind = raw?.kind === 'check-out' ? 'check-out' : 'check-in';
    if (typeof raw?.eventId !== 'string' || typeof raw?.studentId !== 'string') continue;
    if (typeof raw.queuedAtMs !== 'number' || !Number.isFinite(raw.queuedAtMs)) continue;
    if (kind === 'check-in' && !isStudent(raw.student)) continue;

    const record: KioskRecord = {
      v: 1,
      id: mintRecordId(),
      kind,
      eventId: raw.eventId,
      studentId: raw.studentId,
      tappedAtMs: raw.queuedAtMs,
      ...(kind === 'check-in' && typeof raw.arrivalId === 'string' && raw.arrivalId
        ? { arrivalId: raw.arrivalId }
        : {}),
      ...(kind === 'check-in' ? { student: raw.student as KioskRecordStudent } : {}),
      gathering,
      attempts: 0,
      approximate: true,
    };
    if (write(record) === 'held') anyHeld = true;
    moved += 1;
  }
  if (!anyHeld) removeKey(KIOSK_KEYS.pending);
  return moved;
}

/** For tests: forget what this module holds in memory. */
export function resetJournalForTests(): void {
  heldInMemory.clear();
  listeners.clear();
  doorCachesGivenUp = false;
}
