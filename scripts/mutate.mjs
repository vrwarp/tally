/**
 * A mutation run over one module, with only the tests that could kill it.
 *
 * The full run (`npm run test:mutation`) is the number that gets published: it
 * mutates the whole logic core against the whole suite, and it takes hours.
 * That is the wrong loop to work in. This is the working loop — one module, the
 * tests that statically reach it (see `mutation-scope.mjs`), a report written
 * beside the module's name, and an answer in under a minute for most files.
 *
 * A narrowed run can only *undercount*. Any mutant it reports as survived is
 * either genuinely unkilled or killed by a test that never imports the module,
 * and the second is not a thing this codebase does. So a clean narrowed run is
 * good evidence and the full run is the proof.
 *
 * Usage:
 *   node scripts/mutate.mjs src/lib/csv.ts
 *   node scripts/mutate.mjs src/lib/csv.ts src/lib/download.ts
 *   node scripts/mutate.mjs --glob "src/kiosk/printing/*.ts"
 *   node scripts/mutate.mjs src/lib/csv.ts -- --concurrency 2
 *
 * Everything after `--` is passed through to Stryker.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

const argv = process.argv.slice(2);
const passThroughAt = argv.indexOf('--');
const passThrough = passThroughAt === -1 ? [] : argv.slice(passThroughAt + 1);
const args = passThroughAt === -1 ? argv : argv.slice(0, passThroughAt);

if (args.length === 0) {
  console.error('Usage: node scripts/mutate.mjs <source files | --glob "pattern"> [-- stryker args]');
  process.exit(1);
}

const scope = execFileSync('node', ['scripts/mutation-scope.mjs', ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();

const mutate = args[0] === '--glob' ? [args[1]] : args;

/*
 * Named after what was mutated, so a morning of one-module runs leaves a
 * directory of reports rather than one file overwritten eleven times.
 */
const label =
  mutate.length === 1
    ? basename(mutate[0]).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
    : `${basename(dirname(mutate[0]))}-${mutate.length}-files`;
const report = `reports/mutation/${label}.json`;
mkdirSync('reports/mutation', { recursive: true });

console.log(`Mutating ${mutate.join(', ')}`);
console.log(`Against ${scope.split(',').length} test file(s)`);

/*
 * A throwaway config rather than command-line flags: Stryker's CLI has no
 * option for a nested key, so `--jsonReporter.fileName` is simply an unknown
 * option. Written beside the base config so its relative paths still resolve.
 */
const base = JSON.parse(readFileSync('stryker.config.json', 'utf8'));
const configPath = `.stryker-tmp/${label}.config.json`;
mkdirSync('.stryker-tmp', { recursive: true });
writeFileSync(
  configPath,
  JSON.stringify(
    {
      ...base,
      mutate,
      jsonReporter: { fileName: report },
      htmlReporter: { fileName: `reports/mutation/${label}.html` },
      // A narrowed run is a working tool, not a gate: it is expected to be red
      // while a module is being worked on, and a non-zero exit would only get
      // in the way of the loop it exists to speed up.
      thresholds: { ...base.thresholds, break: null },
    },
    null,
    2,
  ),
);

try {
  execFileSync('npx', ['stryker', 'run', configPath, ...passThrough], {
    stdio: 'inherit',
    env: { ...process.env, TALLY_MUTATION_TESTS: scope },
  });
} catch {
  process.exitCode = 1;
}

console.log(`\nSurvivors:  node scripts/mutation-survivors.mjs --report ${report} ${mutate[0]}`);
