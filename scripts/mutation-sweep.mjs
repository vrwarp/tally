/**
 * Every module in the mutation scope, one narrowed run at a time.
 *
 * `mutate.mjs` answers for one file in about a minute. This is that, eighty
 * times, unattended — the sweep you leave running while you work through the
 * survivors it has already found. Reports land per module under
 * `reports/mutation/`, so `mutation-survivors.mjs --report <file>` can read one
 * the moment it exists rather than at the end.
 *
 * Ordered by how many test files each module drags in, cheapest first. A module
 * reachable from twenty tests answers in seconds; one reachable from all of
 * them pays the full five-minute dry run, and there is no reason to wait behind
 * it for the eighty that do not.
 *
 * Serial on purpose: Stryker already runs its own workers in parallel and
 * shares one sandbox directory, so a second run alongside it would both
 * contend for the cores and fight over `.stryker-tmp`.
 *
 * Usage:
 *   node scripts/mutation-sweep.mjs                    # everything in scope
 *   node scripts/mutation-sweep.mjs src/lib            # everything under a path
 *   node scripts/mutation-sweep.mjs --since origin/main # only what a branch changed
 *   node scripts/mutation-sweep.mjs --list             # print the plan and stop
 *   node scripts/mutation-sweep.mjs --skip-reported    # only modules with no report yet
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const ROOT = process.cwd();
const config = JSON.parse(readFileSync('stryker.config.json', 'utf8'));

function globToRegExp(pattern) {
  let source = '';
  let braces = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` has to match zero directories as well as many, so it swallows
        // the slash: `src/lib/**/*.ts` names `src/lib/csv.ts` too.
        if (pattern[index + 2] === '/') {
          source += '(?:[^/]*/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '{') {
      braces += 1;
      source += '(?:';
      continue;
    }
    if (character === '}' && braces > 0) {
      braces -= 1;
      source += ')';
      continue;
    }
    if (character === ',' && braces > 0) {
      source += '|';
      continue;
    }
    source += '.+^$()|[]\\?/'.includes(character) ? `\\${character}` : character;
  }
  return new RegExp(`^${source}$`);
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(relative(ROOT, full));
  }
  return found;
}

const includes = config.mutate.filter((pattern) => !pattern.startsWith('!')).map(globToRegExp);
const excludes = config.mutate
  .filter((pattern) => pattern.startsWith('!'))
  .map((pattern) => globToRegExp(pattern.slice(1)));

/**
 * Flags first, then whatever is left is a path prefix.
 *
 * `--since` takes a value, and it has to be *removed* here rather than merely
 * recognised: left in, `--since origin/main` put "origin/main" in the path
 * filter, nothing matched, and the sweep reported "no module changed" — which
 * on the pull-request gate is a pass. A gate that cannot fail is worse than no
 * gate, so this parses rather than scans.
 */
const argv = process.argv.slice(2);
const flags = new Set();
const filter = [];
let sinceRef = null;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--since') {
    sinceRef = argv[index + 1] ?? null;
    index += 1;
  } else if (arg.startsWith('--')) {
    flags.add(arg);
  } else {
    filter.push(arg);
  }
}

/**
 * What a branch changed, for the pull-request gate.
 *
 * Three dots: the modules this branch touched, not the ones `main` moved on
 * underneath it. A rebase should not put eighty modules back through the loop.
 */
let changed = null;
if (argv.includes('--since')) {
  if (!sinceRef) {
    console.error('--since needs a git ref.');
    process.exit(2);
  }
  changed = new Set(
    execFileSync('git', ['diff', '--name-only', '--diff-filter=d', `${sinceRef}...HEAD`], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

/** The report `mutate.mjs` would write for a module, so a resumed sweep can skip it. */
function reportFor(file) {
  const label = basename(file).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `reports/mutation/${label}.json`;
}

const skipReported = flags.has('--skip-reported');

const modules = walk(join(ROOT, 'src'))
  .filter((file) => includes.some((pattern) => pattern.test(file)))
  .filter((file) => !excludes.some((pattern) => pattern.test(file)))
  .filter((file) => filter.length === 0 || filter.some((prefix) => file.startsWith(prefix)))
  .filter((file) => changed === null || changed.has(file))
  .filter((file) => !skipReported || !existsSync(reportFor(file)));

if (changed !== null && modules.length === 0) {
  console.log('No module in the mutation scope changed on this branch.');
  process.exit(0);
}

/** How many test files each module drags in — the cost of asking about it. */
const plan = [];
for (const file of modules) {
  let scope = 0;
  try {
    scope = execFileSync('node', ['scripts/mutation-scope.mjs', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split(',').length;
  } catch {
    // No test imports it at all. Still worth running: every mutant will be
    // reported as uncovered, which is the finding.
    scope = Number.MAX_SAFE_INTEGER;
  }
  plan.push({ file, scope });
}
plan.sort((a, b) => a.scope - b.scope || a.file.localeCompare(b.file));

if (flags.has('--list')) {
  for (const { file, scope } of plan) {
    console.log(`${scope === Number.MAX_SAFE_INTEGER ? 'none' : String(scope).padStart(4)}  ${file}`);
  }
  console.log(`\n${plan.length} module(s).`);
  process.exit(0);
}

let index = 0;
for (const { file, scope } of plan) {
  index += 1;
  const started = Number(process.hrtime.bigint() / 1_000_000n);
  console.log(`\n=== [${index}/${plan.length}] ${file} (${scope === Number.MAX_SAFE_INTEGER ? 'no importing test' : `${scope} tests`})`);
  try {
    execFileSync('node', ['scripts/mutate.mjs', file], { stdio: 'inherit' });
  } catch {
    console.log(`--- ${file} run failed; continuing`);
  }
  const elapsed = Number(process.hrtime.bigint() / 1_000_000n) - started;
  console.log(`--- ${file} done in ${Math.round(elapsed / 1000)}s`);
}

console.log('\nSweep complete. Summary:  node scripts/mutation-summary.mjs');
