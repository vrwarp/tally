/**
 * An in-memory Firestore for tests.
 *
 * The smallest thing that behaves like the surface the sync uses: document
 * get/set/update, one collection read, and batched writes. It records every
 * committed write, which is what lets a test assert that an unchanged student
 * produced *no* write at all — the property that keeps a sync from waking every
 * counselor's phone for nothing.
 *
 * Documents are stored by full path and handed back as shallow copies, so a
 * `Timestamp` survives the round trip the way it does in the real SDK.
 *
 * Excluded from the build in tsconfig.json; it never ships.
 */
import type {
  CollectionRefLike,
  DocumentRefLike,
  DocumentSnapshotLike,
  FirestoreLike,
  QuerySnapshotLike,
  WriteBatchLike,
} from '../firestore.js';

export class FakeFirestore implements FirestoreLike {
  readonly data = new Map<string, Record<string, unknown>>();
  readonly writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  private autoId = 0;

  seed(path: string, value: Record<string, unknown>): void {
    this.data.set(path, value);
  }

  get(path: string): Record<string, unknown> | undefined {
    return this.data.get(path);
  }

  /** Paths written during the run, in order. */
  writtenPaths(prefix: string): string[] {
    return this.writes.filter((write) => write.path.startsWith(prefix)).map((write) => write.path);
  }

  private snapshot(path: string): DocumentSnapshotLike {
    const stored = this.data.get(path);
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      exists: stored !== undefined,
      data: () => (stored === undefined ? undefined : { ...stored }),
    };
  }

  private write(path: string, value: Record<string, unknown>, merge: boolean): void {
    this.data.set(path, merge ? { ...(this.data.get(path) ?? {}), ...value } : { ...value });
    this.writes.push({ path, data: value });
  }

  private ref(path: string): DocumentRefLike {
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      path,
      get: async () => this.snapshot(path),
      set: async (value, options) => this.write(path, value, options?.merge === true),
      update: async (value) => this.write(path, value, true),
    };
  }

  doc(path: string): DocumentRefLike {
    return this.ref(path);
  }

  collection(path: string): CollectionRefLike {
    return {
      doc: (id?: string) => this.ref(`${path}/${id ?? `auto-${(this.autoId += 1)}`}`),
      get: async (): Promise<QuerySnapshotLike> => ({
        docs: [...this.data.keys()]
          .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .sort()
          .map((key) => this.snapshot(key)),
      }),
    };
  }

  batch(): WriteBatchLike {
    const queued: Array<() => void> = [];
    return {
      set: (ref, value, options) => queued.push(() => this.write(ref.path, value, options?.merge === true)),
      update: (ref, value) => queued.push(() => this.write(ref.path, value, true)),
      commit: async () => {
        for (const apply of queued) apply();
        queued.length = 0;
      },
    };
  }
}
