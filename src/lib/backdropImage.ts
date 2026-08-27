/**
 * Turning whatever a leader hands the editor into pixels a kiosk will carry.
 *
 * The 40 MB phone panorama is the ordinary input, not the abuse case, and it
 * is dealt with here — on the leader's machine, at the moment of upload —
 * because the kiosk end of this feature is a screen on a shelf that does no
 * image work at all (see `lib/kioskBackdrop.ts`). Downscaled to the kiosk's
 * own ceiling, re-encoded toward a byte target, and hashed so the result
 * names itself.
 *
 * Re-encoding through a canvas also strips the file's metadata, which is not
 * a side effect but a requirement: a phone photo carries the GPS position of
 * wherever it was taken, and this image is bound for a screen in a public
 * lobby by way of a database the whole team can read.
 *
 * Browser-only (canvas, createImageBitmap, crypto.subtle) — this module is
 * deliberately not in `scripts/sync-functions-shared.mjs`'s list and must
 * never be: the shared `kioskBackdrop.ts` carries the caps and the id shape,
 * and this carries the work.
 */
import {
  KIOSK_BACKDROP_EDGE_PX,
  KIOSK_BACKDROP_MAX_BYTES,
  KIOSK_BACKDROP_TARGET_BYTES,
  kioskBackdropId,
  type KioskBackdropType,
} from '@/lib/kioskBackdrop';

export interface PreparedKioskBackdrop {
  /** Content-addressed — `b` + a prefix of the SHA-256 of `blob`'s bytes. */
  id: string;
  blob: Blob;
  contentType: KioskBackdropType;
  width: number;
  height: number;
}

/**
 * Thrown with a sentence fit for the person holding the file. The common one
 * is the format the browser cannot decode — an iPhone's HEIC on a non-Safari
 * machine — and the honest answer is the export step, not a bundled decoder:
 * a codec is megabytes in an editor everyone loads for a feature almost
 * nobody uses.
 */
export class BackdropImageError extends Error {}

const CANNOT_READ =
  'Couldn’t read that photo — export it as a JPEG (or take a screenshot of it) and try again.';

/**
 * The qualities tried, in order, until the target is met. Stopping at 0.55:
 * below that a photograph visibly falls apart, and a 1920-pixel frame that
 * still misses 350 KB at 0.55 is an image (noise, confetti) the hard ceiling
 * below is allowed to refuse.
 */
const QUALITIES = [0.85, 0.75, 0.65, 0.55] as const;

async function decodeToBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  // `from-image` so a phone photo shot sideways lands upright — EXIF is about
  // to be stripped, so the orientation it carried has to be applied first.
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older engines: an <img> honours EXIF natively (CSS image-orientation
    // defaults to from-image) and decodes everything the browser can show.
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new BackdropImageError(CANNOT_READ));
      };
      img.src = url;
    });
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function digestId(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0'));
  return kioskBackdropId(hex.join(''));
}

/**
 * One file in, one kiosk-ready image out — or a `BackdropImageError` whose
 * message is meant for the screen.
 */
export async function prepareKioskBackdrop(file: Blob): Promise<PreparedKioskBackdrop> {
  const source = await decodeToBitmap(file);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  if (!sourceWidth || !sourceHeight) throw new BackdropImageError(CANNOT_READ);

  // Never upscaled: a small image stays the size it honestly is, and the
  // guidance beside the picker is what says a bigger one would serve better.
  const scale = Math.min(1, KIOSK_BACKDROP_EDGE_PX / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new BackdropImageError(CANNOT_READ);
  context.drawImage(source, 0, 0, width, height);
  if ('close' in source) source.close();

  /*
   * WebP where the canvas can write it, JPEG where it cannot. The spec makes
   * an unsupported `toBlob` type fall back to PNG rather than fail, so the
   * answer's own `type` is the test — a PNG of a photograph would be the
   * largest possible encoding of it, which is the opposite of the job.
   */
  let best: { blob: Blob; contentType: KioskBackdropType } | null = null;
  for (const contentType of ['image/webp', 'image/jpeg'] as const) {
    for (const quality of QUALITIES) {
      const blob = await encode(canvas, contentType, quality);
      if (!blob || blob.type !== contentType) break;
      best = { blob, contentType };
      if (blob.size <= KIOSK_BACKDROP_TARGET_BYTES) break;
    }
    if (best) break;
  }

  if (!best) throw new BackdropImageError(CANNOT_READ);
  if (best.blob.size > KIOSK_BACKDROP_MAX_BYTES) {
    throw new BackdropImageError(
      'That image stays too heavy even compressed — try a simpler photo.',
    );
  }

  return { id: await digestId(best.blob), blob: best.blob, contentType: best.contentType, width, height };
}

/** "1920 px · 240 KB" — the compressor saying what it did. */
export function describePrepared(prepared: PreparedKioskBackdrop): string {
  const edge = Math.max(prepared.width, prepared.height);
  return `${edge} px · ${Math.max(1, Math.round(prepared.blob.size / 1024))} KB`;
}
