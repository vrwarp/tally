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
import { findEventIcon } from '../generated/eventIcons.js';
import { kioskPalette, type KioskGround, type KioskPalette } from '../generated/kioskTheme.js';
import type { LabelTemplate } from '../generated/labelTemplate.js';
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
  /**
   * The chain whose past instances describe who comes to this, or null when
   * nothing does.
   *
   * Deliberately not `chain`, and the two differ exactly where it matters. A
   * recurring gathering reads its own chain. A one-off has no chain of its own
   * to read, so it reads the one a leader pointed it at — `predictFromChain` —
   * and nothing at all when they pointed it at nothing. That is
   * `predictionChain` in `src/lib/gatherings.ts`, and the kiosk has to agree
   * with it or the lobby screen and the check-in screen answer "who belongs to
   * this gathering" differently about the same evening.
   *
   * `chain` stays what it was: the identity `materializeOccurrence` takes.
   */
  predictsFrom: string | null;
  /** The document id, or null for a projected occurrence nothing stands for. */
  id: string | null;
  title: string;
  startAt: number;
  endAt: number;
  checkInOpensAt: number;
  checkInClosesAt: number;
  seriesId: string | null;
  location: string | null;
  /**
   * Whether this gathering hands children back.
   *
   * The one per-event flag the kiosk is told about. It never reads an event
   * document — everything it knows arrives on this row and is persisted into
   * the binding — so a behaviour flag has to be carried here or the lobby
   * screen cannot honour it.
   */
  requiresCheckOut: boolean;
  /**
   * What to print when a child is checked in here, or null for nothing.
   *
   * Here for the same reason `requiresCheckOut` is, one step further: the kiosk
   * never reads an event document, so a template that is not on this row is a
   * template the lobby screen cannot print. It goes into the binding and is
   * read from there for the rest of the evening.
   */
  labelTemplate: LabelTemplate | null;
  /**
   * Whether the registration wizard should ask about allergies.
   *
   * True exactly when the church's people backend can carry the answer — the
   * same write-back test the retired phone form used, asked at bind time
   * instead of code-validation time. On this row for the reason everything
   * else is: the kiosk never reads config, so a capability that is not on the
   * row is a question the wizard cannot know whether to ask. Asking without
   * knowing would be worse than not asking — a family's medical note typed
   * into a screen that silently drops it.
   *
   * Not per-gathering in any real sense (every row in one answer carries the
   * same value), but carried per-row because the binding persists a row, not
   * an answer.
   */
  allergiesSupported: boolean;
  /**
   * The look this gathering lends the screen, already worked out.
   *
   * Absent on a gathering nobody themed, which is most of them — the ordinary
   * case adds nothing to this payload.
   *
   * Resolved *here*, and that is the whole point of it being here. The event
   * stores four names (`{ ground, accent, confirm, backdrop }`); turning those
   * into colours means OKLCH, a hue rotation and a gamut search, and the kiosk
   * is a screen on a shelf running on whatever hardware the church had spare.
   * So it happens on the way out, the same way occurrence projection does and
   * for the same reason: the kiosk never reads an event document, and what it
   * cannot compute cheaply it should simply be told. What lands on the row is
   * finished hex, which the lobby screen validates and hands to `setProperty`.
   *
   * `scripts/check-kiosk-budget.mjs` fails the build if `lib/kioskTheme` ever
   * turns up in the kiosk's own graph, because the saving here is bytes at
   * first paint and it would vanish silently.
   */
  ground?: KioskGround;
  /** `--color-ink-950` → `#0e0406`, and only the slots that actually moved. */
  palette?: KioskPalette;
  /**
   * The gathering's icon, already looked up: SVG path data on Material's
   * `0 -960 960 960` viewBox, or absent for a gathering nobody gave one.
   *
   * The *path*, not the name, for the same reason `palette` is hex rather than
   * four hue names. The catalogue is sixty kilobytes of path data for a hundred
   * and nine glyphs (`generated/eventIcons.ts`), the kiosk needs exactly one of
   * them per gathering, and its first-paint budget is the tightest number in the
   * repo — so the lookup happens here, where the list already has to exist, and
   * what lands on the row is the one string the lobby screen will draw.
   *
   * A name the catalogue no longer holds resolves to nothing at all rather than
   * to a substitute, which is `findEventIcon`'s own rule: a gathering whose icon
   * was dropped should look like one that never had an icon, not like one
   * wearing somebody else's.
   */
  iconPath?: string;
}

export const DEFAULT_KIOSK_EVENT_DAYS = 7;
const MAX_KIOSK_EVENT_DAYS = 30;

export function clampKioskEventDays(days: unknown): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_KIOSK_EVENT_DAYS;
  return Math.max(1, Math.min(MAX_KIOSK_EVENT_DAYS, Math.floor(days)));
}

/**
 * `predictionChain`, over what a stored document holds.
 *
 * Read off the raw data rather than off `OccurrenceSource`, which does not
 * carry `predictFromChain` — it is a roster concern and the projection has
 * never needed it. Only the document path can produce a one-off anyway:
 * `projectOccurrences` expands recurrence rules, and a one-off has none.
 */
function predictsFromOf(
  source: OccurrenceSource,
  data: Record<string, unknown> | null,
): string | null {
  if (source.mode !== 'oneoff') return chainKey(source);
  const named = data?.predictFromChain;
  return typeof named === 'string' && named.length > 0 ? named : null;
}

