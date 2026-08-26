/**
 * Which test files can reach a module — and therefore which ones a mutation run
 * over it needs to load.
 *
 * Stryker's fixed cost is the dry run: it executes the whole suite once to
 * learn which test covers which line, and over Tally's ~2,100 tests that is
 * five minutes in a single process. Then every *surviving* mutant pays for all
 * the tests that cover it, because nothing fails early to cut the run short.
 * Both costs are paid mostly in tests that could not possibly have noticed the
 * mutant, and a run scoped to one module is nearly all of those.
 *
 * So: walk the static import graph backwards. A test that never imports the
 * module, directly or through any chain of imports, cannot execute a line of it
 * and cannot kill a mutant in it. Dropping those from the suite is exact rather
 * than a heuristic — with one honest caveat below.
 *
 * The caveat: `vi.mock()` substitutes a module at run time, so a test that
 * imports the module may never run it. That direction is safe — it costs time
 * and never hides a kill. The unsafe direction would be a test reaching code no
 * import mentions, which in this codebase would mean a dynamic `import()` of a
 * computed specifier. There are none; `import('./x')` with a literal string is
 * parsed here like any other import.
 *
 * Usage:
 *   node scripts/mutation-scope.mjs src/lib/csv.ts [more.ts ...]
 *   node scripts/mutation-scope.mjs --glob "src/lib/*.ts"
 *
 * Prints a comma-separated list, ready for `TALLY_MUTATION_TESTS`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['src', 'tests', 'e2e'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function walk(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(full);
  }
  return found;
}

/**
 * Every specifier a file names. Deliberately matched rather than parsed: this
 * only has to be *complete*, and a specifier that turns out not to resolve is
 * dropped a few lines later anyway.
 */
const SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
const VI_MOCK = /vi\.(?:mock|doMock|unmock)\s*\(\s*['"]([^'"]+)['"]/g;

function specifiersOf(source) {
  const found = new Set();
  for (const match of source.matchAll(SPECIFIER)) found.add(match[1]);
  // `vi.mock('@/services/functions')` names a module the test is deliberately
  // *not* running, but Vitest still resolves it — and a factory-less mock reads
  // the real module to shape the automock. Counted, because the cost of an
  // extra test file is time and the cost of a missing one is a false survivor.
  for (const match of source.matchAll(VI_MOCK)) found.add(match[1]);
  return [...found];
}

/** `@/lib/csv` and `./csv` alike, resolved to a repository-relative path. */
function resolveSpecifier(specifier, fromFile) {
  let base;
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;

  // NodeNext-style `./x.js` specifiers point at TypeScript sources here.
  const candidates = [base, base.replace(/\.js$/, '')];
  for (const candidate of candidates) {
    for (const extension of ['', ...EXTENSIONS]) {
      const path = `${candidate}${extension}`;
      try {
        if (statSync(path).isFile()) return relative(ROOT, path);
      } catch {
        /* keep looking */
      }
    }
    for (const extension of EXTENSIONS) {
      const path = join(candidate, `index${extension}`);
      try {
        if (statSync(path).isFile()) return relative(ROOT, path);
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

const files = SOURCE_ROOTS.flatMap((root) => walk(join(ROOT, root))).map((path) =>
  relative(ROOT, path),
);

/** file -> the repository files it imports. */
const imports = new Map();
for (const file of files) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const resolved = new Set();
  for (const specifier of specifiersOf(source)) {
    const target = resolveSpecifier(specifier, join(ROOT, file));
    if (target) resolved.add(target);
  }
  imports.set(file, resolved);
}

const isTest = (file) => /\.test\.(ts|tsx)$/.test(file) && !file.startsWith('e2e/');

/** Every file `start` can reach, following imports. */
function reachableFrom(start) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    for (const next of imports.get(stack.pop()) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

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

const targets = new Set();
const args = process.argv.slice(2);
if (args[0] === '--glob') {
  const pattern = globToRegExp(args[1] ?? '');
  for (const file of files) if (pattern.test(file)) targets.add(file);
} else {
  for (const arg of args) targets.add(relative(ROOT, resolve(ROOT, arg)));
}

if (targets.size === 0) {
  console.error('No target modules matched.');
  process.exit(1);
}

const scope = [];
for (const file of files) {
  if (!isTest(file)) continue;
  const reachable = reachableFrom(file);
  if ([...targets].some((target) => reachable.has(target))) scope.push(file);
}

if (scope.length === 0) {
  console.error(`No test file imports ${[...targets].join(', ')} — every mutant would survive.`);
  process.exit(2);
}

console.log(scope.join(','));
