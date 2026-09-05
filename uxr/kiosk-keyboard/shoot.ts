/**
 * Renders the kiosk around each candidate keyboard layout, for the critique loop.
 *
 * `uxr/kiosk-live/shoot.ts` photographs the shipping screens state by state.
 * This does the same for a handful of states, once per layout in
 * `Keyboard.variants.tsx`, by aliasing every import of `components/Keyboard`
 * to that file and choosing the layout with `?kb=<id>` — so the frame is the
 * real `SearchScreen` or `RegistrationFlow` around a candidate board, not a
 * drawing of one.
 *
 *   npx tsx uxr/kiosk-keyboard/shoot.ts [--out uxr/renders/kb-r01]
 *                                       [--kb current,centered] [--only search]
 *
 * For every frame it writes:
 *   <scene>--<view>--<kb>-fold.png   the whole glass
 *   <scene>--<view>--<kb>-keys.png   the board alone, from its top edge down
 * and, per (scene, view), a contact sheet of every layout's board with its
 * caption — `sheet--<scene>--<view>.png` — so a critic can hold seven
 * candidates in one look before opening any of them at size.
 *
 * `metrics.json` records what a screenshot cannot be trusted to show: every
 * key's box in CSS pixels, row by row, and for the bottom row the bar's centre
 * against the board's midline and each key's width against a letter's. The
 * complaint that started the campaign is a geometry complaint; the numbers
 * are how a round proves it answered.
 *
 * Every frame is checked for sideways scroll, as the kiosk shooter checks it,
 * because a row that is wider than the glass takes the grid with it and the
 * frame looks the same either way.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
 * The states a bottom row has to be right in.
 *
 * The idle search screen is the frame in the complaint. The typed one carries
 * a space in the buffer, because a bar nobody can be seen using is a bar whose
 * job is easy to forget. Registration is the other screen this board lives on,
 * with the shift key that changes the Z row's left flank — a layout that
 * balances on search can list on register. The photograph turns the keys to
 * glass, and a wider bar is a wider pane of it.
 */
const SCENES: {
  id: string;
  query: string;
  views: readonly ViewportName[];
  settle?: number;
  drive?: readonly string[];
}[] = [
  { id: 'search-idle', query: '', views: ['phone', 'kiosktall', 'kioskwide'] },
  { id: 'search-typed', query: 'buffer=Ramona+Al&present=2', views: ['phone', 'kiosktall'] },
  {
    id: 'register-typing',
    query: 'screen=register',
    views: ['phone', 'kiosktall', 'kioskwide'],
    drive: ['R', 'O', 'B', 'I', 'N'],
  },
  {
    /*
     * The wizard's free-text step — "Peanuts tree nuts" — five spaces in a
     * row, the highest-volume space typing on the kiosk and the one field
     * where a stray ’ or - is kept rather than refused. The journey
     * consultation found it missing from round 1; every other scene presses
     * the bar at most once.
     */
    id: 'register-allergies',
    query: 'screen=register',
    views: ['phone', 'kiosktall'],
    // A grade chip advances the wizard by itself (`chooseGrade` calls
    // `advance`), so there is no Next between it and the allergies step; the
    // one that used to be here walked straight past the board being shot.
    drive: ['R', 'O', 'Next', 'F', 'O', 'X', 'Next', '7th grade', 'P', 'E', 'A', 'N', 'U', 'T', 'S', 'space', 'T', 'R', 'E', 'E', 'space', 'N', 'U', 'T', 'S'],
  },
  { id: 'photo-idle', query: 'photo=1&icon=groups', views: ['kiosktall'], settle: 1900 },
  /*
   * The same photograph on the light ground — the one frame the staff
   * consultation asked for before it would pick a labelled bar. A leader can
   * set a gathering light from two buttons in the event editor, the ink ramp
   * flips wholesale for it, and every contrast number in rounds 1 and 2 was
   * taken on the dark ground over one picture.
   */
  { id: 'photo-light', query: 'photo=1&ground=light&icon=groups', views: ['kiosktall'], settle: 1900 },
];

/*
 * The round-2 set. Round 1's seven live on in `Keyboard.variants.tsx` and can
 * still be shot with `--kb`; these are the survivors and the shapes the round
 * asked for.
 */
