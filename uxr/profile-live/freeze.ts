/**
 * Freezes the live student screens into the static prototypes the loop edits.
 *
 * `uxr/capture.spec.ts` does this for the scenes that live behind the emulator
 * suite: sign in, walk there, `freeze()`. This screen needs none of that — see
 * `main.tsx` — so it takes the same freeze and points it at a dev server
 * instead, and the files that come out are indistinguishable from the ones the
 * spec writes: real DOM, real inlined stylesheet, no scripts, an empty override
 * block at the end of `<head>`.
 *
 *   npx tsx uxr/profile-live/freeze.ts [--out uxr/prototype]
 *
 * Run it again after porting a round back into `src/` and it re-freezes what
 * actually shipped, which is the only honest input to a before/after.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';
import { freeze } from '../snapshot';

/** Same fallback as `uxr/shoot.ts`: an image that ships its own Chromium. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

/** The two shapes `uxr/shoot.ts` knows, named the way it names them. */
const VIEWPORTS = {
  phone: { width: 390, height: 844, scale: 2, touch: true },
  desktop: { width: 1440, height: 900, scale: 1, touch: false },
} as const;

/**
 * The states worth carrying through a round.
 *
 * The three surfaces a profile edit passes through. `sync-editor` is where the
 * edit is typed, `sync-profile` is the record it is about, and `sync-students`
 * is the list a leader doing nine of them in a row actually lives on — which is
 * the frame a round tuned on the single record quietly breaks, because nothing
 * about one student says how a list of forty-five reads with three of them in
 * flight.
 */
const SCENES = [
  { id: 'sync-profile', query: 'scene=profile' },
  { id: 'sync-students', query: 'scene=students' },
  { id: 'sync-editor', query: 'scene=editor' },
] as const;

/*
 * The demo Firebase config, for the one module in this graph that still reaches
 * `@/lib/firebase` — it throws at import time on a machine with no project
 * configured, which every CI runner and every fresh clone is. Nothing connects:
 * every call site is aliased to the fixture above, so the app is initialised and
 * never asked anything.
 */
process.env.VITE_USE_EMULATORS ??= 'true';

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = resolve(outFlag === -1 ? 'uxr/prototype' : args[outFlag + 1]!);
await mkdir(outDir, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const src = join(projectRoot, 'src');

/*
 * An explicit config rather than the project's own.
 *
 * The four aliases are the point — they are what swaps Firestore for the
 * fixture — and the project config cannot carry them without shipping the
 * fixture in the app's build graph. Everything else here is the app's build:
 * the same React plugin, the same Tailwind plugin, the same `@` alias, so the
 * stylesheet this freezes is the stylesheet the app paints with.
 */
const stubs = join(here, 'stubs.tsx');
const server = await createServer({
  configFile: false,
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\/context\/authContext$/, replacement: stubs },
      { find: /^@\/context\/dataContext$/, replacement: stubs },
      { find: /^@\/context\/toastContext$/, replacement: stubs },
      { find: /^@\/services\/functions$/, replacement: stubs },
      { find: /^@\/services\/students$/, replacement: stubs },
      { find: /^@\/features\/students\/useProfileHistory$/, replacement: stubs },
      { find: /^@\/hooks\/useStudentHistory$/, replacement: stubs },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  // `__E2E_HOOKS__` is defined by the app's own Vite config, which this one
  // deliberately is not; false is what a production build gets.
  define: { __E2E_HOOKS__: 'false' },
  // Without this the dependency scan crawls `index.html` — the app's entry, not
  // this one — and fails on the PWA plugin's virtual module, which is not in
  // this graph because the plugin is not either.
  optimizeDeps: { entries: ['uxr/profile-live/index.html'] },
  server: { port: 5198, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = 'http://127.0.0.1:5198/uxr/profile-live/index.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const written: string[] = [];

for (const scene of SCENES) {
  for (const [name, view] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: view.scale,
      colorScheme: 'dark',
      hasTouch: view.touch,
      isMobile: view.touch,
    });
    const page = await context.newPage();
    await page.goto(`${base}?${scene.query}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const file = join(outDir, `${scene.id}--${name}.html`);
    await writeFile(file, await freeze(page), 'utf8');
    written.push(file);
    await context.close();
  }
}

await browser.close();
await server.close();

console.log(`${written.length} scenes frozen → ${outDir}`);
