/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/kioskBackdrop.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * The photograph a gathering stands behind its lobby kiosk.
 *
 * A backdrop is finished pixels in `kioskBackdrops/{id}`: one Firestore
 * document holding the encoded image as bytes, written by the event editor
 * after it has resized and compressed whatever a leader handed it. The event
 * document carries only the id. That split is the same one the theme made and
 * for the same reasons — the events collection is read wholesale by the kiosk
 * chooser and subscribed by the calendar, and a photograph riding on every one
 * of those reads would bill the common case for the rare one — plus one more:
 * a Firestore document tops out at a megabyte, so the image and the event
 * cannot share one anyway.
 *
 * The id is content-addressed — `b` and a prefix of the SHA-256 of the encoded
 * bytes — so the id *is* the revision: a kiosk that has cached `b3f9…` never
 * has to ask whether it changed, and replacing the photo means a new id on the
 * event rather than new bytes under an old one. Two gatherings uploading the
 * same file share a document, which is also why replacing a photo never
 * deletes the old document: nothing says this gathering was its only wearer,
 * and an orphaned document is a few hundred kilobytes of storage where a
 * dangling id is a kiosk with no backdrop.
 *
 * ## Where this runs
 *
 * In the editor and on the server — the kiosk imports the sanitizer and the
 * caps, which cost nothing, and does no image work at all: it is handed an id,
 * reads the finished bytes once, and caches them (see `src/kiosk/backdrop.ts`).
 * Mirrored into `functions/src/generated/` by `scripts/sync-functions-shared.mjs`,
 * so it must stay import-free.
 */

export const KIOSK_BACKDROPS_COLLECTION = 'kioskBackdrops';

/**
 * The ceiling on the encoded image, in bytes, enforced three times over: the
 * editor refuses to save past it, `firestore.rules` refuses the write (the
 * copy of this number there cannot import it — keep the two together), and the
 * kiosk refuses to cache anything larger a hand-written document smuggled in.
 *
 * 600 KB is comfortably under Firestore's megabyte with the sibling fields
 * beside it, and far above what the editor actually produces: a 1920-pixel
 * WebP of a room lands nearer 200. The gap is headroom for a genuinely busy
 * image, not an invitation — the editor aims well below (see
 * `KIOSK_BACKDROP_TARGET_BYTES`) because every one of these is a download to a
 * shelf on lobby wifi and a decode on the cheapest tablet the church owns.
 */
export const KIOSK_BACKDROP_MAX_BYTES = 600_000;

/** What the editor compresses toward before it starts lowering quality. */
export const KIOSK_BACKDROP_TARGET_BYTES = 350_000;

/**
 * The longest edge the editor resizes to, in pixels.
 *
 * One image serves both shapes a kiosk stands in — 1280×800 on a shelf and
 * 800×1280 on an easel — by cover-cropping, so the source has to carry enough
 * pixels for whichever axis the crop stretches. 1920 covers both with room for
 * a 1.5× panel, and past it every further pixel is decode time on hardware
 * this repo measures in Raspberry Pis (see docs/kiosk-performance.md).
 */
export const KIOSK_BACKDROP_EDGE_PX = 1920;

/**
 * The encodings a backdrop may arrive in — what the editor's canvas can
 * produce, newest preference first. Everything a kiosk might run decodes both.
 */
export const KIOSK_BACKDROP_TYPES = ['image/webp', 'image/jpeg'] as const;

export type KioskBackdropType = (typeof KIOSK_BACKDROP_TYPES)[number];

/**
 * `b` + 16–64 hex characters: the shape every id this code ever mints has,
 * pinned tightly because of where ids travel. An id becomes a Firestore
 * document path on the kiosk and a cache key inside its Cache API bucket, and
 * both are places a `/` or a URL would slice into something else — the same
 * argument `validChainRef` makes in firestore.rules, made shorter here because
 * unlike a chain ref nothing legacy ever wrote a looser one.
 */
const ID = /^b[0-9a-f]{16,64}$/;

/**
 * A stored id, made safe — for the converter reading an event document, the
 * server building a chooser row, and the kiosk persisting a binding. Null in,
 * null out: an unphotographed gathering is the ordinary case and stays free.
 */
export function sanitizeKioskBackdropId(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value) ? value : null;
}

export function sanitizeKioskBackdropType(value: unknown): KioskBackdropType | null {
  return KIOSK_BACKDROP_TYPES.includes(value as KioskBackdropType)
    ? (value as KioskBackdropType)
    : null;
}

/** The id the editor mints for one encoded image: `b` + 32 hex of its SHA-256. */
export function kioskBackdropId(digestHex: string): string {
  return `b${digestHex.slice(0, 32)}`;
}
