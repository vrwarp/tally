/**
 * The narrow Firestore surface the Cloud Functions actually use.
 *
 * Typing against structural interfaces rather than `Firestore` is what lets the
 * tests drive whole handlers with a small in-memory double instead of an
 * emulator. It is also a useful ceiling: everything the server is allowed to do
 * to the database is visible in forty lines.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

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
 * above. Keeping it here means the entry points read as ordinary code instead
 * of sprinkling casts through every handler.
 */
export function asFirestoreLike(db: Firestore): FirestoreLike {
  return db as unknown as FirestoreLike;
}

/* -------------------------------------------------------------------------- */
/* Paths — mirrored from src/lib/paths.ts                                      */
/* -------------------------------------------------------------------------- */

export const PATHS = {
  students: 'students',
  users: 'users',
  /** Connection health for the Settings screen. Written only by functions. */
  pcoStatus: 'config/pcoStatus',
} as const;

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

/* -------------------------------------------------------------------------- */
/* Logging                                                                     */
/* -------------------------------------------------------------------------- */

export interface FunctionLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export const SILENT_LOGGER: FunctionLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
