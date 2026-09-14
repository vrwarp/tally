/**
 * Renders the kiosk home screen in every language, for the language campaign.
 *
 * `uxr/kiosk-live/shoot.ts` photographs the shipping screens state by state
 * in the room's default language. This shoots a handful of states once per
 * language and once per candidate home screen, because the question this
 * campaign asks — can a parent who reads no English find the words — has to
 * be answered on the English frame *and* on the frame they arrive at.
 *
 *   npx tsx uxr/kiosk-language/shoot.ts [--out uxr/renders/lang-r00]
 *                                       [--lang en,zh-Hant,zh-Hans,es]
 *                                       [--view kiosktall]
 *                                       [--variant shipped,voices@zh-Hant+es]
 *                                       [--only idle,nomatch]
 *
 * Frames are `<scene>--<view>--<lang>--<variant>-fold.png`, with an
 * `index.json` beside them, so a round reads like every other round.
 * `shipped` is the real component; anything else is a row of
 * `SearchScreen.variants.tsx`, and `@` after it names the languages the
 * lobby pins beside English at rest (`+`-joined), which becomes `?pins=`.
 * Round 7 narrowed the study to the portrait tablet, so `--view` defaults
 * to it; `--view phone,kiosktall,kioskwide` widens it again. `--lang` is a
 * filter over what each scene asks for: the resting scenes are shot in the
 * kiosk's own language, the chosen ones in each language a family can
 * choose. Spanish is a language the kiosk does not speak yet, so a frame
 * of it waits for the provider to settle in English, which it does.
 *
 * Every frame is checked for sideways scroll on the way past, as the kiosk
 * shooter checks it: a fixed-height row wider than the glass takes the whole
 * grid with it and the frame looks identical either way. Chinese labels are
 * a fresh way to be wider than the glass.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { isLocale } from '../../src/lib/locales';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

/** The three shapes a lobby screen takes — as `uxr/kiosk-live/shoot.ts` names them. */
const VIEWPORTS = {
  phone: { width: 390, height: 844, scale: 2 },
  kiosktall: { width: 800, height: 1280, scale: 1 },
  kioskwide: { width: 1280, height: 800, scale: 1 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;

/**
 * The states a home screen has to be right in.
 *
 * `idle` is the frame in the complaint: what a parent walks up to, in the
 * kiosk's own resting language. `chosen` is the frame they arrive at, once
 * per language a family can choose. `typed` and `nomatch` are where the
 * idle panel's replacement has to hold — a design that helps the empty
 * screen must not cost the one with rows on it — and `chosen-typed` and
 * `chosen-nomatch` are the same two after a choice. `photo-idle` is the
 * idle screen on a gathering that wears a photograph, which every
 * idle-panel change has to survive; `photo-light` the same on the light
 * ground. `langs` is what a scene asks for; `--lang` narrows it.
 */
const SCENES: {
  id: string;
  query: string;
  views: readonly ViewportName[];
  langs: readonly string[];
  settle?: number;
  /** Presses to run before the shot — `data-key` values or button labels. */
  drive?: readonly string[];
}[] = [
  { id: 'idle', query: 'phase=0', views: ['phone', 'kiosktall', 'kioskwide'], langs: ['en'] },
  { id: 'chosen', query: 'chosen=1', views: ['kiosktall', 'kioskwide'], langs: ['zh-Hant', 'zh-Hans', 'es'] },
  { id: 'chosen-nomatch', query: 'chosen=1&buffer=Zzz&nomatch=1', views: ['kiosktall'], langs: ['zh-Hant', 'es'] },
  { id: 'typed', query: 'buffer=Alva&present=2', views: ['phone', 'kiosktall', 'kioskwide'], langs: ['en'] },
  /* Two letters of an English name the family knows only as a sound: the
     rows carry the Chinese name the roster holds, which is what a reader who
     cannot spell recognises. */
  { id: 'typed-zh', query: 'buffer=Be', views: ['phone', 'kiosktall'], langs: ['en'] },
  { id: 'chosen-typed', query: 'chosen=1&buffer=Be', views: ['kiosktall'], langs: ['zh-Hant', 'es'] },
  { id: 'nomatch', query: 'buffer=Zzz&nomatch=1', views: ['kiosktall'], langs: ['en'] },
  { id: 'photo-idle', query: 'photo=1&icon=church&phase=0', views: ['kiosktall', 'kioskwide'], langs: ['en'], settle: 1900 },
  { id: 'photo-light', query: 'photo=1&icon=church&ground=light&phase=0', views: ['kiosktall'], langs: ['en'], settle: 1900 },
];

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
};
const only = flag('--only')?.split(',').filter(Boolean) ?? null;
const langs = flag('--lang')?.split(',').filter(Boolean) ?? ['en', 'zh-Hant', 'zh-Hans', 'es'];
const views = (flag('--view')?.split(',').filter(Boolean) ?? ['kiosktall']) as ViewportName[];
const variants = flag('--variant')?.split(',').filter(Boolean) ?? ['shipped'];
const outDir = resolve(flag('--out') ?? 'uxr/renders/kiosk-language');
await mkdir(outDir, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));

