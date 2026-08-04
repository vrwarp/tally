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
  MAX_QUEUED_LABELS,
  createLabelQueue,
  type LabelJob,
  type RasterResult,
} from './queue';

function job(studentId: string, firstName = studentId): LabelJob {
  return {
    studentId,
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

  describe('reprint', () => {
    it('has nothing to reprint before anything has printed', async () => {
      const send = fakeSend();
      const queue = createLabelQueue({ raster: fakeRaster().fn, send: send.fn });

      expect(queue.lastPrinted()).toBeNull();
      queue.reprintLast();
      await queue.idle();
      expect(send.sent).toHaveLength(0);
    });

    it('sends the same bytes again without rebuilding them', async () => {
      const raster = fakeRaster();
      const send = fakeSend();
      const queue = createLabelQueue({ raster: raster.fn, send: send.fn });

      queue.print(job('ada'));
      await queue.idle();
      queue.reprintLast();
      await queue.idle();

      expect(raster.fn).toHaveBeenCalledTimes(1);
      expect(send.sent).toHaveLength(2);
      expect(send.sent[0]).toBe(send.sent[1]);
    });

    it('is not subject to the staleness rule', async () => {
      // Somebody is standing at the printer having watched one jam. Whatever
      // the clock says, this is the label they want.
      const clock = fakeClock();
      const raster = fakeRaster();
      const send = fakeSend();
      const onDropped = vi.fn();
      const queue = createLabelQueue({
        raster: raster.fn,
        send: send.fn,
        now: clock.now,
        onDropped,
      });

      queue.print(job('ada'));
      await queue.idle();

      clock.advance(MAX_LABEL_AGE_MS * 10);
      queue.reprintLast();
      await queue.idle();

      expect(onDropped).not.toHaveBeenCalled();
      expect(send.sent).toHaveLength(2);
    });

    it('does not remember a label that failed to print', async () => {
      const queue = createLabelQueue({
        raster: fakeRaster().fn,
        send: () => Promise.reject(new Error('cover open')),
        onFailure: () => {},
      });

      queue.print(job('ada'));
      await queue.idle();
      expect(queue.lastPrinted()).toBeNull();
    });
  });
});
