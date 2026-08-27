/**
 * Reading and writing `kioskBackdrops/{id}` — the finished pixels a lobby
 * kiosk stands behind. The model lives in `lib/kioskBackdrop.ts`; the pixels
 * are made in `lib/backdropImage.ts`; this file is the Firestore between.
 */
import {
  Bytes,
  Timestamp,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { PreparedKioskBackdrop } from '@/lib/backdropImage';
import {
  KIOSK_BACKDROPS_COLLECTION,
  KIOSK_BACKDROP_MAX_BYTES,
  sanitizeKioskBackdropId,
  sanitizeKioskBackdropType,
} from '@/lib/kioskBackdrop';

/**
 * Stores one prepared image and answers the id the event should point at.
 *
 * A read before the write, and the write tolerating a loser's race, are both
 * the content-addressing at work: the id names the bytes, so a document that
 * already exists under it *is* this image — uploaded by this gathering last
 * season, or by another one entirely — and the only thing left to do is point
 * at it. The rules enforce the same shape from their side (create-only; see
 * firestore.rules), which is why the race's losing `setDoc` surfaces as
 * permission-denied and is answered by looking again rather than by failing
 * the save.
 */
export async function putKioskBackdrop(
  prepared: PreparedKioskBackdrop,
  uid: string,
): Promise<string> {
  const ref = doc(db, KIOSK_BACKDROPS_COLLECTION, prepared.id);
  const existing = await getDoc(ref);
  if (existing.exists()) return prepared.id;

  const payload = {
    image: Bytes.fromUint8Array(new Uint8Array(await prepared.blob.arrayBuffer())),
    contentType: prepared.contentType,
    width: prepared.width,
    height: prepared.height,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };

  try {
    await setDoc(ref, payload);
  } catch (error) {
    // Two admins, one photograph, same moment: the second write is an update
    // of a create-only document. If the image is there, the job is done.
    const settled = await getDoc(ref);
    if (!settled.exists()) throw error;
  }
  return prepared.id;
}

export interface StoredKioskBackdrop {
  blob: Blob;
  /** When it was first uploaded — the "Photo · uploaded 12 Oct" line. */
  updatedAt: Date | null;
}

/**
 * One stored image, for the editor's preview of a photograph chosen on some
 * earlier Tuesday. Null for anything missing or malformed — the field shows
 * the pointer's state honestly and offers the fix, which is a new upload.
 */
export async function fetchKioskBackdrop(id: string): Promise<StoredKioskBackdrop | null> {
  const safe = sanitizeKioskBackdropId(id);
  if (!safe) return null;
  try {
    const snapshot = await getDoc(doc(db, KIOSK_BACKDROPS_COLLECTION, safe));
    const data = snapshot.data();
    if (!data) return null;
    const image = data.image;
    const contentType = sanitizeKioskBackdropType(data.contentType);
    if (!(image instanceof Bytes) || !contentType) return null;
    const bytes = image.toUint8Array();
    if (bytes.byteLength === 0 || bytes.byteLength > KIOSK_BACKDROP_MAX_BYTES) return null;
    return {
      blob: new Blob([bytes as unknown as BlobPart], { type: contentType }),
      updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null,
    };
  } catch {
    return null;
  }
}
