/**
 * The counselors' copy of when each kiosk set to their gathering was last
 * heard from — kept in step with the device rows, one way.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { presenceChain, syncKioskPresence } from './presence.js';

const LOBBY = 'kiosk-lobby-00000001';
const NURSERY = 'kiosk-nursery-000002';
const NINE_FORTY_ONE = Timestamp.fromDate(new Date('2026-09-27T16:41:00Z'));
const NINE_FORTY_SIX = Timestamp.fromDate(new Date('2026-09-27T16:46:00Z'));

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvedBy: 'uid-miriam',
    name: 'Lobby',
    lastSeenAt: NINE_FORTY_ONE,
    boundTo: 'Sunday Kids',
    boundChain: 'sunday-kids',
    retiredAt: null,
    batteryLevel: 0.8,
    ...overrides,
  };
}

const presence = (db: FakeFirestore, chain: string) => db.get(`kioskPresence/${chain}`);

describe('presenceChain', () => {
  it('is the chain a live row is set to, and nothing for one set to nothing, retired or gone', () => {
    expect(presenceChain(row())).toBe('sunday-kids');
    expect(presenceChain(row({ boundChain: null }))).toBeNull();
    expect(presenceChain(row({ boundChain: '' }))).toBeNull();
    expect(presenceChain(row({ retiredAt: NINE_FORTY_SIX }))).toBeNull();
    expect(presenceChain(undefined)).toBeNull();
  });
});

describe('syncKioskPresence', () => {
  it('puts a kiosk set to a gathering on that chain, with its name and when it was last heard from', async () => {
    const db = new FakeFirestore();
    expect(await syncKioskPresence(db, LOBBY, undefined, row())).toBe('written');
    expect(presence(db, 'sunday-kids')).toEqual({
      chainKey: 'sunday-kids',
      devices: { [LOBBY]: { name: 'Lobby', lastSeenAt: NINE_FORTY_ONE } },
    });
  });

  it('keeps every kiosk on the chain, each in its own entry', async () => {
    const db = new FakeFirestore();
    await syncKioskPresence(db, LOBBY, undefined, row());
    await syncKioskPresence(db, NURSERY, undefined, row({ name: null, lastSeenAt: NINE_FORTY_SIX }));
    expect(presence(db, 'sunday-kids')!.devices).toEqual({
      [LOBBY]: { name: 'Lobby', lastSeenAt: NINE_FORTY_ONE },
      [NURSERY]: { name: null, lastSeenAt: NINE_FORTY_SIX },
    });
  });

  it('moves the moment forward with each report, and the name with a rename', async () => {
    const db = new FakeFirestore();
    await syncKioskPresence(db, LOBBY, undefined, row());
    await syncKioskPresence(db, LOBBY, row(), row({ lastSeenAt: NINE_FORTY_SIX }));
    await syncKioskPresence(
      db,
      LOBBY,
      row({ lastSeenAt: NINE_FORTY_SIX }),
      row({ lastSeenAt: NINE_FORTY_SIX, name: ' Front  door ' }),
    );
    expect(presence(db, 'sunday-kids')!.devices).toEqual({
      [LOBBY]: { name: 'Front door', lastSeenAt: NINE_FORTY_SIX },
    });
  });

  it('writes nothing for what a register would not see — a battery, a count', async () => {
    const db = new FakeFirestore();
    await syncKioskPresence(db, LOBBY, undefined, row());
    const writes = db.writes.length;
    expect(
      await syncKioskPresence(db, LOBBY, row(), row({ batteryLevel: 0.2, waitingCount: 12 })),
    ).toBe('unchanged');
    expect(db.writes.length).toBe(writes);
  });

  it('writes nothing for a kiosk on no chain before or after', async () => {
    const db = new FakeFirestore();
    expect(
      await syncKioskPresence(db, LOBBY, row({ boundChain: null }), row({ boundChain: null, name: 'X' })),
    ).toBe('unchanged');
    expect(db.writtenPaths('kioskPresence')).toEqual([]);
  });

  it('takes a kiosk off its chain when it is set to nothing, retired, or its row goes', async () => {
    for (const after of [row({ boundChain: null }), row({ retiredAt: NINE_FORTY_SIX }), undefined]) {
      const db = new FakeFirestore();
      await syncKioskPresence(db, LOBBY, undefined, row());
      await syncKioskPresence(db, NURSERY, undefined, row());
      await syncKioskPresence(db, LOBBY, row(), after);
      expect(Object.keys(presence(db, 'sunday-kids')!.devices as object)).toEqual([NURSERY]);
    }
  });

  it('moves a kiosk set to another gathering from one chain to the other', async () => {
    const db = new FakeFirestore();
    await syncKioskPresence(db, LOBBY, undefined, row());
    await syncKioskPresence(
      db,
      LOBBY,
      row(),
      row({ boundChain: 'wednesday-night', lastSeenAt: NINE_FORTY_SIX }),
    );
    expect(presence(db, 'sunday-kids')!.devices).toEqual({});
    expect(presence(db, 'wednesday-night')!.devices).toEqual({
      [LOBBY]: { name: 'Lobby', lastSeenAt: NINE_FORTY_SIX },
    });
  });

  it('writes nothing to a chain it is leaving that has no document', async () => {
    const db = new FakeFirestore();
    await syncKioskPresence(db, LOBBY, row(), row({ boundChain: null }));
    expect(presence(db, 'sunday-kids')).toBeUndefined();
  });

  it('reads a document it did not write defensively', async () => {
    const db = new FakeFirestore();
    db.seed('kioskPresence/sunday-kids', { chainKey: 'sunday-kids', devices: ['not', 'a', 'map'] });
    await syncKioskPresence(db, LOBBY, undefined, row());
    expect(presence(db, 'sunday-kids')!.devices).toEqual({
      [LOBBY]: { name: 'Lobby', lastSeenAt: NINE_FORTY_ONE },
    });
  });

  it('keeps a row that has not reported yet, with no moment', async () => {
    const db = new FakeFirestore();
    await syncKioskPresence(db, LOBBY, undefined, row({ lastSeenAt: undefined }));
    expect(presence(db, 'sunday-kids')!.devices).toEqual({
      [LOBBY]: { name: 'Lobby', lastSeenAt: null },
    });
  });
});
