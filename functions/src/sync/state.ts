/**
 * `config/pcoSync` — the one document the core team watches while a sync runs.
 *
 * The app subscribes to it with `onSnapshot`, so every write here lights up a
 * Settings screen somewhere. That shapes two decisions:
 *   - progress writes are throttled, because a 400-student sweep would
 *     otherwise emit a hundred snapshots nobody can read;
 *   - the run *always* lands on a terminal `ok` or `error`, even when the sync
 *     throws, because a status stuck on `running` forever is indistinguishable
 *     from a hung integration.
 *
 * This module also declares the narrow Firestore surface the rest of the sync
 * uses. Typing against structural interfaces rather than `Firestore` is what
 * lets syncPeople.test.ts drive the whole pipeline with a small in-memory
 * double instead of an emulator.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { PcoRosterSource, PcoWriteBackMode } from '../config.js';

/* -------------------------------------------------------------------------- */
/* The Firestore surface we actually use                                       */
/* -------------------------------------------------------------------------- */

export interface DocumentSnapshotLike {
  readonly id: string;
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DocumentRefLike {
  readonly id: string;
  /** Full collection-qualified path; a batched write carries nothing else. */
  readonly path: string;
  get(): Promise<DocumentSnapshotLike>;
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
}

export interface QuerySnapshotLike {
  readonly docs: DocumentSnapshotLike[];
}

export interface CollectionRefLike {
  doc(id?: string): DocumentRefLike;
  get(): Promise<QuerySnapshotLike>;
}

export interface WriteBatchLike {
  set(ref: DocumentRefLike, data: Record<string, unknown>, options?: { merge?: boolean }): unknown;
  update(ref: DocumentRefLike, data: Record<string, unknown>): unknown;
  commit(): Promise<unknown>;
}

export interface FirestoreLike {
  collection(path: string): CollectionRefLike;
  doc(path: string): DocumentRefLike;
  batch(): WriteBatchLike;
}

/**
 * The single place that asserts the admin SDK satisfies the narrow surface
 * above. Keeping it here means the entry points read as ordinary code instead of
 * sprinkling casts through every handler.
 */
export function asFirestoreLike(db: Firestore): FirestoreLike {
  return db as unknown as FirestoreLike;
}

/* -------------------------------------------------------------------------- */
/* Paths and counts — mirrored from src/lib/paths.ts and src/types             */
/* -------------------------------------------------------------------------- */

export const PATHS = {
  students: 'students',
  users: 'users',
  accessRoster: 'accessRoster',
  pcoSync: 'config/pcoSync',
} as const;

export type PcoSyncStatus = 'never' | 'running' | 'ok' | 'error';

export interface PcoSyncCounts {
  peopleScanned: number;
  studentsCreated: number;
  studentsUpdated: number;
  studentsDeactivated: number;
  teamMembersMapped: number;
  visitorsPushed: number;
  errors: number;
}

export function emptyCounts(): PcoSyncCounts {
  return {
    peopleScanned: 0,
    studentsCreated: 0,
    studentsUpdated: 0,
    studentsDeactivated: 0,
    teamMembersMapped: 0,
    visitorsPushed: 0,
    errors: 0,
  };
}

/** A full sweep is expensive; once a day is enough to catch removals. */
export const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a `running` state is believed before it is treated as a crashed
 * container. Cloud Functions cap out at 9 minutes, so anything older than 15
 * cannot still be alive.
 */
export const STALE_RUN_MS = 15 * 60 * 1000;

/** Minimum gap between progress writes, so listeners are not spammed. */
const PROGRESS_INTERVAL_MS = 5_000;

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export interface PcoSyncSnapshot {
  status: PcoSyncStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  cursor: Date | null;
  lastFullSyncAt: Date | null;
}

/** Accepts an admin `Timestamp`, a `Date` or epoch millis — whatever a test double stored. */
export function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function readStatus(value: unknown): PcoSyncStatus {
  return value === 'running' || value === 'ok' || value === 'error' ? value : 'never';
}

export async function readSyncState(db: FirestoreLike): Promise<PcoSyncSnapshot> {
  const snapshot = await db.doc(PATHS.pcoSync).get();
  const data = snapshot.exists ? (snapshot.data() ?? {}) : {};

  return {
    status: readStatus(data.status),
    startedAt: toDateOrNull(data.startedAt),
    finishedAt: toDateOrNull(data.finishedAt),
    cursor: toDateOrNull(data.cursor),
    lastFullSyncAt: toDateOrNull(data.lastFullSyncAt),
  };
}

/** True when a run is genuinely in flight (not a crashed one left behind). */
export function isRunActive(state: PcoSyncSnapshot, now: Date): boolean {
  if (state.status !== 'running') return false;
  if (!state.startedAt) return false;
  return now.getTime() - state.startedAt.getTime() < STALE_RUN_MS;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export interface SyncStateStore {
  begin(input: {
    rosterSource: PcoRosterSource;
    writeBack: PcoWriteBackMode;
    triggeredBy: string | null;
    now: Date;
  }): Promise<void>;
  /** Throttled; safe to call after every page. */
  progress(counts: PcoSyncCounts, now: Date): Promise<void>;
  finish(input: {
    status: 'ok' | 'error';
    counts: PcoSyncCounts;
    cursor: Date | null;
    lastFullSyncAt: Date | null;
    lastError: string | null;
    now: Date;
  }): Promise<void>;
}

export function createSyncStateStore(db: FirestoreLike): SyncStateStore {
  const ref = db.doc(PATHS.pcoSync);
  let lastProgressAt = 0;

  return {
    async begin({ rosterSource, writeBack, triggeredBy, now }) {
      lastProgressAt = now.getTime();
      await ref.set(
        {
          status: 'running',
          startedAt: Timestamp.fromDate(now),
          finishedAt: null,
          counts: emptyCounts(),
          lastError: null,
          rosterSource,
          writeBack,
          triggeredBy,
        },
        // `cursor` and `lastFullSyncAt` survive a failed run: losing the cursor
        // would silently turn every later incremental sync into a full sweep.
        { merge: true },
      );
    },

    async progress(counts, now) {
      if (now.getTime() - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now.getTime();
      await ref.set({ counts }, { merge: true });
    },

    async finish({ status, counts, cursor, lastFullSyncAt, lastError, now }) {
      await ref.set(
        {
          status,
          finishedAt: Timestamp.fromDate(now),
          counts,
          lastError,
          ...(cursor ? { cursor: Timestamp.fromDate(cursor) } : {}),
          ...(lastFullSyncAt ? { lastFullSyncAt: Timestamp.fromDate(lastFullSyncAt) } : {}),
        },
        { merge: true },
      );
    },
  };
}
