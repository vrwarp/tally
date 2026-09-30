import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LandKioskRecordsRequest, LandKioskRecordsResponse } from '@/lib/kioskLanding';
import type { KioskRecord } from './journal';
import {
  DeadlineError,
  RETRY_EVERY_MS,
  UPLOAD_DEADLINE_MS,
  createUploader,
  toWire,
  withDeadline,
  type UploaderDeps,
} from './uploader';

const NINE = Date.UTC(2026, 8, 27, 16, 41);

function rec(n: number, overrides: Partial<KioskRecord> = {}): KioskRecord {
  return {
    v: 1,
    id: `record-${String(n).padStart(4, '0')}`,
    kind: 'check-in',
    eventId: 'sunday',
    studentId: `student-${n}`,
    tappedAtMs: NINE + n,
    student: { firstName: 'Kid', lastName: String(n), grade: 3, searchName: `kid ${n}` },
    gathering: 'Sunday Kids',
    attempts: 0,
    ...overrides,
  };
}

/** A journal in an array, and a land() that answers what `answer` says. */
function harness(initial: KioskRecord[] = []) {
  const journal = [...initial];
  const calls: LandKioskRecordsRequest[] = [];
  let answer: (request: LandKioskRecordsRequest) => Promise<LandKioskRecordsResponse> = async (
    request,
  ) => ({ outcomes: request.records.map((r) => ({ id: r.id, outcome: 'landed' as const })) });

  const deps: UploaderDeps = {
    records: () => [...journal].sort((a, b) => a.tappedAtMs - b.tappedAtMs),
    settled: vi.fn(),
    remove: vi.fn((id: string) => {
      const at = journal.findIndex((r) => r.id === id);
      if (at >= 0) journal.splice(at, 1);
    }),
    noteAttempt: vi.fn(),
    land: vi.fn(async (request: LandKioskRecordsRequest) => {
      calls.push(request);
      return answer(request);
    }),
    probe: vi.fn(async () => false),
    isRefusal: (error) => (error as { code?: string }).code === 'functions/permission-denied',
    onRefused: vi.fn(),
    reached: vi.fn(),
    unreached: vi.fn(),
  };
  return {
    journal,
    calls,
    deps,
    answerWith(next: typeof answer) {
      answer = next;
    },
  };
}

/** What a dropped connection looks like from the Functions SDK. */
async function dropped(): Promise<never> {
  throw Object.assign(new Error('internal'), { code: 'functions/internal' });
}

