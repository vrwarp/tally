/**
 * Which nights of a gathering nobody came to, written down once for everybody.
 *
 * A student's profile shows a year of nights and has to say, for each one,
 * whether the student missed it or whether it never really happened. The second
 * half is not a fact about the student — it is a fact about the gathering — so
 * answering it by reading every night's register meant every profile, on every
 * device, paying to re-derive the same thing. A year across a few gatherings was
 * a few hundred reads to learn a handful of dates.
 *
 * So the handful of dates is what gets stored: one document per repeat chain,
 * listing the nights examined and found empty. Reading it is one document per
 * gathering, and the answer is then the same for everybody who asks.
 *
 * ## Why a watermark
 *
 * A night's absence from `skipped` is not on its own good news — it could mean
 * "somebody came" or it could mean "nobody has ever looked". Those must not be
 * confused, because the first makes a night count against a student and the
 * second is a night we know nothing about. `examinedFrom` is the line between
 * them: at or after it, the list is complete and absence means the night was
 * held; before it, nothing is claimed and a caller has to read the register.
 *
 * ## How it stays true
 *
 * Nothing here is authoritative in the way a register is — it is derived, and it
 * is allowed to be wrong for as long as it takes to notice. Two things fix it,
 * and both are cheap:
 *
 * A night that gains its first check-in is removed from the list at the moment
 * of the tap (`clearSkippedNight`), so a correction to a long-dead night stops
 * it reading as empty. That write is an `arrayRemove`, which is atomic and
 * cannot clobber a concurrent examination.
 *
 * An examination that finds a night held which the list calls skipped removes it
 * too. That is the path that catches attendance arriving by any route that is
 * not a tap — an import, a script, a repair — without those routes having to
 * know this file exists.
 *
 * Adds are `arrayUnion` for the same reason removes are `arrayRemove`: the list
 * is never rewritten wholesale, so a device examining a year cannot undo a
 * correction another device made while it was reading.
 */
import { arrayRemove, arrayUnion, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { isPermissionDenied } from '@/lib/permissionDenied';
import { toDateOrNull } from '@/services/converters';

/** What one chain's document says about its own nights. */
export interface SkippedNights {
  chainKey: string;
  /** Event ids examined and found with nobody checked in. */
  skipped: ReadonlySet<string>;
  /**
   * Every finished night of this chain starting at or after this instant has
   * been examined. Null when the document has never been written, which is the
   * same as claiming nothing.
   */
  examinedFrom: Date | null;
}

/** What a caller can conclude about one night from a chain's document. */
export type NightOutcome = 'held' | 'skipped' | 'unknown';

/**
 * What `registry` knows about `event`.
 *
 * `unknown` is a real answer and the caller has to handle it by reading the
 * night's register. Treating it as `held` is the bug this type exists to stop:
 * it turns a night nobody has looked at into an absence, and absences are what
 * the app phones families about.
 */
export function outcomeOf(
  registry: SkippedNights | undefined,
  event: { id: string; startAt: Date },
): NightOutcome {
  if (!registry?.examinedFrom) return 'unknown';
  if (registry.skipped.has(event.id)) return 'skipped';
  return event.startAt >= registry.examinedFrom ? 'held' : 'unknown';
}

function toSkippedNights(chainKey: string, data: Record<string, unknown> | undefined): SkippedNights {
  const skipped = Array.isArray(data?.skipped)
    ? (data.skipped as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];

  return {
    chainKey,
    skipped: new Set(skipped),
    examinedFrom: toDateOrNull(data?.examinedFrom),
  };
}

/**
 * What a registry read came back with, and what it was refused.
 *
 * Two channels, the same shape as `EventAttendanceRead` and for the same
 * reason. These documents are gated on the gathering — `skippedNights` allows
 * `get` only `if isActive() && onChain(chainKey)` — so a reader who is not on
 * one gathering out of five is refused its registry, and that refusal is a
 * settled fact about them rather than a fault.
 *
 * A refusal must not arrive as an absent entry. Absent means "nobody has
 * examined this chain", which sends the caller off to read the chain's nights
 * one register at a time — every one of which is gated on the same chain and
 * will be refused in turn. The caller has to be able to tell "unknown" from
 * "not yours", so it is told.
 */
export interface SkippedNightsRead {
  byChain: Map<string, SkippedNights>;
  /** Chain keys whose registry the caller may not read. */
  denied: Set<string>;
}

/**
 * Reads the document for each chain, newest state, one read apiece.
 *
 * A chain with no document yet comes back absent rather than empty — absent
 * means "nothing has been examined", and an empty document would mean "examined,
 * nothing skipped", which is the opposite conclusion.
 *
 * Per chain, not per batch. Rejecting the whole read on the first refusal is
 * what this used to do, and it meant one restricted Sunday took down a whole
 * year of every student's history — on a profile that then said "no gatherings
 * on record yet" over a student somebody had checked in that morning. Only a
 * refusal is swallowed; a network failure still rejects, because that is worth
 * retrying and worth saying out loud.
 */
export async function fetchSkippedNights(
  chainKeys: readonly string[],
): Promise<SkippedNightsRead> {
  const unique = [...new Set(chainKeys)];
  const denied = new Set<string>();

  const entries = await Promise.all(
    unique.map(async (chainKey) => {
      try {
        const snapshot = await getDoc(doc(db, paths.skippedNights(chainKey)));
        return snapshot.exists()
          ? ([chainKey, toSkippedNights(chainKey, snapshot.data())] as const)
          : null;
      } catch (cause) {
        if (!isPermissionDenied(cause)) throw cause;
        denied.add(chainKey);
        return null;
      }
    }),
  );

  return {
    byChain: new Map(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)),
    denied,
  };
}

