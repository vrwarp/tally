import { describe, expect, it } from 'vitest';
import { KIOSK_NAME_MAX, deviceIdOfUid, isDeviceId, kioskName, kioskUid } from '@/lib/kioskDevice';

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

describe('kioskName', () => {
  it('keeps a name as people say it, tidied', () => {
    expect(kioskName('Lobby')).toBe('Lobby');
    expect(kioskName('  Nursery \t  door \n')).toBe('Nursery door');
  });

  it('reads nothing, or nothing but space, as no name at all', () => {
    for (const blank of ['', '   ', '\n\t', null, undefined, 7, { toString: () => 'Lobby' }]) {
      expect(kioskName(blank)).toBeNull();
    }
  });

  it('cuts a long name at the limit, at a whole character, with no space left hanging', () => {
    expect(kioskName('x'.repeat(KIOSK_NAME_MAX))).toBe('x'.repeat(KIOSK_NAME_MAX));
    expect(kioskName('x'.repeat(KIOSK_NAME_MAX + 1))).toBe('x'.repeat(KIOSK_NAME_MAX));
    // A cut after the space would end the name on it.
    expect(kioskName(`${'x'.repeat(KIOSK_NAME_MAX - 1)} door`)).toBe('x'.repeat(KIOSK_NAME_MAX - 1));
    // An emoji is two units: it goes whole or not at all.
    const name = kioskName(`${'x'.repeat(KIOSK_NAME_MAX - 1)}🚪`);
    expect(name).toBe('x'.repeat(KIOSK_NAME_MAX - 1));
    expect(kioskName(`${'x'.repeat(KIOSK_NAME_MAX - 2)}🚪`)).toBe(`${'x'.repeat(KIOSK_NAME_MAX - 2)}🚪`);
  });
});
