/**
 * The gatherings a kiosk may be bound to.
 *
 * A kiosk asks "what could I be for, this week?" and gets back the same
 * calendar the app shows: the documents that exist, plus the occurrences the
 * recurrence rules describe that nothing stands for yet. The projection is the
 * server's own (`generated/materialize.js`) — the kiosk bundle carries none of
 * it, which is the point of answering this on the server at all.
 *
 * A projected entry has no document and therefore no id; it carries its chain
 * and start time instead, which is exactly what `materializeOccurrence` takes.
 * The kiosk binds by materialising first, so by the time anything is written
 * the gathering is as real as any other.
 */
import type { FirestoreLike, FunctionLogger } from '../firestore.js';
import {
  chainKey,
  projectOccurrences,
  type OccurrenceSource,
} from '../generated/materialize.js';
import { EVENTS, toSource } from '../occurrences.js';

/** One row of the kiosk's event chooser. Times are epoch millis. */
export interface KioskEventEntry {
  /** The repeat chain, or the event's own id for a one-off. */
  chain: string;
  /** The document id, or null for a projected occurrence nothing stands for. */
  id: string | null;
  title: string;
  startAt: number;
  endAt: number;
  checkInOpensAt: number;
  checkInClosesAt: number;
  seriesId: string | null;
  location: string | null;
}

export const DEFAULT_KIOSK_EVENT_DAYS = 7;
const MAX_KIOSK_EVENT_DAYS = 30;

export function clampKioskEventDays(days: unknown): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_KIOSK_EVENT_DAYS;
  return Math.max(1, Math.min(MAX_KIOSK_EVENT_DAYS, Math.floor(days)));
}

function entryFromSource(source: OccurrenceSource): KioskEventEntry {
  return {
    chain: chainKey(source),
    id: source.id,
    title: source.title,
    startAt: source.startAt.getTime(),
    endAt: source.endAt.getTime(),
    checkInOpensAt: source.checkInOpensAt.getTime(),
    checkInClosesAt: source.checkInClosesAt.getTime(),
    seriesId: source.seriesId,
    location: source.location,
  };
}

/**
 * Every gathering between now and the horizon, materialised or not, cancelled
 * ones left out — a cancelled night is never offered to a shelf in a lobby.
 *
 * "Between now and the horizon" keeps a gathering that is already running:
 * anything whose end is still ahead is offered, because the kiosk being set up
 * at 19:10 for the 19:00 Friday is the ordinary case, not the edge.
 */
export async function listKioskEvents(
  db: FirestoreLike,
  now: Date,
  logger: FunctionLogger,
  options: { days?: number } = {},
): Promise<KioskEventEntry[]> {
  const days = clampKioskEventDays(options.days);
  const horizon = new Date(now.getTime() + days * 86_400_000);

  const snapshot = await db.collection(EVENTS).get();
  const sources: OccurrenceSource[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    const source = toSource(doc.id, data);
    if (!source) {
      logger.warn('Skipping an event with no usable schedule', { id: doc.id });
      continue;
    }
    sources.push(source);
  }

  const entries: KioskEventEntry[] = [];

  for (const source of sources) {
    if (source.status === 'cancelled') continue;
    if (source.endAt.getTime() <= now.getTime()) continue;
    if (source.startAt.getTime() > horizon.getTime()) continue;
    entries.push(entryFromSource(source));
  }

  // The projection needs the *whole* window of sources — chains are templated
  // from their latest live instance, however old — so it gets `sources`, not
  // the filtered list above. It only ever returns occurrences no document
  // covers, so the two sets cannot overlap.
  for (const occurrence of projectOccurrences(sources, now, { horizonDays: days })) {
    if (occurrence.endAt.getTime() <= now.getTime()) continue;
    entries.push({
      chain: chainKey(occurrence.source),
      id: null,
      title: occurrence.source.title,
      startAt: occurrence.startAt.getTime(),
      endAt: occurrence.endAt.getTime(),
      checkInOpensAt: occurrence.checkInOpensAt.getTime(),
      checkInClosesAt: occurrence.checkInClosesAt.getTime(),
      seriesId: occurrence.source.seriesId,
      location: occurrence.source.location,
    });
  }

  return entries.sort((a, b) => a.startAt - b.startAt);
}
