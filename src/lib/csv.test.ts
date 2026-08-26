import { describe, expect, it } from 'vitest';
import { composeFirstName } from '@/types';
import { csvCell, exportFilename, isoDate, isoDateTime, toCsv } from '@/lib/csv';

interface Row {
  name: string;
  count: number;
}

const COLUMNS = [
  { header: 'name', value: (row: Row) => row.name },
  { header: 'count', value: (row: Row) => row.count },
];

describe('csvCell', () => {
  it('leaves an ordinary value unquoted', () => {
    expect(csvCell('Amara')).toBe('Amara');
  });

  it('quotes a value containing a comma, a quote or a newline', () => {
    expect(csvCell('Tsai, Benson')).toBe('"Tsai, Benson"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('carriage\rreturn')).toBe('"carriage\rreturn"');
  });

  it('quotes a value whose spacing a trimming reader would eat', () => {
    expect(csvCell(' leading')).toBe('" leading"');
    expect(csvCell('trailing ')).toBe('"trailing "');
  });

  it('renders null, undefined and the empty string as an empty cell', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('');
  });

  it('renders a boolean as yes/no', () => {
    expect(csvCell(true)).toBe('yes');
    expect(csvCell(false)).toBe('no');
  });
});

describe('csvCell — formula injection', () => {
  it.each(['=cmd|/c calc', '+1+1', '-1+1', '@SUM(A1)', '\tsneaky', '\rsneaky'])(
    'neutralises a string starting %j',
    (input) => {
      const cell = csvCell(input);
      expect(cell.startsWith('"\'')).toBe(true);
    },
  );

  it('does NOT neutralise a negative number', () => {
    // The whole reason CsvValue distinguishes number from string: guarding the
    // rendered string would turn every negative count into text.
    expect(csvCell(-3)).toBe('-3');
  });

  it('leaves a formula character in a non-leading position alone', () => {
    expect(csvCell('A=B')).toBe('A=B');
  });

  it('renders a non-finite number as empty rather than "NaN"', () => {
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('csvCell — the names Tally actually holds', () => {
  it('passes a nickname composite through unquoted and byte-identical', () => {
    // U+201C/U+201D are not U+0022, so this needs no CSV quoting at all. A
    // plausible "smart-quote-aware" escaping regex would corrupt it, which is
    // what this test exists to catch.
    const first = composeFirstName('Benson', '蔡秉洲');
    expect(first).toBe('Benson “蔡秉洲”');
    expect(csvCell(first)).toBe('Benson “蔡秉洲”');
  });
});

describe('toCsv', () => {
  it('writes a header row then one row per record, CRLF terminated', () => {
    const csv = toCsv(COLUMNS, [
      { name: 'Amara', count: 3 },
      { name: 'Ben', count: 0 },
    ]);
    expect(csv).toBe('name,count\r\nAmara,3\r\nBen,0\r\n');
  });

  it('writes the header alone when there are no rows', () => {
    expect(toCsv(COLUMNS, [])).toBe('name,count\r\n');
  });

  it('honours an overridden line ending', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Amara', count: 1 }], { eol: '\n' });
    expect(csv).toBe('name,count\nAmara,1\n');
  });

  it('never names its first column ID', () => {
    // A file whose first bytes are `ID` is parsed as SYLK by Excel and refused
    // outright. Every column set in the app is checked in its own test; this
    // one guards the rule itself.
    expect(COLUMNS[0]!.header.toUpperCase()).not.toBe('ID');
  });
});

describe('dates', () => {
  it('renders a day and an instant in device-local time', () => {
    const at = new Date(2026, 7, 9, 19, 4, 0);
    expect(isoDate(at)).toBe('2026-08-09');
    // Shape rather than a literal, so the assertion does not depend on the
    // runner's TZ — but the *date part* must match the local day, which is the
    // bug toISOString() would introduce. `Z` is what a UTC device renders.
    expect(isoDateTime(at)).toMatch(/^2026-08-09T19:04:00([+-]\d{2}:\d{2}|Z)$/);
  });

  it('renders a missing or invalid date as an empty cell', () => {
    expect(isoDate(null)).toBe('');
    expect(isoDate(undefined)).toBe('');
    expect(isoDateTime(new Date(Number.NaN))).toBe('');
  });
});

describe('exportFilename', () => {
  const at = new Date(2026, 7, 9);

  it('names what, which gathering, and when', () => {
    expect(exportFilename({ kind: 'follow-up', scope: 'Friday Fellowship', at })).toBe(
      'tally-follow-up-friday-fellowship-2026-08-09.csv',
    );
  });

  it('omits the scope segment rather than leaving a doubled separator', () => {
    expect(exportFilename({ kind: 'roster', at })).toBe('tally-roster-2026-08-09.csv');
    expect(exportFilename({ kind: 'roster', scope: '!!!', at })).toBe('tally-roster-2026-08-09.csv');
  });

  it('appends flags in order, after the date', () => {
    expect(exportFilename({ kind: 'roster', at, flags: ['filtered', 'partial'] })).toBe(
      'tally-roster-2026-08-09-filtered-partial.csv',
    );
  });

  it('keeps non-Latin letters rather than folding them away', () => {
    expect(exportFilename({ kind: 'attendance', scope: '中文聚會', at })).toBe(
      'tally-attendance-中文聚會-2026-08-09.csv',
    );
  });

  it('collapses a run of punctuation to one separator', () => {
    expect(exportFilename({ kind: 'roster', scope: 'Jamie  Rivera — 2026', at })).toBe(
      'tally-roster-jamie-rivera-2026-2026-08-09.csv',
    );
  });

  it('cuts a long title short rather than carrying it into the name', () => {
    // Forty characters of gathering, and the date still has to be readable at
    // the end of a row in Downloads.
    const long = 'The Wednesday Evening Middle School Gathering At The Annex';

    expect(exportFilename({ kind: 'roster', scope: long, at })).toBe(
      'tally-roster-the-wednesday-evening-middle-school-gath-2026-08-09.csv',
    );
  });

  it('never ends the title on the separator the cut landed in', () => {
    // The fortieth character is where a word ended, so the slice takes the
    // dash and nothing after it — and `tally-roster-…-hall--2026-08-09` is a
    // filename that reads as a bug.
    const name = exportFilename({
      kind: 'roster',
      scope: 'Wednesday Evening Gathering At The Hall X',
      at,
    });

    expect(name).toBe('tally-roster-wednesday-evening-gathering-at-the-hall-2026-08-09.csv');
    expect(name).not.toContain('--');
  });
});
