/**
 * Asserts the kiosk entry stays inside its performance budget.
 *
 * The kiosk runs on modern-but-slow hardware where gzipped bytes are a fair
 * proxy for parse-and-compile milliseconds, so the budget is a hard number
 * rather than a sentiment. Coverage is the *whole reachable graph* — the
 * chunks kiosk.html references statically plus everything they import,
 * dynamic imports included, because the Firebase SDK deliberately loads
 * behind the first paint and a regression there must still fail the build.
 *
 * Four assertions:
 *
 *   1. Nothing reachable from kiosk.html is the full Firestore chunk — the
 *      chunk-splitting in vite.config.ts exists so the kiosk (firestore/lite
 *      only) never downloads it, and one careless import anywhere under
 *      src/kiosk/ would quietly undo that.
 *   2. The gzipped total of the reachable graph stays under the budget, and
 *      the *first-paint* subset (the statically referenced chunks) under its
 *      own smaller one.
 *   3. Label printing stays inside a budget of its own.
 *   4. The install surface is present and still small — see the section at the
 *      bottom of this file.
 *
 * That third one exists because printing is a feature most kiosks do not have.
 * It loads behind `import()` gated on a localStorage key, so a lobby screen with
 * no printer never parses a byte of it — but it still counts against the total,
 * and the total has enough headroom to hide it growing. Left alone, "the kiosk
 * is under budget" would slowly come to mean "the kiosk plus a rasteriser is
 * under budget", and a regression in the part every kiosk *does* download would
 * have somewhere to hide. Naming it separately keeps both numbers honest.
 *
 * Run after `npm run build`: `node scripts/check-kiosk-budget.mjs`.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');

const TOTAL_BUDGET_GZIP_BYTES = 250_000;
const FIRST_PAINT_BUDGET_GZIP_BYTES = 130_000;

/**
 * Label printing: the rasteriser, its worker and the WebUSB transport.
 *
 * Measured over the chunks reachable *only* through the printing entry, so the
 * label template and the render maths — which the main app shares — are not
 * charged to it twice.
 *
 * 25 kB against about 14 kB in use. Enough room for a barcode or a second media
 * table, not enough for somebody to reach for the full `@vrwarp/brother-ql-webusb`
 * barrel and pull the imaging pipeline in alongside the transport. That is the
 * mistake this number is here to catch, and it is the reason the package has a
 * `printer-core` entry point at all.
 */
const PRINTING_BUDGET_GZIP_BYTES = 25_000;

/** Chunks whose names mark them as the printing feature's own. */
const PRINTING_CHUNK = /^(printing|raster\.worker)-/;

/**
 * One built HTML entry's source, read once and kept: the install checks at the
 * foot of this file read the kiosk's markup as well as its chunk list.
 */
function htmlOf(page) {
  return readFileSync(join(DIST, page), 'utf8');
}

