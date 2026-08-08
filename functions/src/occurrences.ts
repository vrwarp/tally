/**
 * Writing down one gathering that a recurrence rule describes.
 *
 * The calendar Tally shows is computed, not stored: a rule says when the
 * ministry meets, and the app projects that into the gatherings a leader
 * scrolls (see `./generated/materialize.js`). A document only comes into
 * existence when somebody does something to one of those nights — checks a
 * student in, cancels it, moves it, edits it. This is the code that brings it
 * into existence.
 *
 * It lives on a server rather than in the security rules, and the reason is the
 * one the rules cannot express. Check-in is a counselor's job; creating events
 * is the core team's (`allow create, update: if isCore()`). Rules have no loops,
 * so they cannot expand a recurrence and check that some date is genuinely an
 * occurrence of it — a counselor-writable `events` collection would let anyone
 * invent a gathering on any date, including a backdated one, and file
 * attendance under it.
 *
 * So the client asks, and the server derives. The request carries a chain and a
 * start time and *nothing else*: the id comes from `occurrenceId`, the payload
 * comes from the chain's own template, and both are refused outright unless the
 * projection agrees that the occurrence exists. This cannot bring into being a
 * gathering no rule already described, which is what makes it safe to let any
 * active member call it.
 *
 * The projection is not reimplemented here. `./generated/materialize.js` is a
 * mechanical copy of the module the app uses, kept honest by a test — see
 * `scripts/sync-functions-shared.mjs`. This file is only the parts that differ
 * on a server: reading the collection, decoding admin `Timestamp`s, and writing.
 */
import { sanitizeKioskTheme } from './generated/kioskTheme.js';
import { sanitizeLabelTemplate } from './generated/labelTemplate.js';
import {
  chainKey,
  findProjectedOccurrence,
  occurrenceId,
  type ProjectedOccurrence,
  type OccurrenceSource,
} from './generated/materialize.js';
import {
  isRecurrenceFrequency,
  normalizeRecurrence,
  type RecurrenceRule,
} from './generated/recurrenceCore.js';
import { toDateOrNull, type FirestoreLike, type FunctionLogger } from './firestore.js';

export const EVENTS = 'events';

/**
 * Where the ministry is, as an IANA timezone.
 *
 * Load-bearing, not decoration. Every date in the projection is built with the
 * local-time `Date` constructor so a rule means the same wall-clock evening
 * across a DST boundary — but a Cloud Functions container runs in UTC, where
 * "19:00 Friday" would be read as a Friday lunchtime in Hayward, and would land
 * on the wrong calendar day either side of a clock change. The entry point sets
 * `process.env.TZ` from this before the projection runs.
 *
 * A constant rather than a deploy-time parameter: this is one ministry in
 * one place, and a setting nobody will ever change is a setting that can be
 * wrong in an environment nobody thought to check.
 */
export const MINISTRY_TIME_ZONE = 'America/Los_Angeles';

/**
 * How far back to bother reading.
 *
 * Each chain is projected from its most recent live instance, so history older
 * than that is dead weight — but the window has to be wide enough to still find
 * one for a ministry that took a summer off. A year is generous and still a few
 * hundred documents at most.
 */
const LOOKBACK_DAYS = 365;

/** Firestore rejects a create on an existing document with this status. */
function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

function toRecurrence(value: unknown, anchor: Date): RecurrenceRule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  // `daily` was once a frequency of its own; it means every weekday of a weekly
  // rule. Mirrors `toRecurrence` in the app's converters.
  const legacyDaily = raw.frequency === 'daily';
  if (!legacyDaily && !isRecurrenceFrequency(raw.frequency)) return null;
  const frequency = legacyDaily ? 'weekly' : (raw.frequency as RecurrenceRule['frequency']);

  return normalizeRecurrence(
    {
      frequency,
      interval: legacyDaily ? 1 : typeof raw.interval === 'number' ? raw.interval : 1,
      weekdays: legacyDaily
        ? [0, 1, 2, 3, 4, 5, 6]
        : Array.isArray(raw.weekdays)
          ? (raw.weekdays as number[])
          : [],
      monthlyMode: raw.monthlyMode === 'dayOfWeek' ? 'dayOfWeek' : 'dayOfMonth',
      until: typeof raw.until === 'string' ? raw.until : null,
      count: typeof raw.count === 'number' && Number.isFinite(raw.count) ? raw.count : null,
    },
    anchor,
  );
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * A stored event as the projection wants it, or null when it is unusable.
 *
 * Deliberately strict about the four timestamps: a chain projected from a
 * document with a missing start would put gatherings at the epoch, and the
 * security rules already require all four, so anything without them is
 * corruption rather than an older shape.
 */
