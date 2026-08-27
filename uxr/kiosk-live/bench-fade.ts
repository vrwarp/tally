/**
 * What the results ramp costs, on the hardware the kiosk actually runs on.
 *
 * The ramp (`.kiosk-list-fade-overlay`) already has a performance history:
 * it began as a `mask-image` on the scroller, which rasterised the whole
 * region through a mask per keystroke, and was rebuilt as a painted gradient
 * overlay — a change docs/kiosk-performance.md records as "kept on that
 * mechanism", because the full harness could not resolve the overlay's cost
 * above run-to-run paint noise. This bench asks the narrower question that
 * that harness (which needs the emulator stack this sandbox cannot start —
 * Eventarc wants IPv6) cannot be brought to bear on here: with everything
 * else held identical, does the painted overlay cost a throttled device
 * anything at the two moments it exists — a keystroke repainting rows under
 * it, and the list scrolling beneath it?
 *
 * Method, in the perf suite's own shape:
 *  - a PRODUCTION build of the kiosk-live harness (real SearchScreen, real
 *    stylesheet, minified React), served statically;
 *  - Chromium with CDP `Emulation.setCPUThrottlingRate` at ×10 and ×20 — the
 *    mapping docs/kiosk-performance.md uses for a Pi 4 and a Pi 3. The
 *    throttle dilates renderer script; raster work is read from a trace
 *    instead, as raw milliseconds;
 *  - the two variants interleaved A/B/A/B within each throttle, same server,
 *    same build — `?nofade=1` display:nones the overlay, so the React tree
 *    and every other pixel stay byte-identical;
 *  - per keystroke, contact → double-rAF, the same gesture-to-paint proxy
 *    the perf suite records; per scroll, rAF frame intervals while the rows
 *    region is driven; per run, the trace's Paint/Raster/Composite totals.
 *
 *   npx tsx uxr/kiosk-live/bench-fade.ts [--rounds 3]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { build } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
const OUT = join(ROOT, 'uxr', 'renders', 'bench-fade');
mkdirSync(OUT, { recursive: true });

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const args = process.argv.slice(2);
const roundsFlag = args.indexOf('--rounds');
const ROUNDS = roundsFlag === -1 ? 3 : Number(args[roundsFlag + 1]);
const THROTTLES = [10, 20];

/*
 * Enough presses to hold rows on screen for the whole phase: every letter of
 * a name that keeps matching, then backspaces that keep matching, repeated.
 * 48 keystrokes, the same order every run.
 */
