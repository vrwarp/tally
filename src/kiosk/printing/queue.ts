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
  template: LabelTemplate;
  values: LabelTokenValues;
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
  /** The last job actually sent, for the staff reprint button. */
  lastPrinted(): RasterResult | null;
  reprintLast(): void;
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
  let last: { job: LabelJob; result: RasterResult } | null = null;

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
        options.onDropped?.('stale', next.job);
        continue;
      }

      try {
        const result = await next.result;
        await send(result);
        last = { job: next.job, result };
      } catch (error) {
        // One label failing must not stall the ones behind it. A jam usually
        // means the next will fail too, and the state the controller keeps is
        // what stops that being silent — but the loop keeps going either way,
        // because the alternative is a queue that never recovers on its own.
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
        if (dropped) options.onDropped?.('overflow', dropped.job);
      }
      pending.push({ job, result, queuedAtMs: now() });
      pump();
    },

    forget(studentId) {
      warm.delete(studentId);
    },

    lastPrinted() {
      return last?.result ?? null;
    },

    /**
     * Send the last label's bytes again.
     *
     * Queued fresh, so it is stamped now and cannot be dropped as stale — this
     * is somebody standing at the printer having watched one jam, which is
     * exactly the case the staleness rule must not apply to. The bytes are
     * reused rather than rebuilt: the child may have left the roster since, and
     * the point is another copy of *that* sticker.
     */
    reprintLast() {
      if (!last) return;
      pending.push({
        job: last.job,
        result: Promise.resolve(last.result),
        queuedAtMs: now(),
      });
      pump();
    },

    depth() {
      return pending.length;
    },

    async idle() {
      while (pumping) await pumping;
    },
  };
}
