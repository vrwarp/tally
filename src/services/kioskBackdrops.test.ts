/**
 * The Firestore between, against mocked firestore primitives. Content
 * addressing makes the write create-only and race-tolerant, and the read
 * answers null to anything it cannot vouch for — both halves are contracts the
 * rules enforce from their side, so the client honouring them is the claim.
 */
import { describe, expect, it, vi } from 'vitest';
import { Bytes, Timestamp, doc, getDoc, setDoc } from 'firebase/firestore';

import { KIOSK_BACKDROP_MAX_BYTES } from '@/lib/kioskBackdrop';
import type { PreparedKioskBackdrop } from '@/lib/backdropImage';
import { fetchKioskBackdrop, putKioskBackdrop } from './kioskBackdrops';

vi.mock('@/lib/firebase', () => ({ db: { app: 'fake' } }));

vi.mock('firebase/firestore', () => {
  class Bytes {
    constructor(readonly bytes: Uint8Array) {}
    static fromUint8Array(bytes: Uint8Array): Bytes {
      return new Bytes(bytes);
    }
    toUint8Array(): Uint8Array {
      return this.bytes;
    }
  }
  class Timestamp {
    constructor(readonly when: Date) {}
    static fromDate(when: Date): Timestamp {
      return new Timestamp(when);
    }
    toDate(): Date {
      return this.when;
    }
  }
  return {
    Bytes,
    Timestamp,
    doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
    getDoc: vi.fn(),
    setDoc: vi.fn(async () => {}),
    serverTimestamp: vi.fn(() => ({ sentinel: 'server-time' })),
  };
});

const ID = 'b00112233445566778899aabbccddeeff';
const PIXELS = new Uint8Array([1, 2, 3, 4]);

function prepared(): PreparedKioskBackdrop {
  return {
    id: ID,
    blob: new Blob([PIXELS], { type: 'image/webp' }),
    contentType: 'image/webp',
    width: 1920,
    height: 1080,
  };
}

const snap = (data?: Record<string, unknown>) =>
  ({ exists: () => data !== undefined, data: () => data }) as never;

describe('putKioskBackdrop', () => {
  it('points at a photograph the store already holds without writing again', async () => {
    vi.mocked(getDoc).mockResolvedValue(snap({ image: 'already-there' }));

    expect(await putKioskBackdrop(prepared(), 'uid-1')).toBe(ID);

    expect(setDoc).not.toHaveBeenCalled();
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'kioskBackdrops', ID);
  });

  it('writes the finished pixels, stamped by whoever stood them up', async () => {
    vi.mocked(getDoc).mockResolvedValue(snap());

    expect(await putKioskBackdrop(prepared(), 'uid-1')).toBe(ID);

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = vi.mocked(setDoc).mock.calls[0] as unknown as [
      { collection: string; id: string },
      Record<string, unknown>,
    ];
    expect(ref).toEqual({ collection: 'kioskBackdrops', id: ID });
    expect(payload.image).toBeInstanceOf(Bytes);
    expect((payload.image as Bytes).toUint8Array()).toEqual(PIXELS);
    expect(payload.contentType).toBe('image/webp');
    expect(payload.width).toBe(1920);
    expect(payload.height).toBe(1080);
    expect(payload.updatedAt).toEqual({ sentinel: 'server-time' });
    expect(payload.updatedBy).toBe('uid-1');
  });

  it('tolerates losing the race to another admin uploading the same photograph', async () => {
    vi.mocked(getDoc)
      .mockResolvedValueOnce(snap())
      .mockResolvedValueOnce(snap({ image: 'the-winner-wrote-it' }));
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('permission-denied'));

    expect(await putKioskBackdrop(prepared(), 'uid-1')).toBe(ID);
  });

  it('rethrows a write that failed with nothing to show for it', async () => {
    const refusal = new Error('permission-denied');
    vi.mocked(getDoc).mockResolvedValue(snap());
    vi.mocked(setDoc).mockRejectedValueOnce(refusal);

    await expect(putKioskBackdrop(prepared(), 'uid-1')).rejects.toBe(refusal);
  });
});

describe('fetchKioskBackdrop', () => {
  it('refuses a nonsense id without spending a read', async () => {
    expect(await fetchKioskBackdrop('nope')).toBeNull();
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('hands back the pixels and the day they were uploaded', async () => {
    const uploaded = new Date('2026-08-01T10:00:00Z');
    vi.mocked(getDoc).mockResolvedValue(
      snap({
        image: Bytes.fromUint8Array(PIXELS),
        contentType: 'image/webp',
        updatedAt: Timestamp.fromDate(uploaded),
      }),
    );

    const stored = await fetchKioskBackdrop(ID);

    expect(stored?.blob.type).toBe('image/webp');
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(PIXELS);
    expect(stored?.updatedAt).toEqual(uploaded);
  });

  it('answers null for a photograph nobody ever stored', async () => {
    vi.mocked(getDoc).mockResolvedValue(snap());
    expect(await fetchKioskBackdrop(ID)).toBeNull();
  });

  it('refuses an image that is not Firestore bytes', async () => {
    vi.mocked(getDoc).mockResolvedValue(
      snap({ image: PIXELS, contentType: 'image/webp' }),
    );
    expect(await fetchKioskBackdrop(ID)).toBeNull();
  });

  it('refuses a content type the kiosk would refuse', async () => {
    vi.mocked(getDoc).mockResolvedValue(
      snap({ image: Bytes.fromUint8Array(PIXELS), contentType: 'image/gif' }),
    );
    expect(await fetchKioskBackdrop(ID)).toBeNull();
  });

  it('refuses empty pixels', async () => {
    vi.mocked(getDoc).mockResolvedValue(
      snap({ image: Bytes.fromUint8Array(new Uint8Array(0)), contentType: 'image/webp' }),
    );
    expect(await fetchKioskBackdrop(ID)).toBeNull();
  });

  it('honours exactly the ceiling and refuses one byte past it', async () => {
    vi.mocked(getDoc).mockResolvedValue(
      snap({
        image: Bytes.fromUint8Array(new Uint8Array(KIOSK_BACKDROP_MAX_BYTES)),
        contentType: 'image/webp',
      }),
    );
    expect(await fetchKioskBackdrop(ID)).not.toBeNull();

    vi.mocked(getDoc).mockResolvedValue(
      snap({
        image: Bytes.fromUint8Array(new Uint8Array(KIOSK_BACKDROP_MAX_BYTES + 1)),
        contentType: 'image/webp',
      }),
    );
    expect(await fetchKioskBackdrop(ID)).toBeNull();
  });

  it('reads a stamp of the wrong shape as no date, not as no photograph', async () => {
    vi.mocked(getDoc).mockResolvedValue(
      snap({ image: Bytes.fromUint8Array(PIXELS), contentType: 'image/webp', updatedAt: {} }),
    );

    const stored = await fetchKioskBackdrop(ID);

    expect(stored).not.toBeNull();
    expect(stored?.updatedAt).toBeNull();
  });

  it('reads a read that throws as nothing', async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error('offline'));
    expect(await fetchKioskBackdrop(ID)).toBeNull();
  });
});
