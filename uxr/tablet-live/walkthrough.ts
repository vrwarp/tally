/**
 * Photographs every surface the tablet-management change touches.
 *
 * Four scenes across three existing harnesses and one real page, which is why
 * this is a shooter rather than another `*-live/` directory: nothing here needs
 * a new mount. `kiosk-live` already renders `PrinterScreen` from `src/`,
 * `kiosk-setup-live` already renders `KioskPage`, `team-live` already renders
 * `TeamPage`, and `/setup` is a static page the app itself serves. Each of them
 * grew one knob for this change and no more.
 *
 *   npx tsx uxr/tablet-live/walkthrough.ts
 *   npx tsx scripts/build-tablet-walkthrough.ts
 *
 * The three harnesses want different module aliases and two of them define the
 * same names, so they cannot share one dev server. A server per scene group is
 * the simple answer: Vite starts in well under a second and the whole run is a
 * handful of them.
 *
 * `/setup` is shot from a server with no aliases at all — it is the shipped
 * page, reading the origin it is served from, which is the only interesting
 * thing about it.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer, type InlineConfig } from 'vite';

/** Same fallback as `uxr/shoot.ts`: an image that ships its own Chromium. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const src = join(projectRoot, 'src');

const OUT = resolve(projectRoot, 'docs/walkthrough/tablet');
const SHOTS = join(OUT, 'shots');

/**
 * The shapes these screens are actually used in.
 *
 * `tablet` is the shelf device itself, stood on end. `desktop` is the laptop a
 * leader stages from and reads the team screen on. Nothing here is shot on a
 * phone: staging a tablet is not a thing anybody does from one.
 */
