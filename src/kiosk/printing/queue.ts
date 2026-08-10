/**
 * One label at a time, and never at the cost of the screen.
 *
 * A printer has one endpoint and prints one thing at a time — `sendRaw` throws
 * `BusyError` if asked to overlap — so something has to serialise. That is most
 * of what this is. The rest is the two decisions that make it a *kiosk's* queue
 * rather than a general one.
 *
 * **It is speculative.** `warm` starts rasterising when the confirm screen
 * opens, not when the button is pressed, so by the time a thumb lands the bytes
 * already exist and the only work left is the USB write. This is the same trick
 * `services.warmStudentDates` plays with the Firestore read it needs, for the
 * same reason, and it is the whole of why a label comes out quickly.
 *
 * **It is not durable.** Deliberately, and unlike the check-in retry queue in
 * `services.ts`, which persists to localStorage and replays for as long as it
 * takes. A check-in is a fact about the evening and is worth landing late. A
 * label is worth nothing late: a sticker for a child who was collected twenty
 * minutes ago is litter on the floor, and one queued before a reboot is a
 * mystery in a stack of unclaimed badges. So the queue lives in memory, is
 * bounded, and drops anything that has gone stale on the way to the head.
 *
 * Rasterising and sending are injected. There is a Web Worker and a WebUSB
 * device behind them in real life, and neither belongs in the reasoning about
 * ordering, staleness and failure — which is what there is to get wrong here,
 * and what the tests are about.
 */
import type { LabelTemplate, LabelTokenValues } from '@/lib/labelTemplate';

/** One sticker, described. */
export interface LabelJob {
  /**
   * Who it is for — the warm cache's key.
   *
   * A parent checking in three children taps three rows, and each opens the
   * confirm screen and warms its own label. The student id is what keeps those
   * from being each other.
   */
  studentId: string;
  /**
   * Who it is for, in words, for the evening's log.
   *
   * The printer screen lists what has been printed so somebody can print one
   * again, and a list of student ids is a list nobody can read. Omitted, the job
   * is not logged at all — which is what a test label wants: it is a sticker
   * about the printer rather than about a child.
   */
  name?: string;
  template: LabelTemplate;
  values: LabelTokenValues;
}

/**
 * One attempt, as the printer screen lists it.
 *
 * Attempts rather than successes, because the row a volunteer is most often
 * looking for is the one that did not come out. `failed` covers every way a
 * label fails to reach the tape — the send threw, the queue dropped it as stale,
 * the queue dropped it to keep the spool short — because from the far side of
 * the glass those are one fact: there is a child with no sticker.
 */
export interface PrintedLabel {
  /** This attempt, so a row is addressable and React has a key. */
  id: string;
  studentId: string;
  name: string;
  atMs: number;
  failed: boolean;
}

/** A built job, ready for the wire. */
export interface RasterResult {
  job: Uint8Array;
  pageCount: number;
}

export type RasterFn = (job: LabelJob) => Promise<RasterResult>;
export type SendFn = (result: RasterResult) => Promise<void>;

/**
 * How late a label may be and still worth printing.
 *
 * Two minutes covers a printer waking up, a roll being changed, or a short
 * queue at the door. Past that the person it is for has walked away and a
 * sticker with their name on it is worse than none.
 */
export const MAX_LABEL_AGE_MS = 120_000;

/**
 * How many may be waiting.
 *
 * A door does not queue eight deep unless the printer has stopped, and when it
 * has, the right behaviour is to drop the oldest rather than to accumulate a
 * spool that will all come out at once when it recovers.
 */
export const MAX_QUEUED_LABELS = 8;

/**
 * How much of the evening the printer screen can show.
 *
 * Long enough to cover the family who arrived while the roll was out and the one
 * whose sticker fell off on the way to the room; short enough that it is a list
 * somebody reads rather than scrolls. It is also memory on a device that runs
 * for weeks — names, not rasters, but a lobby with three hundred children
 * through it is still a list nobody wants held.
 */
export const MAX_PRINTED_HISTORY = 8;

/** How many warm-but-unprinted rasters to hold before evicting the oldest. */
const MAX_WARM_LABELS = 8;

interface WarmEntry {
  result: Promise<RasterResult>;
  warmedAtMs: number;
}

interface QueuedLabel {
  job: LabelJob;
  result: Promise<RasterResult>;
  queuedAtMs: number;
}

