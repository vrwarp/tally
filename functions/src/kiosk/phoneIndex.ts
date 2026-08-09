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
import { toDateOrNull, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import { studentIdFor } from '../generated/backendIds.js';
import { bumpPulse } from './pulse.js';

export const PHONE_INDEX_DOC = 'kioskIndex/phones';

/**
 * The digits a family typed in themselves, waiting for the backends to say the
 * same thing.
 *
 * A family who registers at the kiosk has to be findable by their phone number
 * *immediately* — the whole handoff is "type your last four digits" — but the
 * number they typed lives upstream at best a moment later, and on a deployment
 * whose write-back cannot create a household, never. Rebuilding the index from
 * the backends alone would therefore lose them: the nightly rebuild would
 * silently un-register a family who registered that morning.
 *
 * So the registration writes its digits here, and every rebuild folds this
 * document in. It holds exactly what the main index holds — tail digits and
 * student ids — and each entry leaves as soon as it is redundant.
 */
export const PENDING_LAST4_DOC = 'kioskIndex/pendingLast4';

/**
 * How long an overlay entry is kept when the backends never corroborate it.
 *
 * Two weeks is long enough for a family to come back a second and third time on
 * digits the church office has not yet entered anywhere, and short enough that
 * a number typed wrongly stops answering before anybody builds a habit on it.
 */
export const PENDING_LAST4_TTL_MS = 14 * 24 * 60 * 60_000;

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

/* -------------------------------------------------------------------------- */
/* The overlay                                                                 */
/* -------------------------------------------------------------------------- */

interface PendingLast4Entry {
  last4: string;
  studentIds: string[];
  addedAt: Date | null;
}

function readPendingEntries(
  data: Record<string, unknown> | undefined,
): Map<string, PendingLast4Entry> {
  const entries = new Map<string, PendingLast4Entry>();
  const raw = (data?.entries ?? {}) as Record<string, unknown>;
  for (const [registrationId, value] of Object.entries(raw)) {
    const entry = (value ?? {}) as Record<string, unknown>;
    const last4 = typeof entry.last4 === 'string' ? entry.last4 : '';
    const studentIds = Array.isArray(entry.studentIds)
      ? entry.studentIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (!/^\d{4}$/.test(last4) || studentIds.length === 0) continue;
    entries.set(registrationId, { last4, studentIds, addedAt: toDateOrNull(entry.addedAt) });
  }
  return entries;
}

/**
 * Remembers one family's digits until the backends can answer for them.
 *
 * Keyed by registration rather than by digits, which is what makes it both
 * idempotent under a retry and prunable per family: two families sharing a last
 * four are two entries, and one being adopted upstream does not take the
 * other's answer away.
 */
export async function recordPendingLast4(
  db: FirestoreLike,
  entry: { registrationId: string; last4: string; studentIds: readonly string[] },
  now: Date,
): Promise<void> {
  await db.doc(PENDING_LAST4_DOC).set(
    {
      version: 1,
      entries: {
        [entry.registrationId]: {
          last4: entry.last4,
          studentIds: [...entry.studentIds],
          addedAt: Timestamp.fromDate(now),
        },
      },
    },
    { merge: true },
  );
}

/**
 * Which four digits already find these students.
 *
 * For the sibling journey: a parent adding a second child typed their four
 * digits to get here, but the *server* is not told what they typed — a client
 * that could name the digits could file a child under a stranger's number. So
 * the digits are read back out of the index instead, from the siblings the
 * request named and the server verified. Nothing is trusted that was not
 * already derived from a backend or from a registration the server itself
 * wrote.
 *
 * The overlay is consulted as well as the live map, because a family who
 * registered this morning is only in the overlay until the nightly rebuild —
 * which is exactly the family most likely to come back and add somebody.
 */
export async function last4ForStudents(
  db: FirestoreLike,
  studentIds: readonly string[],
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const wanted = new Set(studentIds);
  const found = new Set<string>();

  const live = await db.doc(PHONE_INDEX_DOC).get();
  for (const [last4, ids] of Object.entries(
    (live.data()?.last4 ?? {}) as Record<string, unknown>,
  )) {
    if (Array.isArray(ids) && ids.some((id) => typeof id === 'string' && wanted.has(id))) {
      found.add(last4);
    }
  }

  const overlay = await db.doc(PENDING_LAST4_DOC).get();
  for (const entry of readPendingEntries(overlay.data()).values()) {
    if (entry.studentIds.some((id) => wanted.has(id))) found.add(entry.last4);
  }

  return [...found].sort();
}

/**
 * Folds one family into the live index without waiting for a rebuild.
 *
 * A read-modify-write on a document only the functions touch, and the one race
 * it has is benign: two registrations patching the same four digits in the same
 * instant can drop one of the two unions, and the next rebuild restores it from
 * the overlay. The alternative — a transaction on the ministry's whole phone
 * index while a parent waits at a screen — costs more than the failure does.
 */
export async function patchPhonesNow(
  db: FirestoreLike,
  last4: string,
  studentIds: readonly string[],
): Promise<void> {
  const ref = db.doc(PHONE_INDEX_DOC);
  const snapshot = await ref.get();
  const existing = ((snapshot.data()?.last4 ?? {}) as Record<string, unknown>)[last4];
  const held = Array.isArray(existing)
    ? existing.filter((id): id is string => typeof id === 'string')
    : [];
  const merged = [...new Set([...held, ...studentIds])].sort();
  await ref.set({ last4: { [last4]: merged } }, { merge: true });
}

/**
 * Takes a family back out of four digits they should never have answered to.
 *
 * The counterpart of `patchPhonesNow`, and it exists for exactly one caller: a
 * reviewer correcting the number a parent mistyped at the kiosk
 * (`amend.ts`). Without it the correction is additive — the children start
 * answering to the right digits and go on answering to the wrong ones, which
 * means a *stranger* who types their own last four at the lobby is handed
 * somebody else's children, correctly spelled, by name. That is the failure the
 * kiosk's whole search screen is built to avoid, so a correction that leaves it
 * behind is not a correction.
 *
 * Safe on exactly these students because they are held: nothing about them has
 * reached a backend, so the only reason they are in this map at all is the
 * patch their own registration made.
 *
 * One key, written back as a shorter list — the same read-modify-write on the
 * same document as `patchPhonesNow`, with the same benign race. A bucket that
 * empties is left as `[]` rather than removed, because a merged write has no
 * way to say "this key is gone" without `FieldValue`, which nothing in
 * `functions/src` uses; an empty bucket answers nobody, and the nightly rebuild
 * rewrites the map from scratch anyway.
 */
export async function dropFromPhonesNow(
  db: FirestoreLike,
  last4: string,
  studentIds: readonly string[],
): Promise<void> {
  const ref = db.doc(PHONE_INDEX_DOC);
  const snapshot = await ref.get();
  const existing = ((snapshot.data()?.last4 ?? {}) as Record<string, unknown>)[last4];
  if (!Array.isArray(existing)) return;
  const dropping = new Set(studentIds);
  const kept = existing.filter((id): id is string => typeof id === 'string' && !dropping.has(id));
  if (kept.length === existing.length) return;
  await ref.set({ last4: { [last4]: kept.sort() } }, { merge: true });
}

/**
 * Folds the overlay into a freshly built map, and drops what it no longer owes.
 *
 * An entry leaves on either of two conditions: the backends now answer for
 * every one of its students under the same digits — the household write landed,
 * or the office typed the number in — or it has sat here past its TTL without
 * that ever happening. Anything else stays, because the family it belongs to is
 * still using it.
 */
export function mergePendingLast4(
  built: Map<string, Set<string>>,
  entries: Map<string, PendingLast4Entry>,
  now: Date,
): { survivors: Map<string, PendingLast4Entry>; merged: number } {
  const survivors = new Map<string, PendingLast4Entry>();
  let merged = 0;

  for (const [registrationId, entry] of entries) {
    const upstreamHasAll = entry.studentIds.every((studentId) =>
      built.get(studentId)?.has(entry.last4),
    );
    if (upstreamHasAll) continue;

    const addedAt = entry.addedAt;
    if (addedAt === null || now.getTime() - addedAt.getTime() > PENDING_LAST4_TTL_MS) continue;

    for (const studentId of entry.studentIds) {
      let bucket = built.get(studentId);
      if (!bucket) built.set(studentId, (bucket = new Set()));
      bucket.add(entry.last4);
    }
    survivors.set(registrationId, entry);
    merged += 1;
  }

  return { survivors, merged };
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

  /*
   * The families who registered themselves, folded in before the map is
   * inverted — so a rebuild can only ever *add* to what a registration made
   * findable, never take it away. The overlay is rewritten with whatever is
   * still owed, which is this document's only garbage collection.
   */
  const pendingSnapshot = await db.doc(PENDING_LAST4_DOC).get();
  const pending = readPendingEntries(pendingSnapshot.data());
  if (pending.size > 0) {
    const { survivors, merged } = mergePendingLast4(byStudent, pending, now);
    if (survivors.size !== pending.size) {
      await db.doc(PENDING_LAST4_DOC).set(
        {
          version: 1,
          entries: Object.fromEntries(
            [...survivors].map(([id, entry]) => [
              id,
              {
                last4: entry.last4,
                studentIds: entry.studentIds,
                addedAt: entry.addedAt === null ? null : Timestamp.fromDate(entry.addedAt),
              },
            ]),
          ),
        },
        // A replace, not a merge: an entry the prune dropped has to actually
        // leave, and a merge would write it straight back.
        { merge: false },
      );
    }
    options.logger?.info('Folded self-registrations into the kiosk phone index', {
      merged,
      pruned: pending.size - survivors.size,
    });
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

  /*
   * Both channels, and inside the builder rather than at its call sites: only
   * the builder knows the document actually changed (a call-site bump after a
   * build that threw would signal a change that never happened), and any
   * future caller gets the signal for free. `roster` too, because this sweep
   * just refreshed the backend people the kiosk's roster read serves — the
   * kiosks fold in a fresh copy each morning instead of waiting out a TTL.
   */
  await bumpPulse(db, ['phones', 'roster'], now, { logger: options.logger });

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