/** Tally taking everything it is sent. */
function landAll(request: LandKioskRecordsRequest): LandKioskRecordsResponse {
  return { outcomes: request.records.map((r) => ({ id: r.id, outcome: 'landed' as const })) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('withDeadline', () => {
  it('gives up with the code a timed-out call carries, and says after how long', async () => {
    const caught = withDeadline(new Promise(() => {}), 1_000).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await caught;
    expect(error).toBeInstanceOf(DeadlineError);
    expect(error).toMatchObject({ code: 'deadline-exceeded', message: 'No answer within 1000 ms' });
  });

  it('leaves no timer behind once the work answers', async () => {
    await expect(withDeadline(Promise.resolve('landed'), 1_000)).resolves.toBe('landed');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('toWire', () => {
  it('sends what Tally needs, and nothing the tablet keeps for itself', () => {
    expect(toWire(rec(1, { arrivalId: 'arrival-1', attempts: 3, lastProblem: 'network' }))).toEqual({
      id: 'record-0001',
      kind: 'check-in',
      eventId: 'sunday',
      studentId: 'student-1',
      tappedAtMs: NINE + 1,
      arrivalId: 'arrival-1',
      student: { firstName: 'Kid', lastName: '1', grade: 3, searchName: 'kid 1' },
      gathering: 'Sunday Kids',
    });
    // A pickup names nobody new, and the old queue never knew a gathering's title.
    expect(toWire(rec(2, { kind: 'check-out', student: undefined, gathering: '' }))).toEqual({
      id: 'record-0002',
      kind: 'check-out',
      eventId: 'sunday',
      studentId: 'student-2',
      tappedAtMs: NINE + 2,
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a pass', () => {
  it('lets go of a record only once Tally has it', async () => {
    const h = harness([rec(1), rec(2)]);
    const uploader = createUploader(h.deps);
    await uploader.kick();

    expect(h.journal).toEqual([]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.records.map((r) => r.id)).toEqual(['record-0001', 'record-0002']);
    expect(uploader.state()).toEqual({ sending: null, lastProblem: null });
    expect(h.deps.reached).toHaveBeenCalled();
  });

  it('keeps what comes back waiting, and says why', async () => {
    const h = harness([rec(1), rec(2, { kind: 'check-out', student: undefined })]);
    h.answerWith(async () => ({
      outcomes: [
        { id: 'record-0001', outcome: 'waiting', waitingFor: 'retry' },
        { id: 'record-0002', outcome: 'waiting', waitingFor: 'arrival' },
      ],
    }));
    await createUploader(h.deps).kick();

    expect(h.journal.map((r) => r.id)).toEqual(['record-0001', 'record-0002']);
    expect(h.deps.noteAttempt).toHaveBeenCalledWith('record-0001', 'server');
    expect(h.deps.noteAttempt).toHaveBeenCalledWith('record-0002', 'arrival');
  });

  it('removes a parked or already-recorded record: Tally has it either way', async () => {
    const h = harness([rec(1), rec(2)]);
    h.answerWith(async () => ({
      outcomes: [
        { id: 'record-0001', outcome: 'parked', reason: 'frozen' },
        { id: 'record-0002', outcome: 'already-recorded' },
      ],
    }));
    await createUploader(h.deps).kick();
    expect(h.journal).toEqual([]);
  });

  it('says what Tally took before the journal lets go of it, and nothing about what waits', async () => {
    const h = harness([rec(1), rec(2), rec(3)]);
    const order: string[] = [];
    vi.mocked(h.deps.settled!).mockImplementation((record, outcome) => {
      // Still on the tablet at this moment: the room takes over from the journal.
      expect(h.journal.some((r) => r.id === record.id)).toBe(true);
      order.push(`${record.id}:${outcome}`);
    });
    h.answerWith(async () => ({
      outcomes: [
        { id: 'record-0001', outcome: 'landed' },
        { id: 'record-0002', outcome: 'parked', reason: 'frozen' },
        { id: 'record-0003', outcome: 'waiting', waitingFor: 'arrival' },
      ],
    }));
    await createUploader(h.deps).kick();

    expect(order).toEqual(['record-0001:landed', 'record-0002:parked']);
    expect(h.journal.map((r) => r.id)).toEqual(['record-0003']);
  });

  it('sends a long outage in tap order, twenty-five a call, and tells each call what is left', async () => {
    const h = harness(Array.from({ length: 30 }, (_, i) => rec(30 - i)));
    h.answerWith(async (request) => ({
      outcomes: request.records.map((r) =>
        // The first call sends one back waiting, which the second must count.
        r.id === 'record-0001'
          ? { id: r.id, outcome: 'waiting' as const, waitingFor: 'retry' as const }
          : { id: r.id, outcome: 'landed' as const },
      ),
    }));
    await createUploader(h.deps).kick();

    expect(h.calls.map((c) => c.records.length)).toEqual([25, 5]);
    expect(h.calls[0]!.records[0]!.id).toBe('record-0001');
    expect(h.calls[0]!.stillOnTablet).toEqual({ count: 5, oldestTappedAtMs: NINE + 26 });
    expect(h.calls[1]!.stillOnTablet).toEqual({ count: 1, oldestTappedAtMs: NINE + 1 });
    expect(h.journal.map((r) => r.id)).toEqual(['record-0001']);
  });
});

describe('what it says while it works', () => {
  it('starts idle, and says how far a pass has got while it runs', async () => {
    const h = harness(Array.from({ length: 30 }, (_, i) => rec(i + 1)));
    const answers: Array<() => void> = [];
    h.answerWith((request) => new Promise((resolve) => answers.push(() => resolve(landAll(request)))));
    const uploader = createUploader(h.deps);
    expect(uploader.state()).toEqual({ sending: null, lastProblem: null });

    const pass = uploader.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(uploader.state().sending).toEqual({ total: 30, left: 30 });

    answers.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(uploader.state().sending).toEqual({ total: 30, left: 5 });

    answers.shift()!();
    await pass;
    expect(uploader.state()).toEqual({ sending: null, lastProblem: null });
  });

  it('says nothing is being sent when there is nothing to send', async () => {
    const uploader = createUploader(harness([]).deps);
    const heard = vi.fn();
    uploader.subscribe(heard);
    await uploader.kick();
    expect(heard.mock.calls).toEqual([[{ sending: null, lastProblem: null }]]);
  });

  it('clears the last problem once nothing is left to send — another tab landed them', async () => {
    const h = harness([rec(1)]);
    h.answerWith(dropped);
    const uploader = createUploader(h.deps);
    await uploader.kick();
    expect(uploader.state().lastProblem).toBe('network');

    h.journal.length = 0;
    await uploader.kick();
    expect(uploader.state().lastProblem).toBeNull();
  });

  it('stops telling a listener that has let go', async () => {
    const uploader = createUploader(harness([rec(1)]).deps);
    const heard = vi.fn();
    uploader.subscribe(heard)();
    await uploader.kick();
    expect(heard).not.toHaveBeenCalled();
  });

  it('lands records for a caller that does not ask what settled', async () => {
    const h = harness([rec(1)]);
    delete h.deps.settled;
    await createUploader(h.deps).kick();
    expect(h.journal).toEqual([]);
  });
});

describe('what it lets go of', () => {
  it('keeps a record whose answer it does not know, or that was not answered for', async () => {
    const h = harness([rec(1), rec(2)]);
    h.answerWith(async () => ({
      // A later server's new answer, and a record the reply left out.
      outcomes: [{ id: 'record-0001', outcome: 'try-later' as never }],
    }));
    await createUploader(h.deps).kick();

    expect(h.journal.map((r) => r.id)).toEqual(['record-0001', 'record-0002']);
    expect(h.deps.remove).not.toHaveBeenCalled();
  });

  it('holds a pickup back while its own arrival is still waiting on the tablet', async () => {
    // Twenty-six arrivals, then a pickup for the first child: the arrival goes
    // in the first call and comes back waiting, the pickup would go in the
    // second — and without its arrival Tally would park it as never having come.
    const arrivals = Array.from({ length: 26 }, (_, i) => rec(i + 1));
    const pickup = rec(100, {
      id: 'record-pickup',
      kind: 'check-out',
      studentId: 'student-1',
      student: undefined,
    });
    const h = harness([...arrivals, pickup]);
    h.answerWith(async (request) => ({
      outcomes: request.records.map((r) =>
        r.id === 'record-0001'
          ? { id: r.id, outcome: 'waiting' as const, waitingFor: 'retry' as const }
          : { id: r.id, outcome: 'landed' as const },
      ),
    }));
    await createUploader(h.deps).kick();

    const sent = h.calls.flatMap((call) => call.records.map((r) => r.id));
    expect(sent).not.toContain('record-pickup');
    expect(h.journal.map((r) => r.id)).toEqual(['record-0001', 'record-pickup']);
    expect(h.deps.noteAttempt).toHaveBeenCalledWith('record-pickup', 'arrival');
  });

  it('holds back only the pickup whose own arrival waits', async () => {
    const h = harness([
      ...Array.from({ length: 25 }, (_, i) => rec(i + 1)),
      rec(100, { id: 'record-pickup-1', kind: 'check-out', studentId: 'student-1', student: undefined }),
      rec(101, { id: 'record-pickup-2', kind: 'check-out', studentId: 'student-2', student: undefined }),
    ]);
    h.answerWith(async (request) => ({
      outcomes: request.records.map((r) =>
        r.id === 'record-0001'
          ? { id: r.id, outcome: 'waiting' as const, waitingFor: 'retry' as const }
          : { id: r.id, outcome: 'landed' as const },
      ),
    }));
    await createUploader(h.deps).kick();

    expect(h.calls[1]!.records.map((r) => r.id)).toEqual(['record-pickup-2']);
    expect(h.journal.map((r) => r.id)).toEqual(['record-0001', 'record-pickup-1']);
  });

  it('sends no empty call when all that is left is held back', async () => {
    const h = harness([
      ...Array.from({ length: 25 }, (_, i) => rec(i + 1)),
      rec(100, { id: 'record-pickup', kind: 'check-out', studentId: 'student-1', student: undefined }),
    ]);
    h.answerWith(async (request) => ({
      outcomes: request.records.map((r) =>
        r.id === 'record-0001'
          ? { id: r.id, outcome: 'waiting' as const, waitingFor: 'retry' as const }
          : { id: r.id, outcome: 'landed' as const },
      ),
    }));
    await createUploader(h.deps).kick();
    expect(h.calls).toHaveLength(1);
  });

  it('counts a tap made while a call is out among what is still on the tablet', async () => {
    const h = harness(Array.from({ length: 26 }, (_, i) => rec(i + 1)));
    let first = true;
    h.answerWith(async (request) => {
      if (first) {
        first = false;
        // A family taps in while the first call is in the air.
        h.journal.push(rec(500));
      }
      return { outcomes: request.records.map((r) => ({ id: r.id, outcome: 'landed' as const })) };
    });
    await createUploader(h.deps).kick();

    // The second call carries the one left from the first pass's snapshot and
    // reports the new tap as still on the tablet.
    expect(h.calls[1]!.stillOnTablet).toEqual({ count: 1, oldestTappedAtMs: NINE + 500 });
  });
});

describe('one pass at a time — the old queue’s overlapping replays', () => {
  it('runs exactly one more pass for any number of kicks during a pass', async () => {
    const h = harness([rec(1)]);
    let release!: () => void;
    h.answerWith(
      (request) =>
        new Promise((resolve) => {
          release = () =>
            resolve({ outcomes: request.records.map((r) => ({ id: r.id, outcome: 'landed' })) });
        }),
    );
    const uploader = createUploader(h.deps);
    const first = uploader.kick();
    await vi.advanceTimersByTimeAsync(0);

    // A family taps in while the first call is still out.
    h.journal.push(rec(2));
    void uploader.kick();
    void uploader.kick();
    void uploader.kick();
    expect(h.calls).toHaveLength(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await first;

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.records.map((r) => r.id)).toEqual(['record-0002']);
    expect(h.journal).toEqual([]);
  });
});

describe('when a call fails', () => {
  it('gives up on a call that never answers, and keeps the records — the hanging connection', async () => {
    const h = harness([rec(1)]);
    h.answerWith(() => new Promise(() => {}));
    const uploader = createUploader(h.deps);
    const pass = uploader.kick();

    await vi.advanceTimersByTimeAsync(UPLOAD_DEADLINE_MS + 1);
    await pass;

    expect(h.journal).toHaveLength(1);
    expect(h.deps.probe).toHaveBeenCalled();
    expect(h.deps.unreached).toHaveBeenCalled();
    expect(h.deps.noteAttempt).toHaveBeenCalledWith('record-0001', 'network');
    expect(uploader.state().lastProblem).toBe('network');
  });

  it('calls it the server when Tally answers the probe — say, a bad deploy', async () => {
    const h = harness([rec(1)]);
    h.answerWith(async () => {
      throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    });
    vi.mocked(h.deps.probe).mockResolvedValue(true);
    const uploader = createUploader(h.deps);
    await uploader.kick();

    expect(h.journal).toHaveLength(1);
    expect(h.deps.reached).toHaveBeenCalled();
    expect(uploader.state().lastProblem).toBe('server');
  });

  it('keeps everything when Tally refuses this kiosk, and asks why', async () => {
    const h = harness([rec(1), rec(2)]);
    h.answerWith(async () => {
      throw Object.assign(new Error('retired'), { code: 'functions/permission-denied' });
    });
    const uploader = createUploader(h.deps);
    await uploader.kick();

    expect(h.journal).toHaveLength(2);
    expect(h.deps.onRefused).toHaveBeenCalledTimes(1);
    expect(h.deps.probe).not.toHaveBeenCalled();
    // A refusal is an answer: Tally was reached, and it is Tally saying no.
    expect(h.deps.reached).toHaveBeenCalled();
    expect(h.deps.unreached).not.toHaveBeenCalled();
    expect(h.deps.noteAttempt).toHaveBeenCalledWith('record-0001', 'server');
    expect(uploader.state()).toEqual({ sending: null, lastProblem: 'server' });
  });

  it('stops the pass at the first failed call rather than hammering the rest', async () => {
    const h = harness(Array.from({ length: 30 }, (_, i) => rec(i + 1)));
    h.answerWith(async () => {
      throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    });
    await createUploader(h.deps).kick();
    expect(h.calls).toHaveLength(1);
    expect(h.journal).toHaveLength(30);
  });
});

describe('start', () => {
  it('tries at once, again every thirty seconds while anything waits, and on the page coming back', async () => {
    const h = harness([rec(1)]);
    h.answerWith(async () => {
      throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    });
    const stop = createUploader(h.deps).start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS);
    expect(h.calls).toHaveLength(2);

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toHaveLength(3);
    stop();
  });

  it('sends nothing and asks nothing while the tablet holds nothing', async () => {
    const h = harness([]);
    const uploader = createUploader(h.deps);
    const heard = vi.fn();
    uploader.subscribe(heard);
    const stop = uploader.start();
    await vi.advanceTimersByTimeAsync(5 * RETRY_EVERY_MS);
    expect(h.calls).toHaveLength(0);
    // The first look finds nothing, and the timer does not look again.
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it('tries again when the page is shown or brought back into view, and not while it is hidden', async () => {
    const h = harness([rec(1)]);
    h.answerWith(dropped);
    const stop = createUploader(h.deps).start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toHaveLength(1);

    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toHaveLength(2);

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toHaveLength(3);

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toHaveLength(3);
    hidden.mockRestore();
    stop();
  });

  it('hears nothing once stopped', async () => {
    const h = harness([rec(1)]);
    h.answerWith(dropped);
    const stop = createUploader(h.deps).start();
    await vi.advanceTimersByTimeAsync(0);
    stop();

    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(RETRY_EVERY_MS);
    expect(h.calls).toHaveLength(1);
  });
});