const VIEWPORTS = {
  tablet: { width: 800, height: 1280, scale: 1 },
  desktop: { width: 1440, height: 900, scale: 1 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;

interface Scene {
  id: string;
  /** Which harness serves it — the key into `SERVERS`. */
  server: keyof typeof SERVERS;
  path: string;
  viewport: ViewportName;
  journey: string;
  title: string;
  caption: string;
  /** Run before the shot: press something, scroll somewhere. */
  prepare?: (page: Page) => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The servers                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * The app's build, minus its message compiler.
 *
 * `compileMessages()` is in `vite.config.ts` and deliberately not here. The
 * harnesses import `messages/en.json` as a plain module and hand it to
 * `IntlProvider`; the plugin rewrites that import into the compiled form, which
 * the plain provider cannot read — every plural resolves "to an array, but only
 * strings are supported". Raw catalogue, raw provider, and the strings on the
 * frame are still the app's own.
 */
const base: InlineConfig = {
  configFile: false,
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  logLevel: 'error',
};

/**
 * `entries` is not optional dressing.
 *
 * Without it Vite's dependency scan crawls the app's own `index.html` — not the
 * harness's — and dies on the PWA plugin's virtual module, which is not in this
 * graph because the plugin is not either. The scan then gives up on
 * pre-bundling entirely and the page 404s on a transitive dependency, which
 * surfaces as a missing intl provider rather than as anything resembling the
 * real cause. Every harness in `uxr/` carries the same line for the same
 * reason.
 */
function aliased(entry: string, stubs: string | null, modules: string[] = []): InlineConfig {
  return {
    ...base,
    resolve: {
      alias: [
        ...(stubs
          ? modules.map((find) => ({ find: new RegExp(`^${find}$`), replacement: stubs }))
          : []),
        { find: /^@\//, replacement: `${src}/` },
      ],
    },
    optimizeDeps: { entries: [entry] },
  };
}

const SERVERS = {
  /** The shipped `/setup` page. No aliases: it is the real thing. */
  app: {
    port: 5211,
    config: aliased('setup.html', null),
  },
  /** `PrinterScreen`, driven by query string. */
  kiosk: {
    port: 5212,
    config: aliased('uxr/kiosk-live/index.html', null),
  },
  /** `KioskPage`, with the callables answered locally. */
  pair: {
    port: 5213,
    config: aliased('uxr/kiosk-setup-live/index.html', join(projectRoot, 'uxr/kiosk-setup-live/stubs.tsx'), [
      '@/context/authContext',
      '@/context/dataContext',
      '@/context/toastContext',
      '@/services/functions',
    ]),
  },
  /** `TeamPage`, with the subscriptions answered from a fixture. */
  team: {
    port: 5214,
    config: aliased('uxr/team-live/index.html', join(projectRoot, 'uxr/team-live/stubs.tsx'), [
      '@/context/authContext',
      '@/context/toastContext',
      '@/context/dataContext',
      '@/services/users',
      '@/services/access',
      '@/services/eventAccess',
      '@/services/kioskDevices',
      '@/services/accessRequests',
      '@/services/functions',
    ]),
  },
} as const;

/* -------------------------------------------------------------------------- */
/* The scenes                                                                  */
/* -------------------------------------------------------------------------- */

const SCENES: Scene[] = [
  {
    id: '01-setup-top',
    server: 'app',
    path: '/setup.html',
    viewport: 'desktop',
    journey: 'Staging a tablet',
    title: 'The page that generates its own answers',
    caption:
      'Opened **on the tablet being staged**, before that tablet is a kiosk. What somebody types is the short path `/setup`; what they paste is everything else — and that is the whole trick, because every way of getting the WebUSB value wrong fails silently. Nothing here is configured: the origin it grants to is the origin it was served from, so this page is correct wherever Tally is deployed. It is not behind a sign-in either, on purpose — a login would mean signing a staff Google account into the browser of a tablet about to be handed to the public, which is the exact thing the kiosk’s pairing design exists to avoid.',
  },
  {
    id: '02-setup-values',
    server: 'app',
    path: '/setup.html',
    viewport: 'desktop',
    journey: 'Staging a tablet',
    title: 'The required row, and the two that can lock you out',
    caption:
      'The blue row is the one the whole page exists for. It pre-grants Brother, Zebra and Dymo by vendor — a grant is free and a printer bought in a hurry on a Sunday morning is not — and it names no `product_id`, because a model-pinned rule has to be edited the first time a printer is replaced. The amber rows at the bottom are ordered last and a test pins that order: pasting `URLBlocklist: ["*"]` into the tablet’s Chrome cuts off the very page these values are being copied from.',
    prepare: async (page) => {
      // The amber pair at the foot of the list, which is what this frame is of.
      await page.locator('section.row.careful').first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, -160);
    },
  },
  {
    id: '03-setup-tablet',
    server: 'app',
    path: '/setup.html',
    viewport: 'tablet',
    journey: 'Staging a tablet',
    title: 'The same page, on the glass it is read from',
    caption:
      'The shelf tablet, stood on end, which is where this is actually used: Chrome on one side of the screen and Test DPC’s managed-configuration editor on the other. Copy, switch, long-press, paste, next key. The copy button falls back to selecting the value when the clipboard API is refused — which it is on an insecure origin — because a button that silently does nothing during staging is worse than no button at all.',
  },
  {
    id: '04-printer-policy',
    server: 'kiosk',
    path: '/uxr/kiosk-live/index.html?screen=printer&printer=unpaired&policy=1',
    viewport: 'tablet',
    journey: 'A volunteer at the kiosk',
    title: 'No set-up step was missed',
    caption:
      'A managed kiosk whose printer is not answering at this moment. Before the change this screen offered *Connect the printer* and said nothing else, and on a tablet nobody ever set up the absence of a set-up step reads as a step somebody skipped. The reference line says the tablet’s own settings supplied the printer and a replacement will work the same way — and the advice that is actually actionable, power and cable, stays exactly where it was. A test pins that it stays.',
  },
  {
    id: '05-printer-paired',
    server: 'kiosk',
    path: '/uxr/kiosk-live/index.html?screen=printer&printer=unpaired',
    viewport: 'tablet',
    journey: 'A volunteer at the kiosk',
    title: 'And nothing of the sort on a kiosk somebody paired',
    caption:
      'The same screen, same state, on an ordinary kiosk. The line is absent, because it would be untrue: somebody did connect this printer by hand, and there was a set-up step. Provenance is carried on the stored config and survives both places that rewrite it — `configure()`, which every roll change goes through, and `checkPrinter`’s settle. Without that carry, the first time anybody picked the other spindle a policy-granted printer would start describing itself as one somebody paired.',
  },
  {
    id: '06-staging-link',
    server: 'pair',
    path: '/uxr/kiosk-setup-live/index.html',
    viewport: 'desktop',
    journey: 'A leader, staging in the office',
    title: 'A pairing for a tablet nobody will be standing at',
    caption:
      'The ordinary handshake wants a volunteer holding a tablet that is already showing six characters. A managed tablet is the other shape entirely — reset in an office, booting into the kiosk by itself — so the pairing is minted ready and travels in the tablet’s start URL. Shown once, good for an hour, and the warning is written as *treat it like a password* rather than in security language nobody reads. The kiosk strips it out of the address before it makes any network call, and unconditionally: a link that failed is no less a credential than one that worked.',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Make a link' }).click();
      await page.getByText('/kiosk?pair=').waitFor();
    },
  },
  {
    id: '07-battery',
    server: 'team',
    path: '/uxr/team-live/index.html',
    viewport: 'desktop',
    journey: 'Whoever notices before Sunday',
    title: 'Somebody unplugged the lobby tablet',
    caption:
      'The one thing on the tablet-management list that never needed a device-management product at all. `lastSeenAt` already said a kiosk was alive on Tuesday; it did not say the tablet has been off its charger since Thursday, which is the sentence somebody can act on. Said only when it is worth saying — a plugged-in tablet and a retired row both stay silent, because "87%, charging" is a fact nobody can act on and one more line on a screen that is already dense. Four tests pin each of those silences.',
    prepare: async (page) => {
      // The row is inside a person's panel, and the panel is taller than the
      // window: open it, then bring the kiosks it lists into the frame.
      await page.getByText('Miriam Achebe').first().click();
      const battery = page.getByText('On battery', { exact: false }).first();
      await battery.waitFor();
      await battery.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, -260);
    },
  },
];

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

await mkdir(SHOTS, { recursive: true });

const browser: Browser = await chromium.launch(executablePath ? { executablePath } : {});
const manifest: Omit<Scene, 'prepare' | 'server' | 'path'>[] = [];

for (const key of Object.keys(SERVERS) as (keyof typeof SERVERS)[]) {
  const scenes = SCENES.filter((scene) => scene.server === key);
  if (scenes.length === 0) continue;

  const { port, config } = SERVERS[key];
  const server = await createServer({ ...config, server: { port, strictPort: true } });
  await server.listen();

  for (const scene of scenes) {
    const { width, height, scale } = VIEWPORTS[scene.viewport];
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      // Neither surface animates anything worth photographing mid-flight, and a
      // frame caught halfway through a fade is a frame nobody can review.
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}${scene.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    if (scene.prepare) await scene.prepare(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, `${scene.id}.png`), fullPage: false });
    await context.close();

    const { prepare: _p, server: _s, path: _path, ...rest } = scene;
    manifest.push(rest);
    process.stdout.write(`shot ${scene.id}\n`);
  }

  await server.close();
}

await browser.close();
await writeFile(join(OUT, 'tablet.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`\n${manifest.length} frames in ${OUT}\n`);
