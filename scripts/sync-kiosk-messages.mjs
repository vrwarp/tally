/**
 * Cuts the kiosk's slice out of the message catalogues.
 *
 * The lobby tablet pays for every byte it loads, and `messages/en.json` is
 * 85 kB of strings for screens it will never render — the settings page, the
 * review queue, the backend editors. Vite cannot tree-shake keys out of a JSON
 * module, so the only way to stop the whole catalogue landing in the kiosk's
 * first paint is to hand it a smaller file. Same idea as the palette and the
 * icon catalogue: the kiosk is handed the answers, not the code.
 *
 * The slice is whole namespaces rather than individual keys. A namespace is
 * what `useTranslations` takes, so anything finer would mean the kiosk and the
 * app disagreeing about what `t('title')` resolves to — and the saving over
 * whole namespaces is a rounding error.
 *
 * Generated and committed, checked by `tests/messages.test.ts`, exactly as
 * `sync-functions-shared.mjs` is: a copy is only defensible while it is
 * provably current. Plain Node with no dependencies, for the same reason.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MESSAGES = join(ROOT, 'messages');
const OUT = join(MESSAGES, 'kiosk');
const KIOSK_SRC = join(ROOT, 'src', 'kiosk');

/** The languages every catalogue is sliced for. Mirrors `src/lib/locales.ts`. */
export const LOCALES = ['en', 'zh-Hans', 'zh-Hant'];

/**
 * The namespaces a lobby screen can reach.
 *
 * Hand-written rather than derived, so adding one is a decision somebody made
 * rather than a byte cost that appeared. `usedNamespaces()` below is what keeps
 * the list honest in the other direction: a `useTranslations` under
 * `src/kiosk/` naming something absent here would render its own key on a
 * screen a parent is standing at, so the test fails instead.
 */
export const KIOSK_NAMESPACES = [
  'Chooser',
  'Confirm',
  'Door',
  'Grades',
  'Pairing',
  'Printer',
  'Register',
  'Search',
  'Staff',
];

/**
 * The pure-string hooks, and the namespace each one wraps.
 *
 * `useGrades()` names no namespace at its call site — it is `useTranslations`
 * with the cast already applied (see `src/hooks/usePureStrings.ts`) — so the
 * scan would miss it without this table.
 */
const HOOK_NAMESPACES = {
  useGrades: 'Grades',
  useRecurrenceStrings: 'Recurrence',
  useSyncStripStrings: 'SyncStrip',
};

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** Every namespace the kiosk's own source asks the catalogue for. */
export function usedNamespaces() {
  const used = new Set();
  for (const file of sourceFiles(KIOSK_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/useTranslations\(\s*'([^']+)'/g)) {
      used.add(match[1]);
    }
    for (const [hook, namespace] of Object.entries(HOOK_NAMESPACES)) {
      if (new RegExp(`\\b${hook}\\(`).test(source)) used.add(namespace);
    }
  }
  return [...used].sort();
}

/** One locale's slice, as the exact bytes the generated file should hold. */
export function render(locale) {
  const full = JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), 'utf8'));
  const slice = {};
  for (const namespace of [...KIOSK_NAMESPACES].sort()) {
    if (namespace in full) slice[namespace] = full[namespace];
  }
  return `${JSON.stringify(slice, null, 2)}\n`;
}

export function readGenerated(locale) {
  try {
    return readFileSync(join(OUT, `${locale}.json`), 'utf8');
  } catch {
    return null;
  }
}

/** The locales whose generated slice no longer matches the catalogue. */
export function stale() {
  return LOCALES.filter((locale) => readGenerated(locale) !== render(locale));
}

export function write() {
  mkdirSync(OUT, { recursive: true });
  for (const locale of LOCALES) {
    writeFileSync(join(OUT, `${locale}.json`), render(locale));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const drifted = stale();
    if (drifted.length > 0) {
      console.error(`Stale kiosk message slices: ${drifted.join(', ')}. Run npm run translate.`);
      process.exit(1);
    }
    console.log('Kiosk message slices are current.');
  } else {
    write();
    console.log(`Wrote ${LOCALES.length} kiosk message slices.`);
  }
}