const DEFAULT_LAYOUTS = [
  'current',
  'centered-grid',
  'centered-moat',
  'centered-deep',
  'flanked-twin',
  'labelled-voice',
];

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
};
const only = flag('--only');
const layouts = flag('--kb')?.split(',').filter(Boolean) ?? DEFAULT_LAYOUTS;
const outDir = resolve(flag('--out') ?? 'uxr/renders/kiosk-keyboard');
await mkdir(outDir, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const src = join(projectRoot, 'src');
const variants = join(here, 'Keyboard.variants.tsx');

/*
 * An explicit config rather than the project's own, as the other mounted
 * harnesses do: the alias is the point. Everything else is the app's build —
 * the same React plugin, the same Tailwind plugin, the same `@` — so the
 * stylesheet these frames paint with is the one the kiosk paints with.
 */
const server = await createServer({
  configFile: false,
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Relative (`../components/Keyboard`) and aliased (`@/kiosk/components/Keyboard`)
      // alike — and anchored to the whole specifier, because a regex alias
      // replaces only what it matched: `/components\/Keyboard$/` would have
      // turned `../components/Keyboard` into `..` plus an absolute path.
      { find: /^(?:\.\.\/|\.\/|@\/kiosk\/)components\/Keyboard$/, replacement: variants },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  optimizeDeps: { entries: ['uxr/kiosk-live/index.html'] },
  server: { port: 5197, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = 'http://127.0.0.1:5197/uxr/kiosk-live/index.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const written: string[] = [];
const sideways: string[] = [];

type KeyBox = { key: string; x: number; y: number; width: number; height: number };
type Metrics = {
  layout: string;
  spec: string;
  board: { x: number; width: number; height: number };
  /** Slots with no `data-key` — glass a finger can land on that does nothing — per row. */
  deadCells: number[];
  /** How many ⌫ keys the board carries; the shipped board has one. */
  backspaces: number;
  /** The vertical gap between each row and the next, in CSS px. */
  rowGutters: number[];
  rows: KeyBox[][];
  bottom: {
    /** The bar's centre minus the board's midline, in CSS px; negative is left. */
    spaceOffsetPx: number;
    spaceOffsetPct: number;
    spaceWidthPx: number;
    /** Each bottom-row key's width as a multiple of a letter key's. */
    widthsInLetters: Record<string, number>;
    letterWidthPx: number;
  };
};
const metrics: Record<string, Metrics> = {};
const summaries: Record<string, { spec: Record<string, string>; summary: string }> = {};

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

for (const kb of layouts) {
  for (const scene of SCENES) {
    if (only && !scene.id.includes(only)) continue;
    for (const view of scene.views) {
      const { width, height, scale } = VIEWPORTS[view];
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: scale,
        colorScheme: 'dark',
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      const glue = scene.query ? '&' : '';
      await page.goto(`${base}?${scene.query}${glue}kb=${kb}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(scene.settle ?? 250);
      if (scene.drive) await drive(page, scene.drive);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      const stem = `${scene.id}--${view}--${kb}`;
      if (overflows) sideways.push(stem);

      const board = page.locator('[data-kb-layout]');
      const spec = (await board.getAttribute('data-kb-spec')) ?? '';
      const summary = (await board.getAttribute('data-kb-summary')) ?? '';
      summaries[kb] ??= { spec: {}, summary };
      summaries[kb].spec[scene.id.startsWith('register') ? 'register' : 'search'] = spec;

      metrics[stem] = await page.evaluate(
        ({ layout, spec }) => {
          const root = document.querySelector<HTMLElement>('[data-kb-layout]')!;
          const rootBox = root.getBoundingClientRect();
          const rows = [...root.children].map((row) =>
            [...row.querySelectorAll<HTMLElement>('[data-key]')].map((el) => {
              const b = el.getBoundingClientRect();
              return {
                key: el.dataset.key!,
                x: Math.round(b.x * 10) / 10,
                y: Math.round(b.y * 10) / 10,
                width: Math.round(b.width * 10) / 10,
                height: Math.round(b.height * 10) / 10,
              };
            }),
          );
          const deadCells = [...root.children].map((row) => row.querySelectorAll('[data-gap]').length);
          const backspaces = root.querySelectorAll('[data-key="backspace"]').length;
          const rowGutters = rows.slice(1).map((row, i) => {
            const above = rows[i]!;
            return Math.round((row[0]!.y - (above[0]!.y + above[0]!.height)) * 10) / 10;
          });
          const letter = rows[1]![0]!.width;
          const bottom = rows[rows.length - 1]!;
          const space = bottom.find((k) => k.key === 'space')!;
          const mid = rootBox.x + rootBox.width / 2;
          const spaceCentre = space.x + space.width / 2;
          const widthsInLetters: Record<string, number> = {};
          for (const k of bottom) widthsInLetters[k.key] = Math.round((k.width / letter) * 100) / 100;
          return {
            layout,
            spec,
            board: { x: Math.round(rootBox.x), width: Math.round(rootBox.width), height: Math.round(rootBox.height) },
            deadCells,
            backspaces,
            rowGutters,
            rows,
            bottom: {
              spaceOffsetPx: Math.round((spaceCentre - mid) * 10) / 10,
              spaceOffsetPct: Math.round(((spaceCentre - mid) / rootBox.width) * 1000) / 10,
              spaceWidthPx: space.width,
              widthsInLetters,
              letterWidthPx: letter,
            },
          };
        },
        { layout: kb, spec },
      );

      const frame = join(outDir, `${stem}-fold.png`);
      await page.screenshot({ path: frame });
      written.push(frame);

      const box = await board.boundingBox();
      if (box) {
        const top = Math.max(0, Math.floor(box.y) - 8);
        const keys = join(outDir, `${stem}-keys.png`);
        await page.screenshot({
          path: keys,
          clip: { x: 0, y: top, width, height: height - top },
        });
        written.push(keys);
      }
      await context.close();
    }
  }
}

/*
 * The contact sheets: every layout's board for one state on one glass, each
 * over its caption, laid out by a page of the same browser so nothing else has
 * to know how to composite an image.
 */
const sheetPage = await browser.newPage();
for (const scene of SCENES) {
  if (only && !scene.id.includes(only)) continue;
  for (const view of scene.views) {
    const { width, scale } = VIEWPORTS[view];
    const columns = view === 'kioskwide' ? 1 : 2;
    const cell = view === 'kioskwide' ? 0.6 : view === 'kiosktall' ? 0.55 : 1;
    const cards: string[] = [];
    for (const kb of layouts) {
      const file = join(outDir, `${scene.id}--${view}--${kb}-keys.png`);
      if (!existsSync(file)) continue;
      const data = (await readFile(file)).toString('base64');
      const m = metrics[`${scene.id}--${view}--${kb}`]!;
      const off = m.bottom.spaceOffsetPct;
      cards.push(`
        <figure>
          <figcaption>
            <b>${kb}</b>
            <span>${m.spec}</span>
            <em>bar centre ${off > 0 ? '+' : ''}${off}% of board width from the midline · bar ${Math.round(m.bottom.spaceWidthPx)}px · letter ${Math.round(m.bottom.letterWidthPx)}px · dead cells ${m.deadCells.reduce((a, b) => a + b, 0)} · ⌫ ×${m.backspaces} · gutter above bottom row ${m.rowGutters[m.rowGutters.length - 1]}px</em>
          </figcaption>
          <img src="data:image/png;base64,${data}" style="width:${Math.round((width * cell))}px" />
        </figure>`);
    }
    if (cards.length === 0) continue;
    const cellWidth = Math.round(width * cell);
    await sheetPage.setViewportSize({ width: cellWidth * columns + 24 * (columns + 1), height: 600 });
    await sheetPage.setContent(`<!doctype html>
      <html><head><meta charset="utf-8"><style>
        body { margin: 0; padding: 16px 24px 24px; background: #0b1020; color: #e6e9f2;
               font: 13px/1.35 -apple-system, Segoe UI, Roboto, sans-serif; }
        h1 { font-size: 15px; margin: 0 0 12px; color: #aab2c8; font-weight: 600; }
        main { display: grid; grid-template-columns: repeat(${columns}, ${cellWidth}px); gap: 18px 24px; }
        figure { margin: 0; }
        figcaption { display: grid; gap: 2px; margin: 0 0 6px; }
        figcaption b { font-size: 14px; }
        figcaption span { color: #cfd5e6; }
        figcaption em { color: #8b94ad; font-style: normal; font-size: 12px; }
        img { display: block; border-radius: 6px; outline: 1px solid #2a3350; }
      </style></head><body>
        <h1>${scene.id} · ${view} (${width}×${VIEWPORTS[view].height}${scale > 1 ? `, shot at ${scale}×` : ''})</h1>
        <main>${cards.join('')}</main>
      </body></html>`);
    await sheetPage.waitForTimeout(100);
    const sheet = join(outDir, `sheet--${scene.id}--${view}.png`);
    await sheetPage.screenshot({ path: sheet, fullPage: true });
    written.push(sheet);
  }
}
await sheetPage.close();

await browser.close();
await server.close();

await writeFile(join(outDir, 'index.json'), `${JSON.stringify(written.map((p) => basename(p)), null, 2)}\n`);
await writeFile(join(outDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
await writeFile(join(outDir, 'layouts.json'), `${JSON.stringify(summaries, null, 2)}\n`);

console.log(`${written.length} files → ${outDir}`);
if (sideways.length > 0) {
  console.error(`scrolls sideways: ${sideways.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('no frame scrolls sideways');
}