/* The project's own config, as `uxr/kiosk-live/shoot.ts` uses it: nothing is
   aliased here, so the stylesheet and the components are the app's. */
const server = await createServer({
  root: projectRoot,
  server: { port: 5198, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = 'http://127.0.0.1:5198/uxr/kiosk-language/index.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const written: string[] = [];
const sideways: string[] = [];

async function drive(page: Page, presses: readonly string[]): Promise<void> {
  for (const press of presses) {
    const key = page.locator(`[data-key="${press}"]`).first();
    const target =
      (await key.count()) > 0
        ? key
        : (await page.getByRole('button', { name: press, exact: true }).count()) > 0
          ? page.getByRole('button', { name: press, exact: true }).first()
          : page.getByRole('button', { name: press }).first();
    const box = await target.boundingBox();
    const at = {
      pointerId: 1,
      isPrimary: true,
      clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    };
    await target.dispatchEvent('pointerdown', at);
    await target.dispatchEvent('pointerup', at);
    await page.waitForTimeout(60);
  }
}

for (const variant of variants) {
  /* `voices@zh-Hant+es`: the candidate, and the lobby's pins. */
  const [id, pinned] = variant.split('@') as [string, string | undefined];
  const pins = pinned?.split('+').filter(Boolean).join(',');
  for (const scene of SCENES) {
    if (only && !only.some((needle) => scene.id.includes(needle))) continue;
    for (const lang of scene.langs.filter((candidate) => langs.includes(candidate))) {
      for (const view of scene.views.filter((candidate) => views.includes(candidate))) {
        const { width, height, scale } = VIEWPORTS[view];
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: scale,
          colorScheme: 'dark',
          hasTouch: true,
          isMobile: true,
          locale: lang,
        });
        const page = await context.newPage();
        const query = [
          scene.query,
          `lang=${lang}`,
          id === 'shipped' ? '' : `variant=${id}`,
          pins ? `pins=${pins}` : '',
        ]
          .filter(Boolean)
          .join('&');
        await page.goto(`${base}?${query}`, { waitUntil: 'networkidle' });
        /*
         * The Chinese slice arrives by `import()` after the first paint. The
         * document's `lang` follows the provider's locale on the same effect
         * tick the import starts on, and the words follow the import; waiting
         * for both is what keeps an English frame from being filed as Chinese.
         */
        await page.waitForFunction(
          (expected) => document.documentElement.lang === expected,
          isLocale(lang) ? lang : 'en',
        );
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(scene.settle ?? 300);
        if (scene.drive) await drive(page, scene.drive);

        const overflows = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        const stem = `${scene.id}--${view}--${lang}--${variant}`;
        if (overflows) sideways.push(stem);

        const frame = join(outDir, `${stem}-fold.png`);
        await page.screenshot({ path: frame });
        written.push(frame);
        await context.close();
      }
    }
  }
}

await browser.close();
await server.close();

await writeFile(
  join(outDir, 'index.json'),
  `${JSON.stringify(written.map((path) => basename(path)), null, 2)}\n`,
  'utf8',
);

console.log(`${written.length} frames → ${outDir}`);
if (sideways.length > 0) {
  console.error(`scrolls sideways: ${sideways.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('no frame scrolls sideways');
}
