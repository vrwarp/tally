/**
 * The journal's one way out: sends what the tablet holds to Tally, and lets go
 * of a record only when Tally says it has it.
 *
 * Everything here exists because of a failure the old retry queue had — see the
 * table in docs/kiosk-offline-recovery.md:
 *
 * - **One pass at a time.** The old replay started again every thirty seconds
 *   whether or not the last one had finished, and on a connection that hangs a
 *   replay takes minutes, so they piled up and overwrote each other. Here a kick
 *   during a pass asks for exactly one more pass after it.
 * - **Every request has a deadline.** Nothing underneath has one: Firestore Lite
 *   calls `fetch` bare, and a request into a dead connection can wait for
 *   minutes. A request that timed out may still have landed; the next attempt
 *   is told `already-recorded`, which is a success.
 * - **On every screen, whatever the kiosk is set to.** The old replay ran only
 *   while the kiosk was bound, so an outage that outlasted the gathering sat on
 *   the tablet until somebody next set it to one — and then the rules refused
 *   it, because the record's gathering was not the kiosk's any more. The
 *   callable lands a record on its own gathering, so the uploader has no reason
 *   to care what the kiosk is doing.
 * - **Nothing is dropped on an answer nobody read.** Only an outcome from Tally
 *   removes a record; a failure of any kind leaves it where it is.
 *
 * Pure apart from the timers, with every dependency injected, so it is tested
 * without Firebase — as `printing/queue.ts` is without a printer.
 */
import {
  MAX_RECORDS_PER_CALL,
  type KioskRecordWire,
  type LandKioskRecordsRequest,
  type LandKioskRecordsResponse,
  type LandingOutcome,
} from '@/lib/kioskLanding';
import type { KioskRecord } from './journal';

/** How long any one request may take before it is treated as failed. */
export const UPLOAD_DEADLINE_MS = 20_000;

/** How often a tablet holding records tries again, whatever else wakes it. */
export const RETRY_EVERY_MS = 30_000;

export interface UploaderDeps {
  /** The journal, oldest tap first. */
  records(): KioskRecord[];
  remove(id: string): void;
  /**
   * Tally has answered for a record, just before the journal lets go of it —
   * so the room can go on counting the child as here until a register read
   * speaks for them (see `room.ts`).
   */
  settled?(record: KioskRecord, outcome: Exclude<LandingOutcome, 'waiting'>): void;
  noteAttempt(id: string, problem: 'network' | 'server' | 'arrival'): void;
  /** The one road: `landKioskRecords`. */
  land(request: LandKioskRecordsRequest): Promise<LandKioskRecordsResponse>;
  /**
   * One cheap read, asked only after a call failed: did Tally answer it? A
   * dropped connection and a server error arrive from the Functions SDK as the
   * same code, and the staff row says different things about them.
   */
  probe(): Promise<boolean>;
  /** Whether an error is Tally refusing this kiosk — retired, or signed out. */
  isRefusal(error: unknown): boolean;
  /** The whole call was refused: find out why, which is `checkStanding`'s job. */
  onRefused(): void;
  /** What each attempt says about the connection — see `touch.ts`. */
  reached(): void;
  unreached(): void;
}

export interface UploaderState {
  /** A pass under way: how many it set out to send, and how many are left. */
  sending: { total: number; left: number } | null;
  /** What stopped the last pass, or null when the last pass got through. */
  lastProblem: 'network' | 'server' | null;
}

export class DeadlineError extends Error {
  readonly code = 'deadline-exceeded';
}

