/**
 * Writing down the gatherings a recurrence rule says are coming.
 *
 * A rule describes a schedule; only a document can be checked into, cancelled
 * or counted. Something has to turn one into the other, and doing it at the
 * door is too late — next Friday would be missing from Upcoming all week, and
 * nobody could move it or call it off in advance.
 *
 * The app tops the horizon up whenever a leader has it open, which covers the
 * common case and is instant for an event somebody has only just created. This
 * is the floor underneath that: it runs whether or not anyone opened Tally, so
 * a ministry that goes quiet over the summer still comes back to a calendar.
 *
 * The planning is not reimplemented here. `./generated/materialize.js` is a
 * mechanical copy of the module the app uses, kept honest by a test — see
 * `scripts/sync-functions-shared.mjs`. This file is only the parts that differ
 * on a server: reading the collection, decoding admin `Timestamp`s, and
 * writing.
 */
import {
  pendingOccurrences,
  type OccurrenceDraft,
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
 * How far back to bother reading.
 *
 * Each chain is copied forward from its most recent live instance, so history
 * older than that is dead weight — but the window has to be wide enough to
 * still find one for a ministry that took a summer off. A year is generous and
 * still a few hundred documents at most.
 */
const LOOKBACK_DAYS = 365;

export interface MaterializeResult {
  /** Occurrences written. Zero is the healthy steady state. */
  created: number;
  /** Drafts another writer got to first — the app, or an overlapping run. */
  raced: number;
  /** Chains considered, for the log line. */
  events: number;
}

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
 * A stored event as the planner wants it, or null when it is unusable.
 *
 * Deliberately strict about the four timestamps: an occurrence copied from a
 * document with a missing start would be scheduled at the epoch, and the
 * security rules already require all four, so anything without them is
 * corruption rather than an older shape.
 */
function toSource(id: string, data: Record<string, unknown>): OccurrenceSource | null {
  const startAt = toDateOrNull(data.startAt);
  const endAt = toDateOrNull(data.endAt);
  const checkInOpensAt = toDateOrNull(data.checkInOpensAt);
  const checkInClosesAt = toDateOrNull(data.checkInClosesAt);
  if (!startAt || !endAt || !checkInOpensAt || !checkInClosesAt) return null;

  const mode = data.mode === 'oneoff' ? 'oneoff' : 'recurring';

  return {
    id,
    title: typeof data.title === 'string' ? data.title : 'Untitled event',
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
    defaultGroupingMode: data.defaultGroupingMode === 'smallGroup' ? 'smallGroup' : 'all',
  };
}

function payloadFor(draft: OccurrenceDraft, now: Date): Record<string, unknown> {
  const { source } = draft;

  return {
    title: source.title,
    mode: 'recurring',
    seriesId: source.seriesId,
    recurrence: source.recurrence,
    // The chain's root, resolved once so every instance after the first carries
    // the same one and the derived ids stay stable.
    recurrenceRootId: source.recurrenceRootId ?? source.id,
    startAt: draft.startAt,
    endAt: draft.endAt,
    checkInOpensAt: draft.checkInOpensAt,
    checkInClosesAt: draft.checkInClosesAt,
    location: source.location,
    notes: source.notes,
    requiresRsvp: false,
    requiresWaiver: false,
    requiresPayment: false,
    feeCents: null,
    defaultGroupingMode: source.defaultGroupingMode,
    status: 'scheduled',
    createdAt: now,
    updatedAt: now,
    // Not a uid. The dashboard never shows this, and attributing a scheduled
    // write to whichever leader happened to create the series would be a lie.
    createdBy: 'system:occurrences',
  };
}

export interface MaterializeOptions {
  horizonDays?: number;
  maxPerChain?: number;
  lookbackDays?: number;
}

/**
 * Reads the event collection, works out which occurrences are missing, and
 * creates them.
 *
 * The whole collection is read rather than queried: the planner needs both the
 * latest live instance of every chain *and* every id already spoken for, which
 * is two different queries and a merge, against a collection this ministry
 * measures in hundreds. One read a night is cheaper than the indexes.
 */
export async function materializeDueOccurrences(
  firestore: FirestoreLike,
  now: Date,
  logger: FunctionLogger,
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
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

  const drafts = pendingOccurrences(sources, now, options);

  let created = 0;
  let raced = 0;
  for (const draft of drafts) {
    try {
      await firestore.doc(`${EVENTS}/${draft.id}`).create(payloadFor(draft, now));
      created += 1;
    } catch (error) {
      // Someone else wrote it between the read and now — the app topping up
      // its own horizon, most likely. Existing means finished.
      if (isAlreadyExists(error)) {
        raced += 1;
        continue;
      }
      throw error;
    }
  }

  const result = { created, raced, events: sources.length };
  if (created > 0 || raced > 0) logger.info('Materialised occurrences', result);
  return result;
}