/** The chunks one built HTML entry references directly. */
function staticRefsOf(page) {
  const refs = [...new Set([...htmlOf(page).matchAll(/assets\/[^"']+\.js/g)].map((m) => m[0]))];
  if (refs.length === 0) {
    console.error(`dist/${page} references no JS at all — the build layout changed.`);
    process.exit(1);
  }
  return refs;
}

const html = htmlOf('kiosk.html');
const staticRefs = staticRefsOf('kiosk.html');

/** Chunk basenames imported (statically or dynamically) by one built chunk. */
function importsOf(ref) {
  const source = readFileSync(join(DIST, ref), 'utf8');
  const found = new Set();
  for (const match of source.matchAll(/["'`]\.?\.?\/?((?:assets\/)?[\w.-]+\.js)["'`]/g)) {
    found.add(match[1].replace(/^assets\//, ''));
  }
  return [...found];
}

/**
 * Everything reachable from the kiosk's static entries, optionally stopping at a
 * set of chunks — which is how the printing subgraph is isolated below.
 */
function walk(stopAt = new Set(), from = staticRefs) {
  const seen = new Set();
  const queue = [...from.map((ref) => basename(ref))];
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    // Counted, but not traversed through: its imports belong to it.
    if (stopAt.has(name)) continue;
    try {
      queue.push(...importsOf(`assets/${name}`));
    } catch {
      // A specifier that is not an emitted chunk (sw.js references, workers).
    }
  }
  return seen;
}

const reachable = walk();

const fullFirestore = [...reachable].filter((name) => /^firestore-(?!lite)/.test(name));
if (fullFirestore.length > 0) {
  console.error(
    `The kiosk graph reaches the full Firestore chunk: ${fullFirestore.join(', ')}\n` +
      'Something under src/kiosk/ imports firebase/firestore (or a module that does). ' +
      'The kiosk must only ever import firebase/firestore/lite.',
  );
  process.exit(1);
}

/*
 * The welcome page reaches no Firestore at all — neither the full SDK nor the
 * lite one.
 *
 * It is a form and two callables: `firebase/app` and `firebase/functions`, no
 * session and no documents. That is a claim about what an unauthenticated page
 * may read as much as it is a budget, and it is one careless import away from
 * being false — and one chunking change away, which is how it was false to
 * begin with: `initializeApp` was hoisted into the lite-Firestore chunk, so a
 * parent in a foyer downloaded 111 kB of a database client to fill in four
 * fields. See the `firebase-core` group in vite.config.ts.
 */
const welcomeReachable = walk(new Set(), staticRefsOf('welcome.html'));
const welcomeFirestore = [...welcomeReachable].filter((name) => /^firestore-/.test(name));
if (welcomeFirestore.length > 0) {
  console.error(
    `The welcome graph reaches a Firestore chunk: ${welcomeFirestore.join(', ')}\n` +
      'src/welcome/ must import firebase/app and firebase/functions only. If nothing ' +
      'there changed, check the chunk groups in vite.config.ts — the SDK core is ' +
      'easily hoisted into a product chunk that happens to claim it first.',
  );
  process.exit(1);
}

/*
 * The printing subgraph: what a kiosk downloads *only* because it has a printer.
 *
 * Found by walking the graph a second time without traversing into the printing
 * entry, and taking the difference. Anything the main app or the rest of the
 * kiosk also needs — the label template, say — is reachable by another route and
 * so stays out of it, which is the point of doing it by difference rather than by
 * matching more names.
 *
 * Failing when no printing chunk is found is deliberate. This check is keyed on
 * chunk names, which come from module paths, so a rename or a refactor that
 * inlined the module could quietly make it measure nothing at all — and an
 * assertion that has stopped asserting is worse than no assertion, because the
 * output still reads as a pass.
 */
const printingEntries = new Set([...reachable].filter((name) => PRINTING_CHUNK.test(name)));
if (printingEntries.size === 0) {
  console.error(
    'No printing chunk found in the kiosk graph, so its budget is measuring nothing.\n' +
      'If src/kiosk/printing/ moved or was renamed, update PRINTING_CHUNK in this script. ' +
      'If printing was removed, remove this check with it.',
  );
  process.exit(1);
}

const withoutPrinting = walk(printingEntries);
const printingOnly = new Set([...reachable].filter((name) => !withoutPrinting.has(name)));
// The entries themselves are reached-but-not-traversed by the second walk, so
// they land in `withoutPrinting`; they are printing's own weight regardless.
for (const name of printingEntries) printingOnly.add(name);

const staticNames = new Set(staticRefs.map((ref) => basename(ref)));
let total = 0;
let firstPaint = 0;
let printing = 0;
const rows = [];
for (const name of reachable) {
  const bytes = gzipSync(readFileSync(join(DIST, `assets/${name}`))).length;
  total += bytes;
  const isStatic = staticNames.has(name);
  if (isStatic) firstPaint += bytes;
  if (printingOnly.has(name)) printing += bytes;
  const tag = isStatic ? 'entry ' : printingOnly.has(name) ? 'print ' : 'lazy  ';
  rows.push(`  ${(bytes / 1024).toFixed(1).padStart(7)} KB gz  ${tag} ${name}`);
}

/** What every kiosk downloads, printer or not — the number that must stay honest. */
const core = total - printing;

console.log(rows.sort((a, b) => Number(b.slice(0, 10)) - Number(a.slice(0, 10))).join('\n'));
const kb = (bytes) => (bytes / 1024).toFixed(1);
console.log(
  `  first paint ${kb(firstPaint)} KB gz (budget ${FIRST_PAINT_BUDGET_GZIP_BYTES / 1024}), ` +
    `core ${kb(core)} KB gz (budget ${TOTAL_BUDGET_GZIP_BYTES / 1024}), ` +
    `printing ${kb(printing)} KB gz (budget ${PRINTING_BUDGET_GZIP_BYTES / 1024}), ` +
    `all ${kb(total)} KB gz`,
);

if (firstPaint > FIRST_PAINT_BUDGET_GZIP_BYTES) {
  console.error(`Kiosk first-paint JS exceeds its budget: ${firstPaint} > ${FIRST_PAINT_BUDGET_GZIP_BYTES} bytes gzipped.`);
  process.exit(1);
}
if (core > TOTAL_BUDGET_GZIP_BYTES) {
  console.error(
    `Kiosk JS exceeds its budget: ${core} > ${TOTAL_BUDGET_GZIP_BYTES} bytes gzipped ` +
      '(excluding label printing, which has its own budget).',
  );
  process.exit(1);
}
if (printing > PRINTING_BUDGET_GZIP_BYTES) {
  console.error(
    `Kiosk label printing exceeds its budget: ${printing} > ${PRINTING_BUDGET_GZIP_BYTES} bytes gzipped.\n` +
      'The usual cause is importing @vrwarp/brother-ql-webusb rather than its ' +
      '/printer-core and /convert entry points, which puts the imaging pipeline on ' +
      'the main thread and in the worker both. See src/kiosk/printing/index.ts.',
  );
  process.exit(1);
}

/* ---- The install surface ------------------------------------------------- */

/*
 * The kiosk installs to a home screen as its own app, which takes three things
 * the build does not otherwise verify: a manifest, an icon set it points at, and
 * a service worker. All three are static files under public/, copied verbatim —
 * so a rename, a stray delete or a mistyped path produces a build that succeeds,
 * a page that runs, and a device that simply can never be installed. Nobody
 * finds that until they are standing at the shelf.
 *
 * The worker also gets a byte budget, for the same reason everything else here
 * does: it is hand-written precisely so the kiosk does not carry Workbox, and
 * "we could just use the plugin's worker here too" is a one-line change that
 * this number is what argues with.
 *
 * It is measured on the file as served — public/ is copied verbatim, nothing
 * minifies it — so most of what it currently spends is the explanation at the
 * top of the worker rather than the worker. That is the right trade for a file
 * downloaded once per deploy and read by anyone debugging a shelf device, and
 * the budget still leaves no room for a routing library.
 */
const SERVICE_WORKER_BUDGET_GZIP_BYTES = 4_000;

/** Read something the kiosk cannot be installed without, or fail saying so. */
function readInstallFile(name) {
  try {
    return readFileSync(join(DIST, name));
  } catch {
    console.error(
      `dist/${name} is missing, so the kiosk cannot be installed as an app.\n` +
        `It is copied verbatim from public/${name} — check it still exists there.`,
    );
    process.exit(1);
  }
}

if (!html.includes('/kiosk.webmanifest') || !html.includes('/kiosk-sw.js')) {
  console.error(
    'dist/kiosk.html no longer links its manifest and registers its service worker.\n' +
      'Both live in the <head> of kiosk.html; without them the page loads and no ' +
      'browser will offer to install it.',
  );
  process.exit(1);
}

const manifest = JSON.parse(readInstallFile('kiosk.webmanifest').toString('utf8'));

/*
 * Scope and id are what keep this a *separate* app. `/` for either would install
 * over the main app's identity instead of beside it — same launcher tile, same
 * install slot, one of them silently replacing the other.
 */
if (manifest.id !== '/kiosk' || manifest.scope !== '/kiosk' || manifest.start_url !== '/kiosk') {
  console.error(
    'kiosk.webmanifest must keep id, scope and start_url at /kiosk — otherwise it ' +
      'installs as (or over) the main Tally app rather than alongside it.\n' +
      `Found id=${manifest.id}, scope=${manifest.scope}, start_url=${manifest.start_url}.`,
  );
  process.exit(1);
}

// Vite does not check that a manifest's icons exist, and a missing one is only
// visible on a device: a blank tile in the launcher, or Chrome declining to
// offer the install at all. See public/icons/README.md.
for (const icon of manifest.icons ?? []) readInstallFile(icon.src.replace(/^\//, ''));

const serviceWorker = gzipSync(readInstallFile('kiosk-sw.js')).length;
if (serviceWorker > SERVICE_WORKER_BUDGET_GZIP_BYTES) {
  console.error(
    `The kiosk service worker exceeds its budget: ${serviceWorker} > ` +
      `${SERVICE_WORKER_BUDGET_GZIP_BYTES} bytes gzipped.\n` +
      'It is two handlers and a cache trim by design. Anything that needs more ' +
      'than this probably belongs in the app, not in front of it.',
  );
  process.exit(1);
}

console.log(
  `  install surface: manifest + ${manifest.icons.length} icons, ` +
    `service worker ${kb(serviceWorker)} KB gz (budget ${SERVICE_WORKER_BUDGET_GZIP_BYTES / 1024})`,
);
