/**
 * Prints the mutants a Stryker run did not kill, grouped so they can be worked
 * through a file at a time.
 *
 * `reports/mutation/mutation.json` is the machine-readable half of the HTML
 * report: every mutant, its status, and the exact replacement Stryker made.
 * Reading it by hand is impractical at 8k mutants, and the HTML report is not
 * greppable, so this collapses it to the only two questions triage asks — which
 * files are weakest, and what exactly survived in them.
 *
 * Usage:
 *   node scripts/mutation-survivors.mjs                 # summary, all files
 *   node scripts/mutation-survivors.mjs src/lib/csv.ts  # detail for one file
 *   node scripts/mutation-survivors.mjs --report path/to/mutation.json
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
let reportPath = 'reports/mutation/mutation.json';
const reportFlag = args.indexOf('--report');
if (reportFlag !== -1) {
  reportPath = args[reportFlag + 1];
  args.splice(reportFlag, 2);
}
const filter = args[0];

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

/** Statuses that mean "the tests did not notice" — the ones worth acting on. */
const UNKILLED = new Set(['Survived', 'NoCoverage']);

const rows = [];
for (const [file, { source, mutants }] of Object.entries(report.files)) {
  const lines = source.split('\n');
  let killed = 0;
  let total = 0;
  const survivors = [];
  for (const mutant of mutants) {
    if (mutant.status === 'Ignored' || mutant.status === 'CompileError') continue;
    total += 1;
    if (!UNKILLED.has(mutant.status)) {
      killed += 1;
      continue;
    }
    survivors.push({
      line: mutant.location.start.line,
      mutator: mutant.mutatorName,
      status: mutant.status,
      source: (lines[mutant.location.start.line - 1] ?? '').trim(),
      replacement: (mutant.replacement ?? '').split('\n')[0].trim(),
    });
  }
  rows.push({ file, killed, total, survivors });
}

rows.sort((a, b) => a.killed / (a.total || 1) - b.killed / (b.total || 1));

if (filter) {
  for (const row of rows) {
    if (!row.file.includes(filter)) continue;
    console.log(`\n${row.file} — ${score(row)} (${row.survivors.length} survived)`);
    row.survivors.sort((a, b) => a.line - b.line);
    for (const s of row.survivors) {
      console.log(`  L${s.line} ${s.status === 'NoCoverage' ? '[no cov] ' : ''}${s.mutator}`);
      console.log(`      - ${s.source}`);
      console.log(`      + ${s.replacement}`);
    }
  }
} else {
  let killed = 0;
  let total = 0;
  for (const row of rows) {
    killed += row.killed;
    total += row.total;
    if (row.survivors.length === 0) continue;
    console.log(`${score(row).padStart(7)}  ${String(row.survivors.length).padStart(4)} left  ${row.file}`);
  }
  console.log(`\nTotal: ${((killed / (total || 1)) * 100).toFixed(2)}%  (${killed}/${total} killed, ${total - killed} left)`);
}

function score(row) {
  return `${((row.killed / (row.total || 1)) * 100).toFixed(1)}%`;
}
