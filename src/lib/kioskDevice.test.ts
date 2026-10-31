import { describe, expect, it } from 'vitest';
import {
  boundToFor,
  deviceIdOfUid,
  isDeviceId,
  KIOSK_BOUND_TO_MAX,
  KIOSK_PRINTER_NAME_MAX,
  kioskUid,
  printerReportFields,
} from '@/lib/kioskDevice';

describe('isDeviceId', () => {
  it('accepts the shape the kiosk mints', () => {
    expect(isDeviceId('kiosk-3f9a1c2e7b4d5e6f7a8b9c0d')).toBe(true);
  });

  it('refuses anything that could be a path segment, a paste, or nothing', () => {
    expect(isDeviceId('a/b')).toBe(false);
    expect(isDeviceId('short')).toBe(false);
    expect(isDeviceId('x'.repeat(65))).toBe(false);
    expect(isDeviceId('')).toBe(false);
    expect(isDeviceId(42)).toBe(false);
    expect(isDeviceId(null)).toBe(false);
  });
});

describe('kioskUid', () => {
  it('round-trips through deviceIdOfUid', () => {
    expect(deviceIdOfUid(kioskUid('kiosk-3f9a1c2e7b4d5e6f7a8b9c0d'))).toBe(
      'kiosk-3f9a1c2e7b4d5e6f7a8b9c0d',
    );
  });

  it('never mistakes a person for a device', () => {
    expect(deviceIdOfUid('uid-sam')).toBeNull();
    expect(deviceIdOfUid('planning-center')).toBeNull();
    // A uid that merely wears the prefix over a malformed id is nobody's.
    expect(deviceIdOfUid('kiosk_a/b')).toBeNull();
    expect(deviceIdOfUid('kiosk_')).toBeNull();
  });
});

describe('the shape a device id has to hold', () => {
  it('anchors both ends, so neither a prefix nor a suffix can smuggle anything in', () => {
    /*
     * The id becomes a Firestore path segment and the tail of a uid. Without
     * the leading anchor a pasted line ending in a valid id would pass; without
     * the trailing one an id followed by `/x` would.
     */
    expect(isDeviceId('!!!!abcdefghijkl')).toBe(false);
    expect(isDeviceId('abcdefghijkl/x')).toBe(false);
    expect(isDeviceId('abcdefghijkl ')).toBe(false);
    expect(isDeviceId('\nabcdefghijkl')).toBe(false);
  });

  it('is a bound, not a suggestion', () => {
    expect(isDeviceId('a'.repeat(7))).toBe(false);
    expect(isDeviceId('a'.repeat(8))).toBe(true);
    expect(isDeviceId('a'.repeat(64))).toBe(true);
    expect(isDeviceId('a'.repeat(65))).toBe(false);
  });

  it('wants a string, not something that merely spells one', () => {
    // Device ids come back out of storage and off the wire, where a value can
    // be anything; `String(x)` happening inside a regex test is not a check.
    expect(isDeviceId({ toString: () => 'abcdefghijkl' })).toBe(false);
    expect(isDeviceId(['abcdefghijkl'])).toBe(false);
  });
});

describe('the prefix that separates a device from a person', () => {
  it('is actually worn by the uid', () => {
    expect(kioskUid('abcdefghijkl')).toBe('kiosk_abcdefghijkl');
  });

  it('is what a person’s uid is tested against, not merely the id’s shape', () => {
    // Without the prefix every well-formed uid would read as a device — and
    // `checkedInBy` on a register would name a tablet that never existed.
    expect(deviceIdOfUid('abcdefghijklmnop')).toBeNull();
    expect(deviceIdOfUid('kiosk-abcdefghijkl')).toBeNull();
  });
});

describe('boundToFor', () => {
  it('carries an ordinary title whole, and nothing for no gathering', () => {
    expect(boundToFor('Sunday School')).toBe('Sunday School');
    expect(boundToFor(null)).toBeNull();
    expect(boundToFor('')).toBeNull();
  });

  it('cuts a title to what the rules accept rather than letting the report be refused', () => {
    // A refused report reads as retirement and un-pairs the kiosk — on every
    // report, after every re-pair — so a long title must never reach the rule.
    const long = 'Wednesday night '.repeat(20);
    expect(long.length).toBeGreaterThan(KIOSK_BOUND_TO_MAX);
    expect(boundToFor(long)).toBe(long.slice(0, KIOSK_BOUND_TO_MAX));
    expect(boundToFor(long)!.length).toBe(KIOSK_BOUND_TO_MAX);
  });

  it('leaves a title exactly at the bound alone, since the rule accepts it', () => {
    const exact = 'x'.repeat(KIOSK_BOUND_TO_MAX);
    expect(boundToFor(exact)).toBe(exact);
  });
});

describe('printerReportFields', () => {
  it('writes the three fields flat, as the row stores them', () => {
    expect(printerReportFields({ kind: 'server', state: 'ready', name: 'Shipping desk' })).toEqual({
      printerKind: 'server',
      printerState: 'ready',
      printerName: 'Shipping desk',
    });
    expect(printerReportFields({ kind: 'usb', state: 'trouble', name: null })).toEqual({
      printerKind: 'usb',
      printerState: 'trouble',
      printerName: null,
    });
  });

  it('clears all three for a kiosk with no printer, so a stale word is not left on the row', () => {
    expect(printerReportFields(null)).toEqual({ printerKind: null, printerState: null, printerName: null });
  });

  it('tidies the name and holds it to what the rules accept', () => {
    expect(printerReportFields({ kind: 'server', state: 'ready', name: '  Shipping desk ' }).printerName).toBe(
      'Shipping desk',
    );
    expect(printerReportFields({ kind: 'server', state: 'ready', name: '   ' }).printerName).toBeNull();
    expect(printerReportFields({ kind: 'server', state: 'ready', name: '' }).printerName).toBeNull();
    const long = 'Shipping desk by the back door of the fellowship hall, second shelf from the top';
    expect(long.length).toBeGreaterThan(KIOSK_PRINTER_NAME_MAX);
    expect(printerReportFields({ kind: 'server', state: 'ready', name: long }).printerName).toBe(
      long.slice(0, KIOSK_PRINTER_NAME_MAX),
    );
  });
});
