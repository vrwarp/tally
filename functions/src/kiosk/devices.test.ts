import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import {
  DEVICES_COLLECTION,
  deviceIdOfUid,
  isDeviceId,
  kioskUid,
  readLiveDevice,
  recordPairedDevice,
} from './devices.js';

const NOW = new Date('2026-09-06T14:00:00Z');
const SAM = { uid: 'uid-sam', name: 'Sam Whitfield' };

describe('isDeviceId', () => {
  it('accepts the shape the kiosk mints', () => {
    expect(isDeviceId('kiosk-3f9a1c2e7b')).toBe(true);
  });

  it('refuses anything that could be a path or a paste', () => {
    expect(isDeviceId('a/b')).toBe(false);
    expect(isDeviceId('short')).toBe(false);
    expect(isDeviceId('x'.repeat(65))).toBe(false);
    expect(isDeviceId(42)).toBe(false);
  });
});

describe('kioskUid', () => {
  it('round-trips through deviceIdOfUid, and a person never parses as a device', () => {
    expect(deviceIdOfUid(kioskUid('kiosk-3f9a1c2e7b'))).toBe('kiosk-3f9a1c2e7b');
    expect(deviceIdOfUid('uid-sam')).toBeNull();
    // A uid that merely wears the prefix over a malformed id is nobody's.
    expect(deviceIdOfUid('kiosk_a/b')).toBeNull();
  });
});

describe('recordPairedDevice', () => {
  it('writes who approved the device, their name, and when', async () => {
    const db = new FakeFirestore();
    await recordPairedDevice(db, 'kiosk-lobby-0001', SAM, NOW);

    expect(db.get(`${DEVICES_COLLECTION}/kiosk-lobby-0001`)).toMatchObject({
      approvedBy: 'uid-sam',
      approvedByName: 'Sam Whitfield',
      lastSeenAt: null,
      boundTo: null,
      boundChain: null,
      retiredAt: null,
    });
  });

  it('writes nothing for an id it would not trust as a path segment', async () => {
    const db = new FakeFirestore();
    await recordPairedDevice(db, '../users', SAM, NOW);
    expect(db.writtenPaths(DEVICES_COLLECTION)).toEqual([]);
  });

  it('replaces a retired row on a re-pair, which is how a retired tablet comes back', async () => {
    const db = new FakeFirestore();
    db.seed(`${DEVICES_COLLECTION}/kiosk-lobby-0001`, {
      approvedBy: 'uid-marcus',
      approvedByName: 'Marcus Webb',
      pairedAt: Timestamp.fromDate(new Date('2026-06-01T00:00:00Z')),
      retiredAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00Z')),
      retiredBy: 'uid-dana',
      boundTo: 'Nursery',
      boundChain: 'sunday-school',
    });

    await recordPairedDevice(db, 'kiosk-lobby-0001', SAM, NOW);

    const row = db.get(`${DEVICES_COLLECTION}/kiosk-lobby-0001`)!;
    expect(row.approvedBy).toBe('uid-sam');
    expect(row.retiredAt).toBeNull();
    expect(row.boundChain).toBeNull();
  });
});

describe('readLiveDevice', () => {
  it('answers the row for a live device', async () => {
    const db = new FakeFirestore();
    await recordPairedDevice(db, 'kiosk-lobby-0001', SAM, NOW);
    const live = await readLiveDevice(db, 'kiosk-lobby-0001');
    expect(live?.approvedBy).toBe('uid-sam');
  });

  it('answers nothing for a retired, missing or malformed device', async () => {
    const db = new FakeFirestore();
    db.seed(`${DEVICES_COLLECTION}/kiosk-retired`, {
      approvedBy: 'uid-sam',
      pairedAt: Timestamp.fromDate(NOW),
      retiredAt: Timestamp.fromDate(NOW),
      retiredBy: 'uid-dana',
    });
    expect(await readLiveDevice(db, 'kiosk-retired')).toBeNull();
    expect(await readLiveDevice(db, 'kiosk-never-paired')).toBeNull();
    expect(await readLiveDevice(db, 'a/b')).toBeNull();
  });
});
