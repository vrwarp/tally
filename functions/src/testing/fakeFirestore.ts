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
  TransactionLike,
  WriteBatchLike,
} from '../firestore.js';

/**
 * A map, as against a `Timestamp`, a `Date`, an array or a scalar.
 *
 * The prototype check is what keeps a `Timestamp` — which is an object with
 * fields — from being merged field-by-field into the one it replaces.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

export class FakeFirestore implements FirestoreLike {
  readonly data = new Map<string, Record<string, unknown>>();
  readonly writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  private autoId = 0;
  /**
   * How many times each path has been written, deleted included. What a
   * transaction's reads are checked against when it commits — see
   * `runTransaction`.
   */
  private readonly versions = new Map<string, number>();

  private touched(path: string): void {
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
  }

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

  /**
   * The real SDK's merge, which recurses into maps and replaces everything else.
   *
   * This used to be one spread deep, and the divergence was not academic: the
   * kiosk phone index is a single document holding one big `last4` map, so
   * every patch of one bucket looked here like a write that erased every other
   * bucket. A test asserting that a corrected family stops answering to their
   * mistyped digits *without* taking the rest of the ministry with them could
   * not be written at all, because the double had already taken it.
   *
   * Arrays are values, not maps — the real SDK replaces them wholesale, and a
   * union would be `FieldValue.arrayUnion`, which nothing here uses.
   */
  private static merged(
    held: Record<string, unknown>,
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    const next = { ...held };
    for (const [key, incoming] of Object.entries(value)) {
      const existing = next[key];
      next[key] =
        isPlainObject(existing) && isPlainObject(incoming)
          ? FakeFirestore.merged(existing, incoming)
          : incoming;
    }
    return next;
  }

  private write(path: string, value: Record<string, unknown>, merge: boolean): void {
    this.data.set(
      path,
      merge ? FakeFirestore.merged(this.data.get(path) ?? {}, value) : { ...value },
    );
    this.writes.push({ path, data: value });
    this.touched(path);
  }

  private ref(path: string): DocumentRefLike {
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      path,
      get: async () => this.snapshot(path),
      create: async (value) => {
        // Mirrors the admin SDK, which rejects rather than overwriting. The
        // occurrence job depends on that being the failure mode.
        if (this.data.has(path)) {
          const error = new Error(`ALREADY_EXISTS: ${path}`) as Error & { code?: number };
          error.code = 6;
          throw error;
        }
        this.write(path, value, false);
      },
      set: async (value, options) => this.write(path, value, options?.merge === true),
      update: async (value) => this.write(path, value, true),
      delete: async () => {
        this.data.delete(path);
        this.writes.push({ path, data: { deleted: true } });
        this.touched(path);
      },
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

  /**
   * Reads see the committed state; writes are held and applied together when
   * the callback resolves, and dropped if it throws — the two properties a
   * caller relies on. There is no contention here to retry, so the callback
   * runs once.
   */
  /**
   * Optimistic, like the real one: a transaction whose reads were overtaken by
   * somebody else's write before it committed is run again from the top, so
   * two workers racing for one document see each other. A test can hold one
   * of them between its read and its write to stage exactly that.
   */
  async runTransaction<T>(update: (transaction: TransactionLike) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.attemptTransaction(update);
      if (outcome.committed) return outcome.result;
      if (attempt >= 4) throw new Error('ABORTED: too much contention on these documents.');
    }
  }

  private async attemptTransaction<T>(
    update: (transaction: TransactionLike) => Promise<T>,
  ): Promise<{ committed: true; result: T } | { committed: false }> {
    const queued: Array<() => void> = [];
    const read = new Map<string, number>();
    let wrote = false;
    const transaction: TransactionLike = {
      get: async (ref) => {
        if (wrote) throw new Error('Firestore transactions require all reads before all writes.');
        read.set(ref.path, this.versions.get(ref.path) ?? 0);
        return this.snapshot(ref.path);
      },
      set: (ref, value, options) => {
        wrote = true;
        queued.push(() => this.write(ref.path, value, options?.merge === true));
        return transaction;
      },
      update: (ref, value) => {
        wrote = true;
        if (!this.data.has(ref.path)) throw new Error(`NOT_FOUND: ${ref.path}`);
        queued.push(() => this.write(ref.path, value, true));
        return transaction;
      },
    };
    const result = await update(transaction);
    for (const [path, version] of read) {
      if ((this.versions.get(path) ?? 0) !== version) return { committed: false };
    }
    for (const apply of queued) apply();
    return { committed: true, result };
  }

  batch(): WriteBatchLike {
    const queued: Array<() => void> = [];
    return {
      set: (ref, value, options) => queued.push(() => this.write(ref.path, value, options?.merge === true)),
      update: (ref, value) => queued.push(() => this.write(ref.path, value, true)),
      delete: (ref) =>
        queued.push(() => {
          this.data.delete(ref.path);
          this.writes.push({ path: ref.path, data: { deleted: true } });
        }),
      commit: async () => {
        for (const apply of queued) apply();
        queued.length = 0;
      },
    };
  }
}