const TYPING: string[] = [];
for (let cycle = 0; cycle < 6; cycle += 1) {
  TYPING.push('A', 'L', 'V', 'A', '⌫', '⌫', 'B', '⌫');
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function serve(dir: string, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    const path = join(dir, (request.url ?? '/').split('?')[0]!);
    try {
      const body = readFileSync(path);
      response.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((ready) => server.listen(port, '127.0.0.1', () => ready(server)));
}

interface Sample {
  /** Gesture-to-paint per keystroke, ms, contact → double rAF. */
  keys: number[];
  /** rAF frame intervals while the rows region scrolls, ms. */
  scroll: number[];
  /** Trace totals over the whole run, ms of thread time. */
  paintMs: number;
  rasterMs: number;
  compositeMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function measure(page: Page, variant: 'fade' | 'nofade', port: number): Promise<Sample> {
  const query = variant === 'nofade' ? 'icon=groups&nofade=1' : 'icon=groups';
  await page.goto(`http://127.0.0.1:${port}/uxr/kiosk-live/index.html?${query}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('[data-key="A"]');
  await page.waitForTimeout(400);

  const keys: number[] = [];
  for (const press of TYPING) {
    const key = press === '⌫' ? 'backspace' : press;
    const elapsed = await page.evaluate(async (name) => {
      const target = document.querySelector<HTMLElement>(`[data-key="${name}"]`)!;
      const box = target.getBoundingClientRect();
      const at = {
        pointerId: 1,
        isPrimary: true,
        bubbles: true,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      };
      const started = performance.now();
      target.dispatchEvent(new PointerEvent('pointerdown', at));
      target.dispatchEvent(new PointerEvent('pointerup', at));
      await new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(frame)));
      return performance.now() - started;
    }, key);
    keys.push(elapsed);
    await page.waitForTimeout(50);
  }

  // Rows on screen and overflowing: 'AL' matches eleven, the screen shows
  // eight, and the region scrolls past them — under the ramp, where there is
  // one.
  await page.evaluate(() => {
    const clear = document.querySelector<HTMLElement>('[data-key="clear"]')!;
    clear.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    clear.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  });
  for (const press of ['A', 'L']) {
    await page.evaluate((name) => {
      const target = document.querySelector<HTMLElement>(`[data-key="${name}"]`)!;
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    }, press);
    await page.waitForTimeout(80);
  }

  const scroll = await page.evaluate(async () => {
    const region = document.querySelector<HTMLElement>('.overflow-y-auto')!;
    const extent = region.scrollHeight - region.clientHeight;
    const frames: number[] = [];
    let last = performance.now();
    let tick = 0;
    await new Promise<void>((done) => {
      const step = () => {
        tick += 1;
        // A triangle wave over the extent, ~2px-per-frame-throttled speed.
        const phase = (tick % 120) / 120;
        region.scrollTop = extent * (phase < 0.5 ? phase * 2 : 2 - phase * 2);
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (tick < 240) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return frames;
  });

  return { keys, scroll, paintMs: 0, rasterMs: 0, compositeMs: 0 };
}

/** Sum the trace's paint-side work, all threads. */
function traceTotals(path: string): { paintMs: number; rasterMs: number; compositeMs: number } {
  const events = (JSON.parse(readFileSync(path, 'utf8')) as { traceEvents: unknown[] })
    .traceEvents as { name?: string; dur?: number }[];
  let paint = 0;
  let raster = 0;
  let composite = 0;
  for (const event of events) {
    if (!event.dur) continue;
    if (event.name === 'Paint' || event.name === 'PrePaint') paint += event.dur;
    else if (event.name === 'RasterTask' || event.name === 'RasterizerTaskImpl') raster += event.dur;
    else if (event.name === 'CompositeLayers' || event.name === 'Commit') composite += event.dur;
  }
  return { paintMs: paint / 1000, rasterMs: raster / 1000, compositeMs: composite / 1000 };
}

const distDir = join(OUT, 'dist');
console.log('building the harness page (production)…');
await build({
  root: ROOT,
  configFile: join(ROOT, 'vite.config.ts'),
  logLevel: 'error',
  build: {
    outDir: distDir,
    emptyOutDir: true,
    rollupOptions: { input: join(HERE, 'index.html') },
  },
});

const port = 5197;
const server = await serve(distDir, port);
const browser = await chromium.launch(executablePath ? { executablePath } : {});

type Bucket = { keys: number[]; scroll: number[]; paintMs: number[]; rasterMs: number[]; compositeMs: number[] };
const results = new Map<string, Bucket>();
const bucket = (name: string): Bucket => {
  let held = results.get(name);
  if (!held) {
    held = { keys: [], scroll: [], paintMs: [], rasterMs: [], compositeMs: [] };
    results.set(name, held);
  }
  return held;
};

for (const throttle of THROTTLES) {
  for (let round = 0; round < ROUNDS; round += 1) {
    // Alternate which variant goes first, so drift cannot masquerade as a
    // difference between them.
    const order: ('fade' | 'nofade')[] = round % 2 === 0 ? ['fade', 'nofade'] : ['nofade', 'fade'];
    for (const variant of order) {
      const context = await browser.newContext({
        viewport: { width: 800, height: 1280 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

      const tracePath = join(OUT, `trace-${throttle}-${round}-${variant}.json`);
      await browser.startTracing(page, {
        path: tracePath,
        categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'],
      });
      const sample = await measure(page, variant, port);
      await browser.stopTracing();
      const totals = traceTotals(tracePath);

      const held = bucket(`${throttle}:${variant}`);
      held.keys.push(...sample.keys);
      held.scroll.push(...sample.scroll);
      held.paintMs.push(totals.paintMs);
      held.rasterMs.push(totals.rasterMs);
      held.compositeMs.push(totals.compositeMs);
      console.log(
        `×${throttle} round ${round + 1} ${variant}: key p50 ${percentile([...sample.keys].sort((a, b) => a - b), 50).toFixed(1)}ms, ` +
          `paint ${totals.paintMs.toFixed(1)}ms raster ${totals.rasterMs.toFixed(1)}ms`,
      );
      await context.close();
    }
  }
}

await browser.close();
server.close();

const median = (values: number[]): number =>
  percentile([...values].sort((a, b) => a - b), 50);

const lines: string[] = [];
lines.push('| throttle | variant | key p50 | key p95 | scroll frame p50 | scroll frames >33ms | paint (med) | raster (med) | composite (med) |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const throttle of THROTTLES) {
  for (const variant of ['fade', 'nofade'] as const) {
    const held = results.get(`${throttle}:${variant}`)!;
    const keys = [...held.keys].sort((a, b) => a - b);
    const scroll = [...held.scroll].sort((a, b) => a - b);
    const long = held.scroll.filter((frame) => frame > 33).length;
    lines.push(
      `| ×${throttle} | ${variant} | ${percentile(keys, 50).toFixed(1)}ms | ${percentile(keys, 95).toFixed(1)}ms | ` +
        `${percentile(scroll, 50).toFixed(1)}ms | ${long}/${held.scroll.length} | ` +
        `${median(held.paintMs).toFixed(1)}ms | ${median(held.rasterMs).toFixed(1)}ms | ${median(held.compositeMs).toFixed(1)}ms |`,
    );
  }
}
const report = lines.join('\n');
writeFileSync(join(OUT, 'report.md'), `${report}\n`);
console.log(`\n${report}\n\n→ ${join(OUT, 'report.md')}`);