export function toSource(id: string, data: Record<string, unknown>): OccurrenceSource | null {
  const startAt = toDateOrNull(data.startAt);
  const endAt = toDateOrNull(data.endAt);
  const checkInOpensAt = toDateOrNull(data.checkInOpensAt);
  const checkInClosesAt = toDateOrNull(data.checkInClosesAt);
  if (!startAt || !endAt || !checkInOpensAt || !checkInClosesAt) return null;

  const mode = data.mode === 'oneoff' ? 'oneoff' : 'recurring';

  return {
    id,
    title: typeof data.title === 'string' ? data.title : 'Untitled event',
    description: str(data.description),
    // Not checked against the catalogue here, unlike the app: the icon
    // catalogue is a client concern and the server would only be copying a list
    // it has no other use for. An unknown name is dropped on read instead.
    icon: str(data.icon),
    mode,
    seriesId: str(data.seriesId),
    recurrence: mode === 'recurring' ? toRecurrence(data.recurrence, startAt) : null,
    recurrenceRootId: str(data.recurrenceRootId),
    status: data.status === 'cancelled' ? 'cancelled' : 'scheduled',
    startAt,
    endAt,
    checkInOpensAt,
    checkInClosesAt,
    location: str(data.location),
    notes: str(data.notes),
    requiresCheckOut: data.requiresCheckOut === true,
    labelTemplate: sanitizeLabelTemplate(data.labelTemplate),
    kioskTheme: sanitizeKioskTheme(data.kioskTheme),
  };
}

/**
 * The document, derived entirely from the chain's template.
 *
 * `createdBy` is the caller, unlike the nightly sweep this replaced: somebody
 * standing at a door did press something, and attributing it to them is the
 * truth. What they pressed did not decide any of the rest of this.
 */
function payloadFor(
  occurrence: ProjectedOccurrence,
  uid: string,
  now: Date,
): Record<string, unknown> {
  const { source } = occurrence;

  return {
    title: source.title,
    description: source.description,
    icon: source.icon,
    mode: 'recurring',
    seriesId: source.seriesId,
    recurrence: source.recurrence,
    // The chain's root, resolved once so every instance carries the same one
    // and the derived ids stay stable.
    recurrenceRootId: source.recurrenceRootId ?? source.id,
    startAt: occurrence.startAt,
    endAt: occurrence.endAt,
    checkInOpensAt: occurrence.checkInOpensAt,
    checkInClosesAt: occurrence.checkInClosesAt,
    location: source.location,
    notes: source.notes,
    requiresRsvp: false,
    // Inherited, unlike `requiresRsvp`: a room children are collected from is
    // precisely the kind of gathering that repeats, and materialising one must
    // not quietly turn it into an ordinary roster. Mirrors `asEvent` in
    // src/lib/eventProjection.ts.
    requiresCheckOut: source.requiresCheckOut,
    // Inherited for the same reason: materialising the Sunday a kiosk is being
    // bound to must not be what stops its labels printing.
    labelTemplate: source.labelTemplate,
    // And the look, so materialising the Sunday a kiosk is being bound to is
    // not what sends the lobby screen back to navy.
    kioskTheme: source.kioskTheme,
    status: 'scheduled',
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
  };
}

export interface MaterializeOptions {
  horizonDays?: number;
  lookbackDays?: number;
}

export interface MaterializeResult {
  /** The document id, which is the one the caller was already showing. */
  id: string;
  /** False when somebody else — another counselor's tap — got there first. */
  created: boolean;
}

/**
 * Brings one projected occurrence into existence.
 *
 * Returns null when the request does not describe a gathering the rules put on
 * the calendar: an unknown chain, a date the rule skips, something past the
 * horizon. The caller turns that into a refusal.
 *
 * The whole collection is read rather than queried: the projection needs both
 * the latest live instance of every chain *and* every id already spoken for,
 * which is two queries and a merge, against a collection this ministry measures
 * in hundreds.
 */