export interface QueueOptions {
  raster: RasterFn;
  send: SendFn;
  /** Injectable so staleness can be tested without waiting two minutes. */
  now?: () => number;
  /**
   * Called when a label does not come out, with the reason.
   *
   * Never surfaced to a parent — see the note in `printLabel` — so this is for
   * the staff-facing state and nothing else.
   */
  onFailure?: (error: unknown, job: LabelJob) => void;
  /** Called when a label is dropped rather than attempted, and why. */
  onDropped?: (reason: 'stale' | 'overflow', job: LabelJob) => void;
}

export interface LabelQueue {
  warm(job: LabelJob): void;
  print(job: LabelJob): void;
  forget(studentId: string): void;
  /**
   * The evening's attempts, most recent first, for the printer screen.
   *
   * This replaces a `lastPrinted`/`reprintLast` pair, and the reason is the
   * whole of why the reprint work happened: *the last label* is a guess about
   * which label anybody wants, and by the time a volunteer has walked to the
   * kiosk it is whoever checked in behind them.
   */
  printedTonight(): readonly PrintedLabel[];
  /** A kiosk that has left a gathering keeps no list of who was at it. */
  forgetPrinted(): void;
  /** Waiting labels, for tests and for the printer screen. */
  depth(): number;
  /** Resolves when nothing is in flight. Tests only; nothing awaits printing. */
  idle(): Promise<void>;
}

export function createLabelQueue(options: QueueOptions): LabelQueue {
  const { raster, send } = options;
  const now = options.now ?? (() => Date.now());

  const warm = new Map<string, WarmEntry>();
  const pending: QueuedLabel[] = [];
  let pumping: Promise<void> | null = null;
  const printed: PrintedLabel[] = [];
  let nextRecordId = 0;

  /** Newest first, bounded, and only for jobs that are about a child. */
  function record(job: LabelJob, failed: boolean): void {
    if (!job.name) return;
    printed.unshift({
      id: `p${(nextRecordId += 1)}`,
      studentId: job.studentId,
      name: job.name,
      atMs: now(),
      failed,
    });
    if (printed.length > MAX_PRINTED_HISTORY) printed.length = MAX_PRINTED_HISTORY;
  }

  /**
   * Start rasterising, or hand back the raster already under way.
   *
   * The rejection is swallowed here and re-read at the point of use: a warm
   * that fails and is never printed must not become an unhandled rejection on a
   * screen that runs for weeks.
   */
  function rasterFor(job: LabelJob): Promise<RasterResult> {
    const existing = warm.get(job.studentId);
    if (existing) return existing.result;

    const result = raster(job);
    result.catch(() => {});

    if (warm.size >= MAX_WARM_LABELS) {
      // Oldest first. Map iteration is insertion-ordered, which is exactly the
      // order wanted and is why this is not a sort.
      const oldest = warm.keys().next();
      if (!oldest.done) warm.delete(oldest.value);
    }
    warm.set(job.studentId, { result, warmedAtMs: now() });
    return result;
  }

  async function drain(): Promise<void> {
    while (pending.length > 0) {
      const next = pending.shift();
      if (!next) break;

      if (now() - next.queuedAtMs > MAX_LABEL_AGE_MS) {
        // Logged as an attempt that failed, because that is what it is from the
        // far side of the glass: a child with no sticker, and somebody who can
        // now see so and print it again.
        record(next.job, true);
        options.onDropped?.('stale', next.job);
        continue;
      }

      try {
        const result = await next.result;
        await send(result);
        record(next.job, false);
      } catch (error) {
        // One label failing must not stall the ones behind it. A jam usually
        // means the next will fail too, and the state the controller keeps is
        // what stops that being silent — but the loop keeps going either way,
        // because the alternative is a queue that never recovers on its own.
        record(next.job, true);
        options.onFailure?.(error, next.job);
      }
    }
  }

  function pump(): void {
    if (pumping) return;
    pumping = drain().finally(() => {
      pumping = null;
      // A label enqueued during the last `await` of a drain would otherwise sit
      // here until the next tap.
      if (pending.length > 0) pump();
    });
  }

  return {
    warm(job) {
      rasterFor(job);
    },

    print(job) {
      const result = rasterFor(job);
      // Printed once: a second sticker for the same child is a staff reprint,
      // not a consequence of the row being tapped again.
      warm.delete(job.studentId);

      if (pending.length >= MAX_QUEUED_LABELS) {
        const dropped = pending.shift();
        if (dropped) {
          record(dropped.job, true);
          options.onDropped?.('overflow', dropped.job);
        }
      }
      pending.push({ job, result, queuedAtMs: now() });
      pump();
    },

    forget(studentId) {
      warm.delete(studentId);
    },

    printedTonight() {
      return printed;
    },

    forgetPrinted() {
      printed.length = 0;
    },

    depth() {
      return pending.length;
    },

    async idle() {
      while (pumping) await pumping;
    },
  };
}
