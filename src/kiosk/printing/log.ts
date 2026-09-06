/**
 * What happened to the printer, written down.
 *
 * Until this existed the kiosk kept no record at all: no console output, no
 * log, nothing handed to the library's diagnostics. So when the printer screen
 * said *The printer was unplugged* with the cable still in, the reason —
 * a `NetworkError` on a bulk transfer, a `NotFoundError` from a device that
 * really did leave the bus, an empty device list after the nightly reload —
 * was gone before anybody could ask. This is the record: a bounded ring of
 * events, persisted so it survives the reload it partly exists to explain,
 * and readable from the printer screen behind a fold.
 *
 * Two rules keep it safe on a device that sits in a lobby for weeks.
 *
 * **It holds no names.** Callers pass error names, device identity (vendor,
 * product, whether there is a serial — never the serial itself) and state
 * transitions. A label's job — a child's name and the words on their sticker —
 * never reaches `record`, and `sanitizeData` refuses anything that is not a
 * primitive, so nothing can smuggle one in as a nested object either.
 *
 * **It is bounded.** {@link PRINTER_LOG_CAPACITY} entries, oldest dropped
 * first, and the library's per-chunk chatter is filtered out before it gets
 * here (see {@link isNoise}), so an evening of three hundred labels is a few
 * dozen lines rather than thousands.
 *
 * Pure apart from localStorage, and testable without a printer, a transport or
 * a worker — which is why it is not in `index.ts`.
 */
import { KIOSK_KEYS, readJson, writeJson } from '../storage';

export type PrinterLogValue = string | number | boolean;

export interface PrinterLogEntry {
  /** When, as a Unix millisecond timestamp. */
  t: number;
  /**
   * Who reported it. The library uses `transport` and `printer`; the kiosk's
   * own entries are `usb` (the browser's device events and lists), `kiosk`
   * (what this module did), `state` (what the screens were told) and `page`
   * (visibility and unload).
   */
  category: string;
  name: string;
  data?: Record<string, PrinterLogValue>;
}

export interface PrinterLog {
  record(category: string, name: string, data?: Record<string, unknown>): void;
  /** Every entry, oldest first. */
  entries(): readonly PrinterLogEntry[];
  /** The whole log as text, one line per entry, for a bug report. */
  text(): string;
}

/** How many events are kept. Enough for a week of quiet and one bad evening. */
export const PRINTER_LOG_CAPACITY = 200;

/** Bumped when the stored shape changes; an older log is simply dropped. */
export const PRINTER_LOG_VERSION = 1;

/** Longest a string value is kept, so an error message cannot fill the ring. */
export const MAX_VALUE_LENGTH = 160;

/**
 * The library's events that say a working printer is working.
 *
 * Every chunk written and every status packet's hex is what a logic analyser
 * wants and what a lobby log cannot afford: a single label is a dozen of them.
 * What is kept is everything that is *not* the ordinary shape of a label going
 * out — opens, claims, stalls, resyncs, timeouts, errors, disconnects.
 */
/* Stryker disable all: a module-level constant is a *static* mutant — evaluated
   once when the module loads, before Stryker can activate the mutant for any one
   test — so a change here reports as survived whatever the tests say. The set's
   contents are asserted outright in `log.test.ts`. */
const NOISE = new Set([
  'write-chunk',
  'status-packet',
  'write-start',
  'write-done',
  'send-start',
  'page-completed',
  'job-done',
]);
/* Stryker restore all */

export function isNoise(name: string): boolean {
  return NOISE.has(name);
}

/**
 * Only primitives, only so long.
 *
 * `undefined` when nothing survives, so an entry with nothing to say carries no
 * `data` key at all rather than an empty object.
 */
export function sanitizeData(
  data: Record<string, unknown> | undefined,
): Record<string, PrinterLogValue> | undefined {
  if (!data) return undefined;
  const clean: Record<string, PrinterLogValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      clean[key] = value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
    } else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length === 0 ? undefined : clean;
}

interface StoredLog {
  version: number;
  entries: PrinterLogEntry[];
}

/** An entry as it should be, or nothing — a corrupt row must not take the rest down. */
function asEntry(value: unknown): PrinterLogEntry | null {
  const row = value as Partial<PrinterLogEntry> | null | undefined;
  if (
    typeof row?.t !== 'number' ||
    !Number.isFinite(row.t) ||
    typeof row.category !== 'string' ||
    typeof row.name !== 'string'
  ) {
    return null;
  }
  const data = sanitizeData(
    typeof row.data === 'object' && row.data !== null ? row.data : undefined,
  );
  return data ? { t: row.t, category: row.category, name: row.name, data } : {
    t: row.t,
    category: row.category,
    name: row.name,
  };
}

function restore(capacity: number): PrinterLogEntry[] {
  const stored = readJson<Partial<StoredLog>>(KIOSK_KEYS.printerLog);
  if (stored?.version !== PRINTER_LOG_VERSION || !Array.isArray(stored.entries)) return [];
  const entries: PrinterLogEntry[] = [];
  for (const row of stored.entries) {
    const entry = asEntry(row);
    if (entry) entries.push(entry);
  }
  return entries.slice(-capacity);
}

/** Strings quoted, so a message with spaces in it stays one value; numbers and booleans as they are. */
function formatValue(value: PrinterLogValue): string {
  return JSON.stringify(value);
}

/** The category and name, then `key=value` pairs — the line without its time. */
export function describeEntry(entry: PrinterLogEntry): string {
  const pairs = entry.data
    ? Object.entries(entry.data).map(([key, value]) => ` ${key}=${formatValue(value)}`)
    : [];
  return `${entry.category} ${entry.name}${pairs.join('')}`;
}

/** One entry as a line for a bug report: an ISO timestamp, then {@link describeEntry}. */
export function formatEntry(entry: PrinterLogEntry): string {
  return `${new Date(entry.t).toISOString()} ${describeEntry(entry)}`;
}

/**
 * How long ago, in the words a volunteer reads at arm's length.
 *
 * Coarse on purpose: the fold is for seeing that the printer went quiet "3 min
 * ago" rather than for timing anything, which is what `text()` is for.
 */
export function describeAge(t: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function createPrinterLog(
  options: { capacity?: number; now?: () => number } = {},
): PrinterLog {
  const capacity = options.capacity ?? PRINTER_LOG_CAPACITY;
  const now = options.now ?? (() => Date.now());
  const entries = restore(capacity);

  function persist(): void {
    const stored: StoredLog = { version: PRINTER_LOG_VERSION, entries };
    writeJson(KIOSK_KEYS.printerLog, stored);
  }

  return {
    record(category, name, data) {
      const clean = sanitizeData(data);
      entries.push(clean ? { t: now(), category, name, data: clean } : { t: now(), category, name });
      while (entries.length > capacity) entries.shift();
      // Written on every record rather than debounced: after the noise filter
      // an evening is a few dozen of these, and the entry most worth keeping is
      // the one written just before the page went away.
      persist();
    },

    entries() {
      return entries;
    },

    text() {
      return entries.map(formatEntry).join('\n');
    },
  };
}
