/**
 * Cuts each entry's slice out of the message catalogues.
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
 * The main app gets the mirror of that same cut. `messages/app/*.json` is the
 * whole catalogue minus the namespaces only a lobby screen renders, because
 * `messages/en.json` is 132 kB of compiled messages in the entry chunk on every
 * cold load and about half of `main-*.js`. This is the one boundary where "no
 * screen behind this entry can render that string" is a fact the build can
 * check rather than a guess a reviewer has to take on trust: `src/kiosk/` is a
 * directory, and "eagerly reachable from `src/main.tsx`" is not.
 *
 * It is a modest saving and deliberately so. The larger one — cutting the app's
 * own catalogue down to the routes that are eager — needs the route loaders and
 * the language switcher to agree about what has been loaded, and `LanguageChoice`
 * is persistent chrome on every screen (`src/components/AppShell.tsx`). A
 * counselor who opens the review queue and taps Español, and gets `Review.title`
 * back in the language she just chose, is a worse bug than 13 kB is a win.
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
const APP_OUT = join(MESSAGES, 'app');
const KIOSK_SRC = join(ROOT, 'src', 'kiosk');

/** The languages every catalogue is sliced for. Mirrors `src/lib/locales.ts`. */
export const LOCALES = ['en', 'es-MX', 'zh-Hans', 'zh-Hant'];

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
  'Common',
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
 * The namespaces the main app's slice leaves behind.
 *
 * The mirror of the list above: these eight are rendered by `src/kiosk/` and by
 * nothing else, so `messages/app/*.json` can drop them without any screen a
 * counselor opens losing a string. Everything else stays, including whole
 * namespaces only a lazy route reaches — see the header for why the app cannot
 * safely be cut any finer than the entry boundary.
 *
 * Deliberately not `Common` and not `Grades`. Those are the two entries in
 * `KIOSK_NAMESPACES` that both entries render — the shared chrome and the grade
 * ladder — and dropping either would blank a label on the roster rather than in
 * the lobby.
 *
 * Hand-written for the reason `KIOSK_NAMESPACES` is, and kept honest from the
 * other side by `tests/messages.test.ts`: it fails if any of these names is
 * reached by a `useTranslations('X')` or an `'X.key'` literal anywhere under
 * `src/` outside `src/kiosk/`, which is the direction that would put a bare
 * message key on a counselor's screen.
 */
export const APP_EXCLUDED_NAMESPACES = [
  'Chooser',
  'Confirm',
  'Door',
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

/** One locale's catalogue, the thing both slices are cut from. */
function catalogue(locale) {
  return JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), 'utf8'));
}

/** The kiosk's slice: the namespaces a lobby screen can reach, and nothing else. */
function renderKiosk(locale) {
  const full = catalogue(locale);
  const slice = {};
  for (const namespace of [...KIOSK_NAMESPACES].sort()) {
    if (namespace in full) slice[namespace] = full[namespace];
  }
  return `${JSON.stringify(slice, null, 2)}\n`;
}

/**
 * The app's slice: the catalogue, minus the lobby's own screens.
 *
 * Walks the catalogue's own key order rather than a sorted list, which is where
 * this differs from `renderKiosk`. The kiosk's file is a short hand-picked
 * gathering and sorting it makes it readable; this one is `messages/en.json`
 * with eight namespaces removed, and keeping the order is what makes a diff
 * against the catalogue read as those removals rather than as a rewrite.
 */
function renderApp(locale) {
  const full = catalogue(locale);
  const slice = {};
  for (const [namespace, messages] of Object.entries(full)) {
    if (!APP_EXCLUDED_NAMESPACES.includes(namespace)) slice[namespace] = messages;
  }
  return `${JSON.stringify(slice, null, 2)}\n`;
}

/**
 * The generated slices, by the name each one is addressed as.
 *
 * A table rather than two parallel copies of `stale`/`write`, so a third entry
 * would be three lines and not a third copy of the drift check that is the
 * whole point of generating these files.
 */
const SLICES = {
  kiosk: { dir: OUT, render: renderKiosk },
  app: { dir: APP_OUT, render: renderApp },
};

/** One locale's slice, as the exact bytes the generated file should hold. */
export function render(slice, locale) {
  return SLICES[slice].render(locale);
}

export function readGenerated(slice, locale) {
  try {
    return readFileSync(join(SLICES[slice].dir, `${locale}.json`), 'utf8');
  } catch {
    return null;
  }
}

/** The locales whose generated slice no longer matches the catalogue. */
export function stale(slice) {
  return LOCALES.filter((locale) => readGenerated(slice, locale) !== render(slice, locale));
}

export function write() {
  for (const [slice, { dir }] of Object.entries(SLICES)) {
    mkdirSync(dir, { recursive: true });
    for (const locale of LOCALES) {
      writeFileSync(join(dir, `${locale}.json`), render(slice, locale));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = Object.keys(SLICES);
  if (process.argv.includes('--check')) {
    const drifted = names.flatMap((slice) =>
      stale(slice).map((locale) => `${slice}/${locale}`),
    );
    if (drifted.length > 0) {
      console.error(`Stale message slices: ${drifted.join(', ')}. Run npm run translate.`);
      process.exit(1);
    }
    console.log('Message slices are current.');
  } else {
    write();
    console.log(`Wrote ${names.length * LOCALES.length} message slices.`);
  }
}
