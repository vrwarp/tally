/**
 * Copies the modules the Cloud Functions share with the app.
 *
 * Cloud Functions deploy from `functions/` alone: `firebase.json` sets
 * `source: "functions"`, and `functions/tsconfig.json` compiles only its own
 * `src`. Nothing outside that directory is uploaded, so the nightly job that
 * writes occurrences down cannot import `src/lib/recurrenceCore.ts` — even
 * though it has to expand rules exactly the way the app does.
 *
 * The alternatives were worse. Hand-writing a second expander means two copies
 * of the skip semantics free to drift, and the bugs that would live in one and
 * not the other are precisely the ones the tests caught. Pointing the functions
 * `rootDir` at the repo root works, but moves the emitted entry point and so
 * changes how the deploy is laid out.
 *
 * So: one source of truth, copied mechanically, with `--check` wired into a
 * test so a stale copy fails the build rather than shipping.
 *
 * Plain Node with no dependencies, because it runs from `functions/` as a
 * `prebuild` and that package has neither `tsx` nor the root's `node_modules`.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FROM = join(ROOT, 'src', 'lib');
const TO = join(ROOT, 'functions', 'src', 'generated');

/**
 * In dependency order, though only for readability — each file names its own
 * imports. Every module listed here must import nothing but the others.
 */
export const SHARED_FILES = ['backendIds.ts', 'recurrenceCore.ts', 'materialize.ts', 'phoneDigits.ts'];

const BANNER = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/<name> by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; \`npm run functions:build\` regenerates this, and a unit test fails
 * if the two ever disagree.
 */
`;

/**
 * The one transformation: the app resolves relative imports without an
 * extension (Vite, \`moduleResolution: bundler\`), and the functions package is
 * NodeNext, which requires the \`.js\` the emitted file will actually have.
 */
function rewriteImports(source) {
  return source.replace(
    /(\bfrom\s+')(@\/lib\/|\.\/)([A-Za-z0-9_-]+)(')/g,
    (_match, before, _prefix, name, after) => `${before}./${name}.js${after}`,
  );
}

export function render(name) {
  const source = readFileSync(join(FROM, name), 'utf8');
  return BANNER.replace('<name>', name) + '\n' + rewriteImports(source);
}

/** What is on disk now, so `--check` can compare without writing. */
export function readGenerated(name) {
  try {
    return readFileSync(join(TO, name), 'utf8');
  } catch {
    return null;
  }
}

export function stale() {
  const drifted = SHARED_FILES.filter((name) => readGenerated(name) !== render(name));

  // A file left behind after being dropped from SHARED_FILES would still
  // compile into the deployed bundle, so an extra one counts as drift too.
  let extra = [];
  try {
    extra = readdirSync(TO).filter((name) => !SHARED_FILES.includes(name));
  } catch {
    extra = [];
  }

  return [...drifted, ...extra];
}

export function sync() {
  mkdirSync(TO, { recursive: true });
  for (const name of SHARED_FILES) writeFileSync(join(TO, name), render(name));
  return SHARED_FILES;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  if (process.argv.includes('--check')) {
    const drifted = stale();
    if (drifted.length > 0) {
      console.error(
        `functions/src/generated is out of date: ${drifted.join(', ')}\n` +
          'Run `node scripts/sync-functions-shared.mjs` and commit the result.',
      );
      process.exit(1);
    }
    console.log(`functions/src/generated is current (${SHARED_FILES.length} files).`);
  } else {
    const written = sync();
    console.log(`Synced ${written.length} shared module(s) into functions/src/generated.`);
  }
}
