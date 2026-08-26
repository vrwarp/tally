/**
 * Ordering, staleness and failure — the three things there are to get wrong.
 *
 * Rasterising and sending are injected, so every case here is about the queue's
 * own reasoning rather than about a worker or a USB device. The claims that
 * matter most are the negative ones: printing never throws at its caller, one
 * failure does not stall the labels behind it, and nothing is printed late.
 */
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_LABEL_TEMPLATE } from '@/lib/labelTemplate';
import {
  MAX_LABEL_AGE_MS,
  MAX_PRINTED_HISTORY,
  MAX_QUEUED_LABELS,
  createLabelQueue,
  type LabelJob,
  type RasterResult,
} from './queue';

function job(studentId: string, firstName = studentId): LabelJob {
  return {
    studentId,
    name: firstName,
    template: DEFAULT_LABEL_TEMPLATE,
    values: { firstName, eventTitle: 'Sunday Nursery' },
  };
}

/** A raster that records what it was asked for and answers with the id in byte 0. */
function fakeRaster() {
  const seen: string[] = [];
  const fn = vi.fn(async (item: LabelJob): Promise<RasterResult> => {
    seen.push(item.studentId);
    return { job: Uint8Array.from([seen.length]), pageCount: item.template.copies };
  });
  return { fn, seen };
}

function fakeSend() {
  const sent: RasterResult[] = [];
  const fn = vi.fn(async (result: RasterResult) => {
    sent.push(result);
  });
  return { fn, sent };
}

/** A promise the test releases by hand. */
function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

/** A clock the test moves by hand. */
function fakeClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

