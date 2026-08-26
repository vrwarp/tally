/**
 * Every per-module report the sweep left behind, as one table.
 *
 * `mutation-sweep.mjs` writes one JSON report per module, which is the right
 * shape for working (a module's answer arrives the moment it is ready) and the
 * wrong shape for looking (eighty files). This reads the lot and prints the two
 * things triage asks: which modules are weakest, and what the total is.
 *
 * The total here is a working figure, not the published one. These are narrowed
 * runs — each module was tested only against the tests that import it — so a
 * mutant killed by something further away is counted as a survivor. It can only
 * be pessimistic, which is the useful direction for deciding what to work on
 * next. `npm run test:mutation` is the number that gets published.
 *
 * Usage:
 *   node scripts/mutation-summary.mjs            # weakest first
 *   node scripts/mutation-summary.mjs --clean    # only the modules at 100%
 *   node scripts/mutation-summary.mjs --min 90   # exit non-zero below a score
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'reports/mutation';

const minimumAt = process.argv.indexOf('--min');
const gating = minimumAt !== -1;

const rows = [];
let reports = [];
try {
  reports = readdirSync(DIR).filter((name) => name.endsWith('.json') && name !== 'mutation.json');
} catch {
  /*
   * No directory at all is the ordinary shape of the pull-request gate on a
   * branch that changed nothing in the scope: `mutation-sweep.mjs --since`
   * exits without running anything, so nothing ever creates it. That is a pass
   * rather than a zero, and treating it as an error failed every such branch.
   */
  if (!gating) {
    console.error(`No reports in ${DIR}. Run: node scripts/mutation-sweep.mjs`);
    process.exit(1);
  }
}

/*
 * Newest report last, and one row per module however many reports name it.
 *
 * A module can appear in more than one report — the sweep's own run, a
 * `mutate.mjs` re-run after a fix, a report written under an older naming
 * scheme. Summing them all counted the module twice and averaged its before
 * with its after, which reads as progress that did not happen. The newest
 * report is the true one, so it is the one that stands.
 */
const seen = new Map();
reports.sort((a, b) => statSync(join(DIR, a)).mtimeMs - statSync(join(DIR, b)).mtimeMs);

for (const name of reports) {
  let report;
  try {
    report = JSON.parse(readFileSync(join(DIR, name), 'utf8'));
  } catch {
    console.error(`skipping unreadable report ${name}`);
    continue;
  }
  for (const [file, { mutants }] of Object.entries(report.files ?? {})) {
    let killed = 0;
    let total = 0;
    let uncovered = 0;
    for (const mutant of mutants) {
      if (mutant.status === 'Ignored' || mutant.status === 'CompileError') continue;
      total += 1;
      if (mutant.status === 'NoCoverage') uncovered += 1;
      else if (mutant.status !== 'Survived') killed += 1;
    }
    seen.set(file, { file, killed, total, uncovered });
  }
}

rows.push(...seen.values());

rows.sort((a, b) => a.killed / (a.total || 1) - b.killed / (b.total || 1) || a.file.localeCompare(b.file));

const clean = process.argv.includes('--clean');
let killed = 0;
let total = 0;
let uncovered = 0;
for (const row of rows) {
  killed += row.killed;
  total += row.total;
  uncovered += row.uncovered;
  const score = (row.killed / (row.total || 1)) * 100;
  if (clean !== (score === 100)) continue;
  const left = row.total - row.killed;
  console.log(
    `${score.toFixed(1).padStart(6)}%  ${String(left).padStart(4)} left` +
      `${row.uncovered ? ` (${row.uncovered} uncovered)` : ''}`.padEnd(18) +
      `  ${row.file}`,
  );
}

const score = (killed / (total || 1)) * 100;
console.log(
  `\n${rows.length} module(s): ${score.toFixed(2)}% ` +
    `(${killed}/${total} killed, ${total - killed} left, ${uncovered} never reached by a test)`,
);

if (gating) {
  const minimum = Number(process.argv[minimumAt + 1]);
  if (!Number.isFinite(minimum)) {
    console.error('--min needs a number.');
    process.exit(2);
  }
  if (total === 0) {
    // Nothing was mutated, which is what a pull request touching no source
    // module looks like. That is a pass, not a zero.
    console.log('Nothing in the mutation scope changed.');
  } else if (score < minimum) {
    console.error(`\nMutation score ${score.toFixed(2)}% is below the ${minimum}% floor.`);
    process.exit(1);
  }
}
