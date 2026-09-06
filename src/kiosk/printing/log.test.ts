/**
 * The printer's record, and the two rules it keeps.
 *
 * It holds no names and it is bounded — both because it lives in localStorage
 * on a tablet that sits in a lobby for weeks. Everything else here is the
 * ordinary business of a ring buffer that has to come back after a reload
 * without trusting what it finds there.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { KIOSK_KEYS } from '@/kiosk/storage';
import {
  MAX_VALUE_LENGTH,
  PRINTER_LOG_CAPACITY,
  PRINTER_LOG_VERSION,
  createPrinterLog,
  describeAge,
  describeEntry,
  formatEntry,
  isNoise,
  sanitizeData,
} from '@/kiosk/printing/log';

function stored(): unknown {
  return JSON.parse(window.localStorage.getItem(KIOSK_KEYS.printerLog) ?? 'null');
}

/** A clock that ticks one second per record, so entries are distinguishable. */
function ticking(start = 1_700_000_000_000) {
  let at = start;
  return () => {
    at += 1000;
    return at;
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('what is not worth writing down', () => {
  it('drops the chatter of a label going out and keeps everything else', () => {
    for (const name of ['write-chunk', 'status-packet', 'write-start', 'write-done', 'send-start']) {
      expect(isNoise(name)).toBe(true);
    }
    for (const name of ['disconnect', 'open', 'claim-failed', 'stall', 'status-timeout']) {
      expect(isNoise(name)).toBe(false);
    }
  });
});

describe('what a value may be', () => {
  it('keeps primitives and nothing else', () => {
    expect(
      sanitizeData({
        text: 'hello',
        count: 3,
        flag: false,
        nested: { name: 'Ada' },
        fn: () => 'Ada',
        missing: undefined,
        nothing: null,
        huge: Infinity,
        nan: NaN,
      }),
    ).toEqual({ text: 'hello', count: 3, flag: false });
  });

  it('answers nothing for nothing, so an entry carries no empty data', () => {
    expect(sanitizeData(undefined)).toBeUndefined();
    expect(sanitizeData({})).toBeUndefined();
    expect(sanitizeData({ nested: { name: 'Ada' } })).toBeUndefined();
  });

  it('cuts a long value short, so one error message cannot fill the ring', () => {
    const long = 'x'.repeat(MAX_VALUE_LENGTH + 40);
    const exact = 'y'.repeat(MAX_VALUE_LENGTH);

    expect(sanitizeData({ long })?.long).toBe(`${'x'.repeat(MAX_VALUE_LENGTH)}…`);
    expect(sanitizeData({ exact })?.exact).toBe(exact);
  });
});

describe('recording', () => {
  it('stamps each entry with the clock it was given', () => {
    const log = createPrinterLog({ now: ticking() });

    log.record('usb', 'connect', { vendorId: 1273 });
    log.record('state', 'ready');

    expect(log.entries()).toEqual([
      { t: 1_700_000_001_000, category: 'usb', name: 'connect', data: { vendorId: 1273 } },
      { t: 1_700_000_002_000, category: 'state', name: 'ready' },
    ]);
  });

  it('drops the oldest once it is full, and keeps the order of the rest', () => {
    const log = createPrinterLog({ capacity: 3, now: ticking() });

    for (const name of ['a', 'b', 'c', 'd']) log.record('kiosk', name);

    expect(log.entries().map((entry) => entry.name)).toEqual(['b', 'c', 'd']);
  });

  it('is written to the device on every record', () => {
    const log = createPrinterLog({ now: ticking() });

    log.record('page', 'pagehide');

    expect(stored()).toEqual({
      version: PRINTER_LOG_VERSION,
      entries: [{ t: 1_700_000_001_000, category: 'page', name: 'pagehide' }],
    });
  });

  it('keeps two hundred by default', () => {
    expect(PRINTER_LOG_CAPACITY).toBe(200);
  });
});

describe('coming back after a reload', () => {
  it('picks up where the previous page left off', () => {
    createPrinterLog({ now: ticking() }).record('kiosk', 'close', { cause: 'reload' });

    const next = createPrinterLog({ now: ticking(1_800_000_000_000) });
    next.record('kiosk', 'ready');

    expect(next.entries().map((entry) => `${entry.name} ${entry.t}`)).toEqual([
      'close 1700000001000',
      'ready 1800000001000',
    ]);
  });

  it('trims what it restores to its capacity', () => {
    const before = createPrinterLog({ capacity: 10, now: ticking() });
    for (const name of ['a', 'b', 'c', 'd', 'e']) before.record('kiosk', name);

    const after = createPrinterLog({ capacity: 3 });

    expect(after.entries().map((entry) => entry.name)).toEqual(['c', 'd', 'e']);
  });

  it('starts afresh from a log of another shape', () => {
    window.localStorage.setItem(
      KIOSK_KEYS.printerLog,
      JSON.stringify({ version: PRINTER_LOG_VERSION + 1, entries: [{ t: 1, category: 'a', name: 'b' }] }),
    );

    expect(createPrinterLog().entries()).toEqual([]);
  });

  it('starts afresh from anything that is not a log at all', () => {
    for (const raw of ['{not json', '[]', 'null', '{"version":1}', '{"version":1,"entries":{}}']) {
      window.localStorage.setItem(KIOSK_KEYS.printerLog, raw);
      expect(createPrinterLog().entries()).toEqual([]);
    }
  });

  it('keeps the rows it can read and drops the ones it cannot', () => {
    window.localStorage.setItem(
      KIOSK_KEYS.printerLog,
      JSON.stringify({
        version: PRINTER_LOG_VERSION,
        entries: [
          { t: 1, category: 'usb', name: 'connect', data: { ok: true, nested: { name: 'Ada' } } },
          { category: 'usb', name: 'no time' },
          { t: 'soon', category: 'usb', name: 'bad time' },
          { t: 2, name: 'no category' },
          { t: 3, category: 'usb' },
          { t: 4, category: 'usb', name: 'data of the wrong shape', data: 'text' },
          null,
          'text',
        ],
      }),
    );

    expect(createPrinterLog().entries()).toEqual([
      { t: 1, category: 'usb', name: 'connect', data: { ok: true } },
      { t: 4, category: 'usb', name: 'data of the wrong shape' },
    ]);
  });
});

describe('reading it back', () => {
  const entry = {
    t: Date.UTC(2026, 8, 6, 4, 0, 1),
    category: 'transport',
    name: 'disconnect',
    data: { during: 'read', error: 'NetworkError: A transfer error has occurred.', count: 2, ok: false },
  };

  it('names the category and the event, then each value', () => {
    expect(describeEntry(entry)).toBe(
      'transport disconnect during="read" error="NetworkError: A transfer error has occurred." count=2 ok=false',
    );
    expect(describeEntry({ t: 0, category: 'state', name: 'ready' })).toBe('state ready');
  });

  it('puts the time in front for a bug report', () => {
    expect(formatEntry(entry)).toBe(`2026-09-06T04:00:01.000Z ${describeEntry(entry)}`);
  });

  it('is one line per entry as text', () => {
    const log = createPrinterLog({ now: ticking() });
    log.record('kiosk', 'ready', { model: 'QL-810W' });
    log.record('state', 'unpaired', { cause: 'boot' });

    expect(log.text()).toBe(
      '2023-11-14T22:13:21.000Z kiosk ready model="QL-810W"\n2023-11-14T22:13:22.000Z state unpaired cause="boot"',
    );
  });
});

describe('how long ago', () => {
  const now = 1_700_000_000_000;
  const ago = (seconds: number) => describeAge(now - seconds * 1000, now);

  it('is coarse on purpose', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(9)).toBe('just now');
    expect(ago(10)).toBe('10 s ago');
    expect(ago(59)).toBe('59 s ago');
    expect(ago(60)).toBe('1 min ago');
    expect(ago(3599)).toBe('59 min ago');
    expect(ago(3600)).toBe('1 h ago');
    expect(ago(86_399)).toBe('23 h ago');
    expect(ago(86_400)).toBe('1 d ago');
    expect(ago(3 * 86_400 + 5)).toBe('3 d ago');
  });

  it('never says a thing happened in the future', () => {
    // A clock put back by a time sync: the entry is older than "now" says.
    expect(ago(-30)).toBe('just now');
  });
});
