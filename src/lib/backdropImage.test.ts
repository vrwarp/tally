/**
 * The compressor against stub seams. jsdom decodes nothing and its canvas
 * draws nothing, so `createImageBitmap`, the 2d context and `toBlob` are stood
 * in for — what is under test is everything around them: the scaling
 * arithmetic, the quality ladder and its stopping rules, the two ceilings, the
 * digest naming, and the sentences a person gets when a photo refuses.
 */
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KIOSK_BACKDROP_MAX_BYTES,
  KIOSK_BACKDROP_TARGET_BYTES,
  kioskBackdropId,
} from '@/lib/kioskBackdrop';
import {
  BackdropImageError,
  describePrepared,
  prepareKioskBackdrop,
  type PreparedKioskBackdrop,
} from './backdropImage';

const CANNOT_READ =
  'Couldn’t read that photo — export it as a JPEG (or take a screenshot of it) and try again.';

/** Bytes with a size and a type — all the ladder ever looks at. */
function blobOf(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

let encodePlan: (type: string, quality: number) => Blob | null;
let encoded: Array<{ type: string; quality: number; width: number; height: number }>;
let drawImage: ReturnType<typeof vi.fn>;

function stubCanvas(): void {
  drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    encoded.push({ type: type ?? '', quality: Number(quality), width: this.width, height: this.height });
    callback(encodePlan(type ?? '', Number(quality)));
  });
}

function stubBitmap(width: number, height: number) {
  const bitmap = { width, height, close: vi.fn() };
  const create = vi.fn(async () => bitmap as unknown as ImageBitmap);
  vi.stubGlobal('createImageBitmap', create);
  return { bitmap, create };
}

