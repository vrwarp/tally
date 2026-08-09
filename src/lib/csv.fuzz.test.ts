/**
 * The one property worth having on the serialiser: round-trip.
 *
 * Anything `toCsv` writes must read back as the same cells through an
 * independent parser. The neutralisation is stated *inside* the expectation
 * rather than excluded from the generator — a naive "output parses back to
 * input" property fails on the first `=`, and weakening it to avoid that would
 * throw away the cases most worth generating.
 */
import { describe, expect } from 'vitest';
import { arbitraryString } from '../../tests/fuzz/arbitrary';
import { forAll } from '../../tests/fuzz/property';
import type { Rng } from '../../tests/fuzz/prng';
import { csvCell, toCsv } from '@/lib/csv';

/** CSV-shaped nasties, kept local: `arbitrary.ts` is domain-shaped. */
const CSV_NASTIES: readonly string[] = [
  'a,b',
  'he said "hi"',
  '"',
  '""',
  '=1+1',
  '+1',
  '-1',
  '@SUM(A1)',
  '\tlead',
  'line\r\nbreak',
  ' padded ',
  ',',
];

function arbitraryCell(rng: Rng): string {
  return rng.bool(0.6) ? arbitraryString(rng) : rng.pick(CSV_NASTIES);
}

/**
 * A minimal RFC 4180 reader — the honest oracle, and deliberately not a
 * dependency. It is the only place in the repo that parses CSV, and it exists
 * so the round-trip is checked by something that does not share the writer's
 * assumptions.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index]!;

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }

    if (char === '"' && cell === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\r' && text[index + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 2;
      continue;
    }
    cell += char;
    index += 1;
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** What a written string is expected to read back as. */
function neutralised(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const COLUMNS = [0, 1, 2].map((index) => ({
  header: `c${index}`,
  value: (row: string[]) => row[index] ?? '',
}));

describe('toCsv round-trips', () => {
  forAll(
    'every written cell reads back through an independent parser',
    (rng) =>
      Array.from({ length: rng.int(0, 8) }, () =>
        Array.from({ length: 3 }, () => arbitraryCell(rng)),
      ),
    (rows) => {
      const parsed = parseCsv(toCsv(COLUMNS, rows));
      expect(parsed[0]).toEqual(['c0', 'c1', 'c2']);
      expect(parsed.slice(1)).toEqual(rows.map((row) => row.map(neutralised)));
    },
  );

  forAll(
    'no written cell ever begins with a bare formula character',
    (rng) => arbitraryCell(rng),
    (value) => {
      const cell = csvCell(value);
      // Either it was quoted (and the guard is inside the quotes), or its first
      // character is harmless. Never a bare `=`.
      expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
    },
  );
});
