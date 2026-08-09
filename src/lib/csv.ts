/**
 * CSV serialisation, for the core team's spreadsheet exports.
 *
 * Tally's screens each answer one question and stop there. The questions that
 * fall outside them all end in a spreadsheet — the figure the elders want in
 * June, the twenty-two names four leaders are dividing between them — and this
 * is the seam where the app hands its rows over and lets a spreadsheet do the
 * pivoting it refuses to grow screens for.
 *
 * Deliberately pure, and deliberately DOM-free: `download.ts` is the half that
 * touches a `Blob`, so this module can be unit- and fuzz-tested in node the way
 * the rest of `src/lib` is.
 *
 * Two rules that are not obvious and are load-bearing:
 *
 *   - **Neutralisation is decided by the source type, not by the rendered
 *     string.** A cell opening `=`, `+`, `-` or `@` executes when the file is
 *     opened, and Tally has real vectors for it — `notes` is free text a
 *     counselor typed, and names come from a church office anybody can edit. But
 *     guarding the *rendered* string would turn every negative number into text,
 *     so a `number` bypasses the guard entirely and a `string` never does. That
 *     is why `CsvValue` distinguishes them rather than taking `string` throughout.
 *
 *   - **Never `toISOString()`.** Every formatter in `lib/time.ts` is device-local,
 *     so a Friday 19:00 gathering rendered in UTC would carry a Saturday date and
 *     the file would disagree with the screen it came from. Both renderers here
 *     are local, and the instant one carries its offset.
 *
 * SHARED WITH NOTHING. Keep this module leaf-level: `src/kiosk/` imports eight
 * modules out of `src/lib`, and the kiosk's byte budget
 * (`scripts/check-kiosk-budget.mjs`) covers the whole reachable graph. Nothing
 * the kiosk imports may ever import this.
 */
import { format } from 'date-fns';

/**
 * What a column may yield.
 *
 * `string` is guarded against formula injection; `number` deliberately is not.
 * See the module docstring — this distinction is the whole reason the union is
 * not just `string`.
 */
export type CsvValue = string | number | boolean | Date | null | undefined;

export interface CsvColumn<T> {
  /** snake_case and machine-readable, never a display label. */
  header: string;
  value: (row: T) => CsvValue;
}

export interface CsvOptions {
  /**
   * Default `'\r\n'`. RFC 4180 specifies CRLF, and older Excel-for-Mac imports
   * need it; overridable so tests read cleanly.
   */
  eol?: '\r\n' | '\n';
}

/**
 * The characters that make a leading position dangerous.
 *
 * `=` `+` `-` `@` are the four every spreadsheet treats as the start of a
 * formula. TAB and CR are here because Excel strips them and then evaluates
 * whatever was behind them.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** RFC 4180 says quote for these; the space cases are for readers that trim. */
const MUST_QUOTE = /["\r\n,]/;

function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * One value, encoded.
 *
 * Exported for the fuzz test, which needs to state the neutralisation inside
 * its round-trip expectation — a naive "output parses back to input" property
 * fails on the first `=`.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';

  // Numbers and booleans are rendered, never guarded: a spreadsheet has to be
  // able to SUM a column of counts, and `-3` must stay `-3`.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Date) return isoDateTime(value);

  const text = value;
  if (text === '') return '';

  if (FORMULA_LEAD.test(text)) {
    // Excel consumes the apostrophe; Sheets renders it. That is the accepted
    // cost of not shipping a file that runs a formula somebody typed into a
    // student's notes.
    return quote(`'${text}`);
  }

  // Leading and trailing spaces survive a reader that trims only when quoted.
  if (MUST_QUOTE.test(text) || text !== text.trim()) return quote(text);
  return text;
}

export function toCsv<T>(
  columns: readonly CsvColumn<T>[],
  rows: Iterable<T>,
  options: CsvOptions = {},
): string {
  const eol = options.eol ?? '\r\n';
  const lines: string[] = [columns.map((column) => csvCell(column.header)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(','));
  }

  // A trailing terminator after the last row: universally tolerated, and it
  // makes concatenating two exports produce a valid file rather than a joined
  // row.
  return `${lines.join(eol)}${eol}`;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

/** `2026-08-09`, device-local. For a column that means a day. */
export function isoDate(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return format(date, 'yyyy-MM-dd');
}

/** `2026-08-09T19:04:00-07:00`, device-local with its offset. */
export function isoDateTime(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return format(date, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/* -------------------------------------------------------------------------- */
/* Filenames                                                                   */
/* -------------------------------------------------------------------------- */

export interface ExportFilenameParts {
  kind: 'roster' | 'register' | 'follow-up' | 'attendance';
  /** A gathering or event title. Slugged. */
  scope?: string | null;
  /** Appended verbatim, in order: `filtered`, `partial`. */
  flags?: readonly string[];
  at: Date;
}

/**
 * Keeps `\p{L}` rather than folding to ASCII.
 *
 * `benson-蔡秉洲-tsai` is a better filename than `benson-tsai`, every modern OS
 * accepts it, and `utils.ts` already reaches for the same class when it
 * normalises names.
 */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
}

/**
 * The only label the file will ever carry.
 *
 * By the time somebody opens it, it is in Downloads beside four others and the
 * screen it came from is gone — so what, which gathering, and when, all have to
 * be in the name.
 */
export function exportFilename(parts: ExportFilenameParts): string {
  const scope = parts.scope ? slug(parts.scope) : '';
  const segments = ['tally', parts.kind];
  // A title that slugs to nothing — one written entirely in punctuation — must
  // not leave a doubled separator behind.
  if (scope) segments.push(scope);
  segments.push(isoDate(parts.at));
  for (const flag of parts.flags ?? []) segments.push(flag);
  return `${segments.join('-')}.csv`;
}