beforeEach(() => {
  encoded = [];
  encodePlan = () => blobOf(1_000, 'image/webp');
  stubCanvas();
  // jsdom's crypto has no `subtle`; the digest is Node's own either way.
  if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preparing a photograph', () => {
  it('downscales a landscape phone shot to the kiosk ceiling, upright, in one encode', async () => {
    const file = blobOf(40, 'image/jpeg');
    const { bitmap, create } = stubBitmap(4000, 3000);
    const out = blobOf(200_000, 'image/webp');
    encodePlan = () => out;

    const prepared = await prepareKioskBackdrop(file);

    expect(create).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(prepared.width).toBe(1920);
    expect(prepared.height).toBe(1440);
    expect(prepared.contentType).toBe('image/webp');
    expect(prepared.blob).toBe(out);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1920, 1440);
    expect(bitmap.close).toHaveBeenCalled();
    expect(encoded).toEqual([{ type: 'image/webp', quality: 0.85, width: 1920, height: 1440 }]);
  });

  it('scales a portrait by its longer edge', async () => {
    stubBitmap(3000, 4000);
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    expect(prepared.width).toBe(1440);
    expect(prepared.height).toBe(1920);
  });

  it('never upscales a small image', async () => {
    stubBitmap(800, 600);
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    expect(prepared.width).toBe(800);
    expect(prepared.height).toBe(600);
  });

  it('keeps a pixel for a one-pixel sliver rather than rounding it away', async () => {
    stubBitmap(1, 4000);
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    expect(prepared.width).toBe(1);
    expect(prepared.height).toBe(1920);
  });

  it('refuses a decode with no width, whatever the height says', async () => {
    stubBitmap(0, 4000);
    await expect(prepareKioskBackdrop(blobOf(10, 'image/jpeg'))).rejects.toThrow(CANNOT_READ);
  });

  it('reads as unreadable when the canvas refuses a context', async () => {
    stubBitmap(100, 100);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(prepareKioskBackdrop(blobOf(10, 'image/jpeg'))).rejects.toThrow(CANNOT_READ);
  });

  it('walks down the ladder and stops the moment the target is met, inclusive', async () => {
    stubBitmap(1920, 1080);
    const sizes: Record<string, number> = {
      '0.85': 500_000,
      '0.75': 400_000,
      '0.65': KIOSK_BACKDROP_TARGET_BYTES,
    };
    encodePlan = (_type, quality) => blobOf(sizes[String(quality)] ?? 1, 'image/webp');
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    expect(encoded.map((call) => call.quality)).toEqual([0.85, 0.75, 0.65]);
    expect(prepared.blob.size).toBe(KIOSK_BACKDROP_TARGET_BYTES);
  });

  it('keeps the lowest rung when even it misses the target, rather than giving up', async () => {
    stubBitmap(1920, 1080);
    const rungs = [500_000, 480_000, 460_000, 440_000];
    encodePlan = () => blobOf(rungs[encoded.length - 1], 'image/webp');
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    expect(encoded.map((call) => call.quality)).toEqual([0.85, 0.75, 0.65, 0.55]);
    expect(prepared.blob.size).toBe(440_000);
  });

  it('falls back to jpeg when the canvas answers webp with a png', async () => {
    stubBitmap(1920, 1080);
    encodePlan = (type) =>
      type === 'image/webp' ? blobOf(100, 'image/png') : blobOf(100, 'image/jpeg');
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    expect(prepared.contentType).toBe('image/jpeg');
    expect(encoded.map((call) => [call.type, call.quality])).toEqual([
      ['image/webp', 0.85],
      ['image/jpeg', 0.85],
    ]);
  });

  it('falls back to jpeg when webp encodes to nothing at all', async () => {
    stubBitmap(1920, 1080);
    encodePlan = (type) => (type === 'image/webp' ? null : blobOf(100, 'image/jpeg'));
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    expect(prepared.contentType).toBe('image/jpeg');
  });

  it('reads as unreadable when nothing encodes anywhere', async () => {
    stubBitmap(1920, 1080);
    encodePlan = () => null;
    const error: unknown = await prepareKioskBackdrop(blobOf(10, 'image/jpeg')).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(BackdropImageError);
    expect((error as Error).message).toBe(CANNOT_READ);
  });

  it('refuses an image still too heavy at the bottom of the ladder', async () => {
    stubBitmap(1920, 1080);
    encodePlan = () => blobOf(KIOSK_BACKDROP_MAX_BYTES + 1, 'image/webp');
    await expect(prepareKioskBackdrop(blobOf(10, 'image/jpeg'))).rejects.toThrow(
      'That image stays too heavy even compressed — try a simpler photo.',
    );
  });

  it('allows exactly the ceiling', async () => {
    stubBitmap(1920, 1080);
    encodePlan = () => blobOf(KIOSK_BACKDROP_MAX_BYTES, 'image/webp');
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    expect(prepared.blob.size).toBe(KIOSK_BACKDROP_MAX_BYTES);
  });

  it('names the image after its bytes', async () => {
    stubBitmap(100, 100);
    const pixels = new Uint8Array([7, 7, 7, 1, 2, 3, 1]);
    encodePlan = () => new Blob([pixels], { type: 'image/webp' });
    const prepared = await prepareKioskBackdrop(blobOf(10, 'image/jpeg'));
    // Independently computed, so the module's own hex assembly is on the hook.
    const hex = createHash('sha256').update(pixels).digest('hex');
    expect(prepared.id).toBe(kioskBackdropId(hex));
  });
});

describe('decoding without createImageBitmap', () => {
  function stubImage(behaviour: 'load' | 'error', w = 4000, h = 3000): void {
    class FakeImage {
      width = w;
      height = h;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => (behaviour === 'load' ? this.onload : this.onerror)?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
  }

  it('decodes through an image element, which honours EXIF natively', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    stubImage('load');
    const file = blobOf(10, 'image/jpeg');
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backdrop');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const prepared = await prepareKioskBackdrop(file);

    expect(prepared.width).toBe(1920);
    expect(prepared.height).toBe(1440);
    expect(createUrl).toHaveBeenCalledWith(file);
    expect(revoke).toHaveBeenCalledWith('blob:backdrop');
  });

  it('says the export sentence when the element cannot decode it either', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    stubImage('error');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backdrop');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await expect(prepareKioskBackdrop(blobOf(10, 'image/heic'))).rejects.toThrow(CANNOT_READ);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

describe('describePrepared', () => {
  const prepared = (width: number, height: number, size: number): PreparedKioskBackdrop => ({
    id: 'b0',
    blob: blobOf(size, 'image/webp'),
    contentType: 'image/webp',
    width,
    height,
  });

  it('says the long edge and the weight', () => {
    expect(describePrepared(prepared(1920, 1080, 240 * 1024))).toBe('1920 px · 240 KB');
  });

  it('measures a portrait by its height', () => {
    expect(describePrepared(prepared(800, 1920, 240 * 1024))).toBe('1920 px · 240 KB');
  });

  it('never claims less than a kilobyte', () => {
    expect(describePrepared(prepared(10, 10, 100))).toBe('10 px · 1 KB');
  });
});
