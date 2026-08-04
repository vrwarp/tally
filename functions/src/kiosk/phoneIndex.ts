/**
 * Building `kioskIndex/phones` — the one document behind the kiosk's
 * search-by-phone.
 *
 * The kiosk matches the four digits a parent types against this inverted map:
 * `last4 -> student ids`. It is derived data in the fullest sense — rebuilt
 * from the backends at any time, holding nothing but tail digits and ids the
 * caller may already read — which is why it may exist at all in a database
 * that deliberately stores no phone numbers (docs/data-model.md, "What is not
 * stored"). The full numbers live and stay upstream; each backend's collector
 * reduces them to last-4s before anything returns.
 *
 * Built by the scheduled nightly rebuild, by the Settings button, and by a
 * pairing approval that finds it stale — see the wiring in ../index.ts.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { BackendRegistry } from '../backends/registry.js';
import { scanRoster } from '../backends/scan.js';
import type { FirestoreLike, FunctionLogger } from '../firestore.js';
import { studentIdFor } from '../generated/backendIds.js';

export const PHONE_INDEX_DOC = 'kioskIndex/phones';

/**
 * Rebuilt when older than this by the opportunistic paths (pairing approval);
 * the nightly schedule refreshes it regardless.
 */
export const PHONE_INDEX_STALE_MS = 24 * 60 * 60_000;

/** A serialized doc bigger than this is logged; Firestore's ceiling is 1 MiB. */
const SIZE_WARNING_BYTES = 800_000;

export interface PhoneIndexSummary {
  students: number;
  entries: number;
  builtAt: string;
}

/**
 * Reads every backend's family phone digits and writes the inverted index.
 *
 * A backend that fails — down, rate-limited, misconfigured — fails the build
 * rather than silently producing an index missing half the ministry: a parent
 * whose student stops matching would read as "we lost your kid", and stale
 * beats wrong here because the numbers behind the digits barely change.
 */
export async function buildPhoneIndex(
  db: FirestoreLike,
  registry: BackendRegistry,
  options: { force?: boolean; builtBy: string; now?: Date; logger?: FunctionLogger },
): Promise<PhoneIndexSummary> {
  const now = options.now ?? new Date();
  const scan = await scanRoster(db);

  // Student document id -> that student's family last-4s.
  const byStudent = new Map<string, Set<string>>();

  for (const backendId of registry.ids()) {
    const backend = registry.get(backendId);
    if (!backend?.collectPhoneLast4) continue;

    const direct = scan.personIds[backendId];
    const linked = scan.linkedPersonIds[backendId];
    const personIds = [...direct, ...linked];
    if (personIds.length === 0) continue;

    const collected = await backend.collectPhoneLast4({ personIds, force: options.force });

    for (const [personId, last4s] of Object.entries(collected)) {
      // A pushed visitor's document keeps its Tally id; everyone else's
      // document id is derived from the person id itself.
      const studentId =
        scan.studentIdByLinkedPersonId[backendId][personId] ?? studentIdFor(backendId, personId);
      let bucket = byStudent.get(studentId);
      if (!bucket) byStudent.set(studentId, (bucket = new Set()));
      for (const last4 of last4s) bucket.add(last4);
    }
  }

  const last4: Record<string, string[]> = {};
  for (const [studentId, digits] of byStudent) {
    for (const d of digits) {
      const bucket = last4[d];
      if (bucket) bucket.push(studentId);
      else last4[d] = [studentId];
    }
  }
  for (const bucket of Object.values(last4)) bucket.sort();

  const payload = {
    version: 1,
    builtAt: Timestamp.fromDate(now),
    builtBy: options.builtBy,
    last4,
  };

  const size = JSON.stringify(last4).length;
  if (size > SIZE_WARNING_BYTES) {
    options.logger?.warn('Kiosk phone index is approaching the 1 MiB document ceiling', {
      bytes: size,
    });
  }

  await db.doc(PHONE_INDEX_DOC).set(payload);

  return {
    students: byStudent.size,
    entries: Object.keys(last4).length,
    builtAt: now.toISOString(),
  };
}

/** Whether the stored index is missing or old enough to rebuild opportunistically. */
export async function phoneIndexIsStale(db: FirestoreLike, now: Date): Promise<boolean> {
  const snapshot = await db.doc(PHONE_INDEX_DOC).get();
  if (!snapshot.exists) return true;
  const builtAt = snapshot.data()?.builtAt;
  const builtDate =
    typeof (builtAt as { toDate?: unknown })?.toDate === 'function'
      ? (builtAt as { toDate(): Date }).toDate()
      : builtAt instanceof Date
        ? builtAt
        : null;
  if (!builtDate) return true;
  return now.getTime() - builtDate.getTime() > PHONE_INDEX_STALE_MS;
}