export async function materializeOccurrence(
  firestore: FirestoreLike,
  request: { chain: string; startAt: Date; uid: string },
  now: Date,
  logger: FunctionLogger,
  options: MaterializeOptions = {},
): Promise<MaterializeResult | null> {
  const snapshot = await firestore.collection(EVENTS).get();
  const since = new Date(now.getTime() - (options.lookbackDays ?? LOOKBACK_DAYS) * 86_400_000);

  const sources: OccurrenceSource[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    const source = toSource(doc.id, data);
    // Old instances are dropped *after* decoding, so a malformed document is
    // still reported rather than silently filtered by its date.
    if (!source) {
      logger.warn('Skipping an event with no usable schedule', { id: doc.id });
      continue;
    }
    if (source.startAt >= since) sources.push(source);
  }

  /*
   * Already a document, which is a success and not a collision.
   *
   * The projection stops offering a night the moment something stands for it,
   * so the check below would refuse one that already exists — and the client
   * calls this as "make sure it exists", from a screen that may have been
   * holding a stale copy since before another device materialised it. Answering
   * with the id it asked about is the only reading of that request that does
   * not break a check-in for the second counselor through the door.
   */
  const derived = occurrenceId(request.chain, request.startAt);
  if ((await firestore.doc(`${EVENTS}/${derived}`).get()).exists) {
    return { id: derived, created: false };
  }

  const occurrence = findProjectedOccurrence(sources, request.chain, request.startAt, now, options);
  if (!occurrence) return null;

  try {
    await firestore
      .doc(`${EVENTS}/${occurrence.id}`)
      .create(payloadFor(occurrence, request.uid, now));
  } catch (error) {
    // Two counselors tapped at once, or one tapped twice. The id is derived, so
    // they addressed the same document and it already says what this would have
    // said. Existing means finished.
    if (isAlreadyExists(error)) return { id: occurrence.id, created: false };
    throw error;
  }

  logger.info('Materialised an occurrence', { id: occurrence.id, chain: request.chain });
  return { id: occurrence.id, created: true };
}

/* -------------------------------------------------------------------------- */
/* The one-time migration                                                      */
/* -------------------------------------------------------------------------- */

export interface PruneResult {
  /** Gatherings removed, or that would be with `apply`. */
  pruned: string[];
  /** Ones left standing because somebody was checked in. */
  attended: string[];
  /** Ones left standing because deleting them would strand their chain. */
  retained: string[];
}

/**
 * Clears out the calendar Tally used to write ahead of time.
 *
 * Until the calendar became a projection, the app and a nightly sweep wrote the
 * next two months of every chain down as documents. Those are not wrong — each
 * one shadows exactly the occurrence the projection would have produced, and
 * renders identically — but they are inert: a leader who changes the schedule
 * finds them still standing, which is the bug the projection exists to make
 * impossible. Run once, and the calendar ahead goes back to being derived.
 *
 * What it refuses to touch, and why:
 *
 * **Anything with attendance.** A gathering somebody attended is history, and
 * removing it would orphan those records — the same veto `EventDetailPage`
 * applies to its own delete button.
 *
 * **Anything a leader shaped.** Only occurrences still carrying the id their own
 * date derives from are candidates. One moved to a different evening keeps the
 * id of the date it was created for, and a cancelled one is a decision that has
 * to outlive this.
 *
 * **The last document in a chain.** The projection is expanded from a chain's
 * most recent live instance, so a chain whose every instance is still ahead —
 * a weekly gathering created last week for next Friday — would be erased
 * entirely rather than pruned. The earliest is kept, and that is the one the
 * rest is projected from.
 *
 * Reports rather than deletes unless `apply` is set. This removes documents on
 * a ministry's live calendar; looking first is cheap.
 */
export async function pruneMaterializedOccurrences(
  firestore: FirestoreLike,
  now: Date,
  logger: FunctionLogger,
  options: { apply?: boolean } = {},
): Promise<PruneResult> {
  const snapshot = await firestore.collection(EVENTS).get();

  const sources: OccurrenceSource[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    const source = toSource(doc.id, data);
    if (source) sources.push(source);
  }

  // Grouped so the last-document-in-a-chain rule can be applied per chain.
  const survivors = new Map<string, number>();
  for (const source of sources) {
    const key = chainKey(source);
    survivors.set(key, (survivors.get(key) ?? 0) + 1);
  }

  const candidates = sources
    .filter(
      (source) =>
        source.mode === 'recurring' &&
        source.recurrence !== null &&
        source.status === 'scheduled' &&
        source.startAt > now &&
        source.id === occurrenceId(chainKey(source), source.startAt),
    )
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const result: PruneResult = { pruned: [], attended: [], retained: [] };

  for (const source of candidates) {
    const key = chainKey(source);

    // Never leave a chain with nothing to project from.
    if ((survivors.get(key) ?? 0) <= 1) {
      result.retained.push(source.id);
      continue;
    }

    const attendance = await firestore.collection(`${EVENTS}/${source.id}/attendance`).get();
    if (attendance.docs.length > 0) {
      result.attended.push(source.id);
      continue;
    }

    if (options.apply) await firestore.doc(`${EVENTS}/${source.id}`).delete();
    survivors.set(key, (survivors.get(key) ?? 1) - 1);
    result.pruned.push(source.id);
  }

  logger.info(options.apply ? 'Pruned pre-materialised occurrences' : 'Prune dry run', {
    pruned: result.pruned.length,
    attended: result.attended.length,
    retained: result.retained.length,
  });

  return result;
}