/**
 * Writes down what an examination of one chain found.
 *
 * `examinedFrom` is how far back the caller actually looked — it must be a range
 * the caller covered *completely*, because that completeness is the whole
 * meaning of the watermark. It only ever moves earlier: a screen with a narrow
 * window must not shrink the coverage a wider one established.
 *
 * `held` is passed so the examination can undo its own stale entries. It is
 * normally empty, so the second write normally does not happen.
 */
export async function recordExamination(args: {
  chainKey: string;
  examinedFrom: Date;
  /** Nights found with nobody checked in. */
  skipped: readonly string[];
  /** Nights found with somebody checked in. Only the surprises matter. */
  held: readonly string[];
  /** What the chain's document said before this examination, if anything. */
  known?: SkippedNights | undefined;
}): Promise<void> {
  const { chainKey, examinedFrom, skipped, held, known } = args;

  const reach =
    // Stryker disable next-line EqualityOperator: two watermarks at the same
    // instant are the same watermark, so `<=` picks a different object and
    // writes the same coverage.
    known?.examinedFrom && known.examinedFrom < examinedFrom ? known.examinedFrom : examinedFrom;

  await setDoc(
    doc(db, paths.skippedNights(chainKey)),
    {
      chainKey,
      examinedFrom: reach,
      updatedAt: serverTimestamp(),
      ...(skipped.length > 0 ? { skipped: arrayUnion(...skipped) } : {}),
    },
    { merge: true },
  );

  // Anything the list called empty that has since gained a register. Rare, and
  // worth its own write when it happens: this is the path that catches
  // attendance arriving by a route that never taps a phone.
  const resurrected = held.filter((id) => known?.skipped.has(id));
  if (resurrected.length === 0) return;

  await setDoc(
    doc(db, paths.skippedNights(chainKey)),
    { skipped: arrayRemove(...resurrected), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Forgets one night, because somebody has just been checked into it.
 *
 * Called from the door, so it is deliberately the smallest possible write: one
 * `arrayRemove` against one document, atomic, idempotent, and safe to issue for
 * a night that was never in the list.
 */
export async function clearSkippedNight(chainKey: string, eventId: string): Promise<void> {
  await setDoc(
    doc(db, paths.skippedNights(chainKey)),
    { chainKey, skipped: arrayRemove(eventId), updatedAt: serverTimestamp() },
    { merge: true },
  );
}