describe('the label queue', () => {
  it('rasterises on warm, before anything is printed', async () => {
    const raster = fakeRaster();
    const send = fakeSend();
    const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

    queue.warm(job('ada'));
    await queue.idle();

    // The whole point: the bytes exist before the button is pressed.
    expect(raster.fn).toHaveBeenCalledTimes(1);
    expect(send.fn).not.toHaveBeenCalled();
  });

  it('reuses the warm raster instead of building it twice', async () => {
    const raster = fakeRaster();
    const send = fakeSend();
    const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

    queue.warm(job('ada'));
    queue.print(job('ada'));
    await queue.idle();

    expect(raster.fn).toHaveBeenCalledTimes(1);
    expect(send.sent).toHaveLength(1);
  });

  it('holds a lobby-full of warm labels and drops the oldest past it', async () => {
    /*
     * A lobby screen runs for weeks and warms a label for every row a thumb
     * rests on, so the cache has to have a ceiling — and it has to be a
     * ceiling rather than a bucket of one, because reusing the warm raster is
     * the whole reason it exists. Eight is a family and the two behind them.
     */
    const raster = fakeRaster();
    const send = fakeSend();
    const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

    for (let i = 0; i < 9; i += 1) queue.warm(job(`child-${i}`));
    await queue.idle();
    expect(raster.fn).toHaveBeenCalledTimes(9);

    // The eight most recent are still warm: printing them builds nothing new.
    for (let i = 1; i < 9; i += 1) queue.print(job(`child-${i}`));
    await queue.idle();
    expect(raster.fn).toHaveBeenCalledTimes(9);

    // The ninth-oldest was dropped to make room, so it is built again.
    queue.print(job('child-0'));
    await queue.idle();
    expect(raster.fn).toHaveBeenCalledTimes(10);
  });

  it('builds one on demand when nothing warmed it', async () => {
    const raster = fakeRaster();
    const send = fakeSend();
    const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

    queue.print(job('ada'));
    await queue.idle();

    expect(raster.fn).toHaveBeenCalledTimes(1);
    expect(send.sent).toHaveLength(1);
  });

  it('warms each child separately when a parent taps three rows', async () => {
    const raster = fakeRaster();
    const send = fakeSend();
    const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

    queue.warm(job('ada'));
    queue.warm(job('noah'));
    queue.warm(job('mia'));
    await queue.idle();

    expect(raster.seen).toEqual(['ada', 'noah', 'mia']);
  });

  it('forgets a warm label when the confirm screen is dismissed', async () => {
    const raster = fakeRaster();
    const send = fakeSend();
    const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

    queue.warm(job('ada'));
    queue.forget('ada');
    queue.print(job('ada'));
    await queue.idle();

    // Rebuilt, because the cached one was thrown away.
    expect(raster.fn).toHaveBeenCalledTimes(2);
  });

  it('does not reuse one label for a second tap on the same child', async () => {
    const raster = fakeRaster();
    const send = fakeSend();
    const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

    queue.print(job('ada'));
    await queue.idle();
    queue.print(job('ada'));
    await queue.idle();

    expect(raster.fn).toHaveBeenCalledTimes(2);
    expect(send.sent).toHaveLength(2);
  });

  describe('serialisation', () => {
    it('sends one at a time, in order', async () => {
      const raster = fakeRaster();
      const order: string[] = [];
      let inFlight = 0;

      const queue = createLabelQueue({
        raster: raster.fn,
        send: async (result) => {
          inFlight += 1;
          // The printer has one endpoint; overlapping would be a BusyError.
          expect(inFlight).toBe(1);
          await Promise.resolve();
          order.push(String(result.job[0]));
          inFlight -= 1;
        },
      });

      queue.print(job('ada'));
      queue.print(job('noah'));
      queue.print(job('mia'));
      await queue.idle();

      expect(order).toEqual(['1', '2', '3']);
    });

    it('picks up a label enqueued in the beat after the queue emptied', async () => {
      /*
       * The narrow one, and the reason `pump` re-checks in its `finally`. A tap
       * that lands after the drain loop has found the queue empty but before
       * the drain has finished unwinding sees `pumping` still set, so it starts
       * nothing — and that label then waits for somebody to tap again.
       *
       * Reproduced by hanging the first send on a promise the test holds, and
       * queueing the second tap *behind the drain's own continuation* on that
       * same promise. That is the one beat.
       */
      const sent: RasterResult[] = [];
      const gate = deferred();
      let firstSend: Promise<void> | null = null;
      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        send: (result) => {
          sent.push(result);
          if (sent.length > 1) return Promise.resolve();
          firstSend = gate.promise;
          return firstSend;
        },
      });

      queue.print(job('ada'));
      // Until the drain is parked on `firstSend`, so the tap below lands
      // behind its continuation rather than in front of it.
      for (let tick = 0; tick < 10 && firstSend === null; tick += 1) await Promise.resolve();
      expect(firstSend).not.toBeNull();

      void (firstSend as unknown as Promise<void>).then(() => queue.print(job('noah')));
      gate.release();

      await queue.idle();

      expect(sent).toHaveLength(2);
      expect(queue.depth()).toBe(0);
    });

    it('picks up a label enqueued while it was already draining', async () => {
      const raster = fakeRaster();
      const send = fakeSend();
      const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

      queue.print(job('ada'));
      // Same tick, mid-drain.
      queue.print(job('noah'));
      await queue.idle();

      expect(send.sent).toHaveLength(2);
    });
  });

  describe('failure', () => {
    it('never throws at the caller when rasterising fails', async () => {
      const send = fakeSend();
      const onFailure = vi.fn();
      const queue = createLabelQueue({
        raster: () => Promise.reject(new Error('bad template')),
        send: send.fn,
        onFailure,
      });

      // The tick on screen must not depend on this.
      expect(() => queue.print(job('ada'))).not.toThrow();
      await queue.idle();

      expect(send.fn).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledTimes(1);
    });

    it('never throws at the caller when the printer fails', async () => {
      const raster = fakeRaster();
      const onFailure = vi.fn();
      const queue = createLabelQueue({
        raster: raster.fn,
        send: () => Promise.reject(new Error('cover open')),
        onFailure,
      });

      expect(() => queue.print(job('ada'))).not.toThrow();
      await queue.idle();
      expect(onFailure).toHaveBeenCalledTimes(1);
    });

    it('does not stall the labels behind a failed one', async () => {
      const raster = fakeRaster();
      const sent: number[] = [];
      const onFailure = vi.fn();
      const queue = createLabelQueue({
        raster: raster.fn,
        send: async (result) => {
          const id = result.job[0]!;
          if (id === 2) throw new Error('jam');
          sent.push(id);
        },
        onFailure,
      });

      queue.print(job('ada'));
      queue.print(job('noah'));
      queue.print(job('mia'));
      await queue.idle();

      expect(sent).toEqual([1, 3]);
      expect(onFailure).toHaveBeenCalledTimes(1);
    });

    it('leaves a warm raster that nobody printed unobserved without complaint', async () => {
      // A rejected promise held in the warm cache and never read would be an
      // unhandled rejection on a page that runs for weeks.
      const queue = createLabelQueue({
        raster: () => Promise.reject(new Error('bad template')),
        send: async () => {},
      });

      queue.warm(job('ada'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Nothing to assert beyond not having crashed the run.
      expect(queue.depth()).toBe(0);
    });
  });

  describe('staleness', () => {
    it('drops a label the printer took too long to reach', async () => {
      const clock = fakeClock();
      const send = fakeSend();
      const onDropped = vi.fn();

      let release = () => {};
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });

      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        // The first send hangs, modelling a printer with its lid open.
        send: async (result) => {
          if (result.job[0] === 1) await blocked;
          await send.fn(result);
        },
        now: clock.now,
        onDropped,
      });

      queue.print(job('ada'));
      queue.print(job('noah'));

      // Two minutes pass with the printer stuck, then it recovers.
      clock.advance(MAX_LABEL_AGE_MS + 1);
      release();
      await queue.idle();

      // Ada's went out late but was already on the wire; Noah's was never
      // attempted, because a sticker for a child collected two minutes ago is
      // litter rather than a label.
      expect(onDropped).toHaveBeenCalledTimes(1);
      expect(onDropped.mock.calls[0]?.[0]).toBe('stale');
      expect(onDropped.mock.calls[0]?.[1].studentId).toBe('noah');
      expect(send.sent).toHaveLength(1);
    });

    it('prints one that is exactly as late as it is allowed to be', async () => {
      // Two minutes is the line and it is inclusive: a label landing exactly
      // on it is the last one printed, not the first one binned.
      const clock = fakeClock();
      const send = fakeSend();
      const onDropped = vi.fn();
      const gate = deferred();
      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        send: (result) => (result.job[0] === 1 ? gate.promise.then(() => send.fn(result)) : send.fn(result)),
        now: clock.now,
        onDropped,
      });

      queue.print(job('ada'));
      queue.print(job('noah'));
      clock.advance(MAX_LABEL_AGE_MS);
      gate.release();
      await queue.idle();

      expect(onDropped).not.toHaveBeenCalled();
      expect(send.sent).toHaveLength(2);
    });

    it('prints one that is merely a little late', async () => {
      const clock = fakeClock();
      const send = fakeSend();
      const onDropped = vi.fn();
      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        send: send.fn,
        now: clock.now,
        onDropped,
      });

      queue.print(job('ada'));
      clock.advance(MAX_LABEL_AGE_MS - 1);
      await queue.idle();

      expect(onDropped).not.toHaveBeenCalled();
      expect(send.sent).toHaveLength(1);
    });
  });

  describe('overflow', () => {
    it('drops the oldest rather than spooling without limit', async () => {
      const clock = fakeClock();
      const onDropped = vi.fn();

      let release = () => {};
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });

      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        send: () => blocked,
        now: clock.now,
        onDropped,
      });

      // One goes in flight immediately; the rest queue behind it.
      for (let i = 0; i < MAX_QUEUED_LABELS + 3; i++) queue.print(job(`child-${i}`));

      expect(queue.depth()).toBeLessThanOrEqual(MAX_QUEUED_LABELS);
      expect(onDropped.mock.calls.map((call) => call[0])).toContain('overflow');
      // The oldest waiting labels are the ones that went.
      expect(onDropped.mock.calls[0]?.[1].studentId).toBe('child-1');

      release();
      await queue.idle();
    });
  });

  describe('the warm cache', () => {
    it('holds a handful and drops the oldest past it', async () => {
      const raster = fakeRaster();
      const queue = createLabelQueue({ raster: raster.fn, send: fakeSend().fn });

      // A parent tapping down a long family list, then back to the top.
      for (let index = 0; index < 9; index += 1) queue.warm(job(`child-${index}`));
      expect(raster.seen).toHaveLength(9);

      queue.warm(job('child-8'));
      expect(raster.seen).toHaveLength(9);

      // The first is gone, so it costs a raster again — which is the trade: a
      // shelf tablet does not hold nine bitmaps for a queue of one.
      queue.warm(job('child-0'));
      expect(raster.seen).toHaveLength(10);
    });

    it('sends the raster it warmed, not a fresh one', async () => {
      const raster = fakeRaster();
      const send = fakeSend();
      const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

      queue.warm(job('ada'));
      queue.print(job('ada'));
      await queue.idle();

      expect(raster.fn).toHaveBeenCalledTimes(1);
      expect(send.sent).toHaveLength(1);
      expect(send.sent[0]?.job).toEqual(Uint8Array.from([1]));
    });
  });

  describe('the clock it keeps by default', () => {
    it('stamps the log from the wall clock when nobody injected one', async () => {
      const before = Date.now();
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: fakeSend().fn });

      queue.print(job('ada', 'Ada'));
      await queue.idle();

      const stamped = queue.printedTonight()[0]?.atMs ?? 0;
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('a queue nobody is listening to', () => {
    /*
     * The kiosk shell wires both callbacks up, and the printer setup screen
     * does not. Neither of these may become a `TypeError` inside the drain,
     * which would take the whole queue down with it.
     */
    it('drops a stale label without anybody to tell', async () => {
      const clock = fakeClock();
      const send = fakeSend();
      const gate = deferred();
      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        send: (result) => (send.sent.length === 0 ? gate.promise.then(() => send.fn(result)) : send.fn(result)),
        now: clock.now,
      });

      queue.print(job('ada'));
      queue.print(job('grace'));
      clock.advance(MAX_LABEL_AGE_MS + 1);
      gate.release();

      await expect(queue.idle()).resolves.toBeUndefined();
      expect(queue.printedTonight().map((entry) => entry.failed)).toContain(true);
    });

    it('fails a label without anybody to tell', async () => {
      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        send: async () => {
          throw new Error('printer offline');
        },
      });

      queue.print(job('ada', 'Ada'));

      await expect(queue.idle()).resolves.toBeUndefined();
      expect(queue.printedTonight()[0]?.failed).toBe(true);
    });

    it('overflows without anybody to tell', async () => {
      const gate = deferred();
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: () => gate.promise });

      for (let index = 0; index < MAX_QUEUED_LABELS + 3; index += 1) {
        queue.print(job(`child-${index}`, `Child ${index}`));
      }

      expect(queue.depth()).toBeLessThanOrEqual(MAX_QUEUED_LABELS);
      gate.release();
      await expect(queue.idle()).resolves.toBeUndefined();
    });
  });

  describe("the evening's log", () => {
    it('is empty before anything has printed', () => {
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: fakeSend().fn });

      expect(queue.printedTonight()).toEqual([]);
    });

    it('records what came out, newest first', async () => {
      const send = fakeSend();
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: send.fn });

      queue.print(job('ada', 'Ada'));
      await queue.idle();
      queue.print(job('marcus', 'Marcus'));
      await queue.idle();

      expect(queue.printedTonight().map((entry) => entry.name)).toEqual(['Marcus', 'Ada']);
      expect(queue.printedTonight().every((entry) => !entry.failed)).toBe(true);
    });

    /*
     * The row a volunteer is most often looking for.
     *
     * A label that jammed is the commonest reason anybody opens this screen, and
     * a log of successes could not answer it: the child with no sticker would be
     * the one name absent from the list of names.
     */
    it('records a label that did not come out, and says so', async () => {
      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        send: () => Promise.reject(new Error('cover open')),
        onFailure: () => {},
      });

      queue.print(job('ada', 'Ada'));
      await queue.idle();

      expect(queue.printedTonight()).toEqual([
        expect.objectContaining({ studentId: 'ada', name: 'Ada', failed: true }),
      ]);
    });

    it('records one dropped as stale as an attempt that failed', async () => {
      const clock = fakeClock();
      const send = fakeSend();

      let release = () => {};
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });

      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        // The first send hangs, modelling a printer with its lid open, so the
        // second is still waiting when the clock passes the staleness rule.
        send: async (result) => {
          if (result.job[0] === 1) await blocked;
          await send.fn(result);
        },
        now: clock.now,
        onDropped: () => {},
      });

      queue.print(job('ada', 'Ada'));
      queue.print(job('noah', 'Noah'));
      clock.advance(MAX_LABEL_AGE_MS + 1);
      release();
      await queue.idle();

      // Ada's went out late but was already on the wire. Noah's never was — and
      // Noah is the child standing at the desk with no sticker, so his is the
      // row somebody has to be able to find.
      expect(queue.printedTonight()).toEqual([
        expect.objectContaining({ name: 'Noah', failed: true }),
        expect.objectContaining({ name: 'Ada', failed: false }),
      ]);
    });

    /* A sticker about the printer is not a sticker about a child. */
    it('does not log a job with no name on it, which is what a test print is', async () => {
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: fakeSend().fn });

      const { name: _name, ...unnamed } = job('__test__1');
      queue.print(unnamed);
      await queue.idle();

      expect(queue.printedTonight()).toEqual([]);
    });

    it('holds the most recent MAX_PRINTED_HISTORY and no more', async () => {
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: fakeSend().fn });

      for (let index = 0; index < MAX_PRINTED_HISTORY + 4; index += 1) {
        queue.print(job(`child-${index}`, `Child ${index}`));
        await queue.idle();
      }

      const log = queue.printedTonight();
      expect(log).toHaveLength(MAX_PRINTED_HISTORY);
      expect(log[0]?.name).toBe(`Child ${MAX_PRINTED_HISTORY + 3}`);
    });

    it('gives every record an id of its own', async () => {
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: fakeSend().fn });

      for (const name of ['Ada', 'Grace', 'Katherine']) {
        queue.print(job(name.toLowerCase(), name));
        await queue.idle();
      }

      // The printer screen keys its rows on these, so two the same collapses
      // one child's sticker into another's.
      const ids = queue.printedTonight().map((entry) => entry.id);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(id).toMatch(/^p\d+$/);
    });

    it('logs a label dropped for overflow as an attempt that failed', async () => {
      const gate = deferred();
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: () => gate.promise });

      for (let index = 0; index < MAX_QUEUED_LABELS + 2; index += 1) {
        queue.print(job(`child-${index}`, `Child ${index}`));
      }

      // A child with no sticker, and somebody who can now see so and print it
      // again — which is exactly what a failed row on the printer screen is.
      const dropped = queue.printedTonight();
      expect(dropped.length).toBeGreaterThan(0);
      for (const entry of dropped) expect(entry.failed).toBe(true);

      gate.release();
      await queue.idle();
    });

    it('forgets the evening when the kiosk leaves the gathering', async () => {
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: fakeSend().fn });

      queue.print(job('ada', 'Ada'));
      await queue.idle();
      queue.forgetPrinted();

      expect(queue.printedTonight()).toEqual([]);
    });
  });
});
