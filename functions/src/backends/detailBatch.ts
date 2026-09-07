/**
 * Turning "twenty rows want contact details" into one read.
 *
 * The dashboard's three call lists put a follow-up block on every row, and each
 * block used to be its own callable invocation: a Sunday evening of leaders
 * opening the dashboard was several hundred calls in bursts, every one of them
 * re-reading the caller's `users` document, building its own backend registry,
 * and asking Planning Center for a household the row above it had just fetched.
 *
 * This is the part of the fix worth testing on its own — what gets asked, in
 * what order, and what happens to the ones that fail. It deliberately knows
 * nothing about Cloud Functions or about people: the caller supplies the read
 * and the way to describe a failure, so the rules here can be exercised without
 * a backend, a database or a deploy surface underneath them.
 */

/** One student's slot in a request. */
export interface DetailBatchEntry {
  studentId?: string;
  force?: boolean;
}

/** Why one student could not be read, in the shape that goes on the wire. */
export interface DetailFailure {
  code: string;
  message: string;
}

export interface DetailBatchPlan {
  /** Student id -> whether their read must skip the server's held answer. */
  wanted: Map<string, boolean>;
  /** Students refused before any read — today only for overrunning the cap. */
  errors: Record<string, DetailFailure>;
}

/**
 * Which students this request actually reads, and which it turns away.
 *
 * Deduped by student id, and a forced read wins the tie: two rows for one
 * student in the same batch are one read, and if either of them has just
 * written, the answer both of them get is the one from after the write.
 *
 * Everything past `cap` is reported as an error against its own student id
 * rather than silently dropped. A row that says "try again" is honest about
 * having no answer; a row that spins for ever is not, and a truncated batch
 * that answers nothing about the rest is indistinguishable from one.
 */
export function planDetailBatch(
  asked: readonly DetailBatchEntry[],
  cap: number,
): DetailBatchPlan {
  const wanted = new Map<string, boolean>();
  const errors: Record<string, DetailFailure> = {};

  for (const entry of asked) {
    const studentId = typeof entry?.studentId === 'string' ? entry.studentId.trim() : '';
    if (!studentId) continue;

    if (!wanted.has(studentId) && wanted.size >= cap) {
      errors[studentId] = {
        code: 'resource-exhausted',
        message: `A single request may ask about ${cap} students.`,
      };
      continue;
    }

    wanted.set(studentId, (wanted.get(studentId) ?? false) || entry?.force === true);
  }

  return { wanted, errors };
}

export interface DetailBatchOutcome<T> {
  /** Student id -> what the read returned, including a deliberate null. */
  details: Record<string, T>;
  errors: Record<string, DetailFailure>;
  /** The raw failures in the order they happened, for the all-failed report. */
  failures: unknown[];
}

/**
 * Runs the plan, a few students at a time.
 *
 * Bounded rather than `Promise.all`, because each read is a person plus a
 * request per household and a screenful of them fired at once is the burst this
 * exists to stop — it would simply move the burst from Cloud Functions to
 * Planning Center's rate limit. A failure is recorded against its student and
 * the batch carries on: one unlinked visitor among twenty rows must not blank
 * the other nineteen.
 */
export async function runDetailBatch<T>(
  wanted: ReadonlyMap<string, boolean>,
  read: (studentId: string, force: boolean) => Promise<T>,
  options: {
    concurrency: number;
    /** Turns whatever the read threw into something a row can render. */
    describe: (error: unknown) => DetailFailure;
    /** Seeded with whatever the plan already refused. */
    errors?: Record<string, DetailFailure>;
  },
): Promise<DetailBatchOutcome<T>> {
  const details: Record<string, T> = {};
  const errors: Record<string, DetailFailure> = { ...options.errors };
  const failures: unknown[] = [];

  const queue = [...wanted.entries()];
  const worker = async (): Promise<void> => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [studentId, force] = next;
      try {
        details[studentId] = await read(studentId, force);
      } catch (error) {
        failures.push(error);
        errors[studentId] = options.describe(error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(options.concurrency, queue.length)) }, worker),
  );

  return { details, errors, failures };
}
