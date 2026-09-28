import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LandKioskRecordsRequest, LandKioskRecordsResponse } from '@/lib/kioskLanding';
import type { KioskRecord } from './journal';
import {
  RETRY_EVERY_MS,
  UPLOAD_DEADLINE_MS,
  createUploader,
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

beforeEach(() => {
  vi.useFakeTimers();
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
    await createUploader(h.deps).kick();

    expect(h.journal).toHaveLength(2);
    expect(h.deps.onRefused).toHaveBeenCalledTimes(1);
    expect(h.deps.probe).not.toHaveBeenCalled();
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
    const stop = createUploader(h.deps).start();
    await vi.advanceTimersByTimeAsync(5 * RETRY_EVERY_MS);
    expect(h.calls).toHaveLength(0);
    stop();
  });
});
