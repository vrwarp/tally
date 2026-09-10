import { describe, expect, it } from 'vitest';
import { deviceIdOfUid, isDeviceId, kioskUid } from '@/lib/kioskDevice';

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