/**
 * The two theme keys, or neither.
 *
 * Spread rather than assigned so an unthemed gathering — nearly all of them —
 * carries no `ground` and no `palette` at all rather than a pair of nulls. The
 * chooser can list a month of evenings, and this is the difference between the
 * common case costing nothing and costing two keys a row.
 */
function kioskLook(
  theme: OccurrenceSource['kioskTheme'],
): { ground?: KioskGround; palette?: KioskPalette } {
  if (!theme) return {};
  const palette = kioskPalette(theme);
  // A gathering can theme its ground and leave every hue alone, which is a real
  // answer and not an unthemed one: `data-theme` still has to move.
  return palette ? { ground: theme.ground, palette } : { ground: theme.ground };
}

/**
 * The icon, or nothing at all.
 *
 * Spread like `kioskLook`, and for the same reason: most gatherings have no
 * icon, and the common case should not pay a key for saying so.
 */
function kioskIcon(name: string | null): { iconPath?: string } {
  const icon = findEventIcon(name);
  return icon ? { iconPath: icon.path } : {};
}

function entryFromSource(
  source: OccurrenceSource,
  data: Record<string, unknown> | null,
  allergiesSupported: boolean,
): KioskEventEntry {
  return {
    chain: chainKey(source),
    predictsFrom: predictsFromOf(source, data),
    id: source.id,
    title: source.title,
    startAt: source.startAt.getTime(),
    endAt: source.endAt.getTime(),
    checkInOpensAt: source.checkInOpensAt.getTime(),
    checkInClosesAt: source.checkInClosesAt.getTime(),
    seriesId: source.seriesId,
    location: source.location,
    requiresCheckOut: source.requiresCheckOut,
    labelTemplate: source.labelTemplate,
    allergiesSupported,
    ...kioskIcon(source.icon),
    ...kioskLook(source.kioskTheme),
  };
}

/** Mirrors `bindingIsLive` in src/kiosk/binding.ts — keep the two together. */
function offeredUntil(endAt: Date, checkInClosesAt: Date): number {
  return Math.max(endAt.getTime(), checkInClosesAt.getTime());
}

/**
 * Every gathering between now and the horizon, materialised or not, cancelled
 * ones left out — a cancelled night is never offered to a shelf in a lobby.
 *
 * "Between now and the horizon" keeps a gathering that is already running:
 * anything whose end is still ahead is offered, because the kiosk being set up
 * at 19:10 for the 19:00 Friday is the ordinary case, not the edge.
 *
 * It also keeps one that has *finished* but whose check-in window has not, for
 * the same span `bindingIsLive` uses. Without it a kiosk that reboots during
 * pickup could not get back to the gathering it was collecting for: it would
 * sit at an empty chooser while a queue formed in the lobby. The chooser
 * labels these rather than letting them look upcoming.
 */
export async function listKioskEvents(
  db: FirestoreLike,
  now: Date,
  logger: FunctionLogger,
  options: { days?: number; allergiesSupported?: boolean } = {},
): Promise<KioskEventEntry[]> {
  const allergiesSupported = options.allergiesSupported === true;
  const days = clampKioskEventDays(options.days);
  const horizon = new Date(now.getTime() + days * 86_400_000);

  const snapshot = await db.collection(EVENTS).get();
  const sources: OccurrenceSource[] = [];
  // Kept alongside, for the one field the projection's shape does not carry.
  const stored = new Map<string, Record<string, unknown>>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    const source = toSource(doc.id, data);
    if (!source) {
      logger.warn('Skipping an event with no usable schedule', { id: doc.id });
      continue;
    }
    sources.push(source);
    stored.set(doc.id, data);
  }

  const entries: KioskEventEntry[] = [];

  for (const source of sources) {
    if (source.status === 'cancelled') continue;
    if (offeredUntil(source.endAt, source.checkInClosesAt) <= now.getTime()) continue;
    if (source.startAt.getTime() > horizon.getTime()) continue;
    entries.push(entryFromSource(source, stored.get(source.id) ?? null, allergiesSupported));
  }

  // The projection needs the *whole* window of sources — chains are templated
  // from their latest live instance, however old — so it gets `sources`, not
  // the filtered list above. It only ever returns occurrences no document
  // covers, so the two sets cannot overlap.
  for (const occurrence of projectOccurrences(sources, now, { horizonDays: days })) {
    if (offeredUntil(occurrence.endAt, occurrence.checkInClosesAt) <= now.getTime()) continue;
    entries.push({
      chain: chainKey(occurrence.source),
      // A projection expands a recurrence rule, so it is never a one-off and
      // its chain always predicts for it.
      predictsFrom: chainKey(occurrence.source),
      id: null,
      title: occurrence.source.title,
      startAt: occurrence.startAt.getTime(),
      endAt: occurrence.endAt.getTime(),
      checkInOpensAt: occurrence.checkInOpensAt.getTime(),
      checkInClosesAt: occurrence.checkInClosesAt.getTime(),
      seriesId: occurrence.source.seriesId,
      location: occurrence.source.location,
      requiresCheckOut: occurrence.source.requiresCheckOut,
      labelTemplate: occurrence.source.labelTemplate,
      allergiesSupported,
      ...kioskLook(occurrence.source.kioskTheme),
    });
  }

  return entries.sort((a, b) => a.startAt - b.startAt);
}