/** A promise that gives up after `ms`, leaving the work itself to finish or not. */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(`No answer within ${ms} ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export function toWire(record: KioskRecord): KioskRecordWire {
  return {
    id: record.id,
    kind: record.kind,
    eventId: record.eventId,
    studentId: record.studentId,
    tappedAtMs: record.tappedAtMs,
    ...(record.arrivalId ? { arrivalId: record.arrivalId } : {}),
    ...(record.student ? { student: record.student } : {}),
    ...(record.gathering ? { gathering: record.gathering } : {}),
  };
}

/** The answers that mean Tally has a record — on the register, or parked for a person. */
const SETTLED: ReadonlySet<string> = new Set<LandingOutcome>(['landed', 'already-recorded', 'parked']);

/** One child at one gathering — what an arrival and its pickup share. */
function childAt(record: Pick<KioskRecord, 'eventId' | 'studentId'>): string {
  return `${record.eventId}/${record.studentId}`;
}

export interface Uploader {
  /** Starts a pass now, or asks for one more after the pass under way. */
  kick(): Promise<void>;
  /** Wakes on a timer and on the page's own signals; returns the way to stop. */
  start(): () => void;
  state(): UploaderState;
  subscribe(listener: (state: UploaderState) => void): () => void;
}

export function createUploader(deps: UploaderDeps): Uploader {
  let running: Promise<void> | null = null;
  let again = false;
  let current: UploaderState = { sending: null, lastProblem: null };
  const listeners = new Set<(state: UploaderState) => void>();

  function set(next: Partial<UploaderState>): void {
    current = { ...current, ...next };
    for (const listener of listeners) listener(current);
  }

  async function failed(error: unknown, batch: KioskRecord[]): Promise<void> {
    if (deps.isRefusal(error)) {
      deps.reached();
      for (const record of batch) deps.noteAttempt(record.id, 'server');
      set({ sending: null, lastProblem: 'server' });
      deps.onRefused();
      return;
    }
    const answered = await withDeadline(deps.probe(), UPLOAD_DEADLINE_MS).catch(() => false);
    if (answered) deps.reached();
    else deps.unreached();
    const problem = answered ? 'server' : 'network';
    for (const record of batch) deps.noteAttempt(record.id, problem);
    set({ sending: null, lastProblem: problem });
  }

  async function pass(): Promise<void> {
    const all = deps.records();
    if (all.length === 0) {
      set({ sending: null, lastProblem: null });
      return;
    }
    set({ sending: { total: all.length, left: all.length } });

    /*
     * A pickup travels behind this tablet's own arrival for the same child, or
     * not at all. Tap order puts the arrival first, and within one call the
     * server answers them in order; across calls this is the half the server
     * cannot see — an arrival that came back waiting in an earlier batch is
     * still on the tablet, and a pickup sent on without it would find no
     * arrival and, a day after the gathering, be parked as one that never
     * came. So it waits for its arrival here instead.
     */
    const heldArrivals = new Set<string>();
    const queue = [...all];

    while (queue.length > 0) {
      const batch: KioskRecord[] = [];
      while (batch.length < MAX_RECORDS_PER_CALL && queue.length > 0) {
        const next = queue.shift()!;
        if (next.kind === 'check-out' && heldArrivals.has(childAt(next))) {
          deps.noteAttempt(next.id, 'arrival');
          continue;
        }
        batch.push(next);
      }
      if (batch.length === 0) break;

      // Counted off the journal as it is now, not as it was when the pass
      // began: a family tapping in while this call is out is still on the
      // tablet, and Tally's count of what is waiting must include them.
      const sending = new Set(batch.map((record) => record.id));
      const rest = deps.records().filter((record) => !sending.has(record.id));
      const stillOnTablet = {
        count: rest.length,
        oldestTappedAtMs: rest[0]?.tappedAtMs ?? null,
      };

      let response: LandKioskRecordsResponse;
      try {
        response = await withDeadline(
          deps.land({ records: batch.map(toWire), stillOnTablet }),
          UPLOAD_DEADLINE_MS,
        );
      } catch (error) {
        await failed(error, batch);
        return;
      }
      deps.reached();

      const outcomes = new Map(response.outcomes.map((outcome) => [outcome.id, outcome]));
      for (const record of batch) {
        const outcome = outcomes.get(record.id);
        /*
         * Let go only on an answer that says Tally has it. Waiting, an answer
         * this build does not know, or no answer for this record at all — none
         * of them is that, and each is sent again.
         */
        if (outcome && SETTLED.has(outcome.outcome)) {
          deps.settled?.(record, outcome.outcome as Exclude<LandingOutcome, 'waiting'>);
          deps.remove(record.id);
          continue;
        }
        deps.noteAttempt(record.id, outcome?.waitingFor === 'arrival' ? 'arrival' : 'server');
        if (record.kind === 'check-in') heldArrivals.add(childAt(record));
      }
      set({ sending: { total: all.length, left: queue.length } });
    }
    set({ sending: null, lastProblem: null });
  }

  function kick(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function start(): () => void {
    const timer = setInterval(() => {
      if (deps.records().length > 0) void kick();
    }, RETRY_EVERY_MS);
    const wake = () => void kick();
    const visible = () => {
      if (document.visibilityState === 'visible') void kick();
    };
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
    document.addEventListener('visibilitychange', visible);
    void kick();
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', wake);
      document.removeEventListener('visibilitychange', visible);
    };
  }

  return {
    kick,
    start,
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
