/**
 * Measuring the kiosk, rather than asserting about it.
 *
 * Everything else in `e2e/` answers "does this work". This answers "what does
 * it cost", against the same stack: a production build, the real emulators, a
 * real browser. Nothing here is a micro-benchmark — a number produced by
 * calling `searchStudents` in isolation would be a number about V8, and the
 * thing a lobby actually waits on is a keystroke crossing React, the DOM and a
 * compositor on a tablet that cost two hundred pounds.
 *
 * ## What it can see, and how
 *
 * Four instruments, deliberately independent, because each of them lies on its
 * own:
 *
 *  - **The probe** (`installProbe`) is in-page and always on: long tasks, the
 *    paint timings, and a tap→paint stopwatch hung off `pointerdown` in the
 *    capture phase. It costs nothing when nothing happens and it is the only
 *    one of the four that measures what a *finger* experiences.
 *  - **`Performance.getMetrics`** over CDP gives the main thread's own account
 *    of a phase: script, style, layout, and the task total that contains them.
 *    Cheap enough to bracket every phase with.
 *  - **The sampling profiler** gives self time per function, which is the only
 *    instrument that names a hotspot. It is also the one that changes what it
 *    measures, so it is switched on for one phase at a time and never while a
 *    latency number is being taken.
 *  - **Resource timing** separates the network from the machine. Half of a cold
 *    boot is waiting for callables, and no amount of profiling the main thread
 *    will say so.
 *
 * ## Two things that would otherwise produce confident nonsense
 *
 * **Minified frames name nothing.** A profile of the shipped bundle attributes
 * everything to `kiosk-DkB2ctgC.js:1:84213`, which is true and useless. The
 * perf build therefore emits source maps (`--sourcemap`, wired in
 * `playwright.config.ts` behind `KIOSK_PERF`) and `resolveFrames` walks them
 * back to `src/kiosk/…` and the name a human wrote. Where a map is missing the
 * frame keeps its chunk and offset rather than being dropped — a hotspot you
 * cannot name is still a hotspot.
 *
 * **A benchmark on an idle machine is a benchmark of the wrong machine.** The
 * kiosk's target is a cheap Android tablet or an old iPad on a shelf, not the
 * laptop or CI runner this runs on. `throttleCpu` is how a measurement gets
 * back into that neighbourhood; the spec takes its headline numbers throttled
 * and says so in the report.
 */
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CDPSession, Page } from '@playwright/test';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DIST = join(ROOT, 'dist');

/* -------------------------------------------------------------------------- */
/* The in-page probe                                                          */
/* -------------------------------------------------------------------------- */

/** One tap, and how long the screen took to answer it. */
export interface TapSample {
  /** The `data-key` of the key pressed, or the accessible text of the control. */
  label: string;
  /** Milliseconds from `pointerdown` to the paint that followed it. */
  ms: number;
}

/** What the page collected about itself. */
export interface Probe {
  taps: TapSample[];
  longTasks: { start: number; duration: number }[];
  firstPaint: number | null;
  firstContentfulPaint: number | null;
  largestContentfulPaint: number | null;
  /** `domContentLoadedEventEnd`, for a boot that is mostly parse. */
  domContentLoaded: number | null;
  resources: { name: string; start: number; duration: number; transferSize: number }[];
}

declare global {
  interface Window {
    __kioskPerf?: Probe;
  }
}

/**
 * Arms the page to measure itself, before any of its own scripts run.
 *
 * `addInitScript` rather than `evaluate` for the usual reason plus a sharper
 * one: the numbers worth having — first paint, the long task the Firebase chunk
 * spends parsing — all happen before a test could possibly have got a handle on
 * the page.
 */
export async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: Probe = {
      taps: [],
      longTasks: [],
      firstPaint: null,
      firstContentfulPaint: null,
      largestContentfulPaint: null,
      domContentLoaded: null,
      resources: [],
    };
    window.__kioskPerf = probe;

    /** Observers a browser may not have are skipped rather than fatal. */
    const observe = (type: string, handle: (entries: PerformanceEntryList) => void) => {
      try {
        new PerformanceObserver((list) => handle(list.getEntries())).observe({
          type,
          buffered: true,
        } as PerformanceObserverInit);
      } catch {
        /* Not supported here; the report says `null` rather than zero. */
      }
    };

    observe('longtask', (entries) => {
      for (const entry of entries) {
        probe.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    });
    observe('paint', (entries) => {
      for (const entry of entries) {
        if (entry.name === 'first-paint') probe.firstPaint = entry.startTime;
        if (entry.name === 'first-contentful-paint') probe.firstContentfulPaint = entry.startTime;
      }
    });
    observe('largest-contentful-paint', (entries) => {
      const last = entries[entries.length - 1];
      if (last) probe.largestContentfulPaint = last.startTime;
    });
    observe('navigation', (entries) => {
      const nav = entries[0] as PerformanceNavigationTiming | undefined;
      if (nav) probe.domContentLoaded = nav.domContentLoadedEventEnd;
    });
    observe('resource', (entries) => {
      for (const entry of entries) {
        const resource = entry as PerformanceResourceTiming;
        probe.resources.push({
          name: resource.name,
          start: resource.startTime,
          duration: resource.duration,
          transferSize: resource.transferSize,
        });
      }
    });

    /*
     * Tap to paint.
     *
     * Capture phase and `pointerdown`, because that is where the kiosk's own
     * handlers start counting: the keyboard commits on contact (see
     * components/Keyboard.tsx) and everything else remembers the press there
     * even though it acts on the lift.
     *
     * Two frames, not one. The first callback runs before the paint that
     * includes whatever the handler just committed; the second runs after it.
     * So the number is contact-to-pixels, which is the thing a parent standing
     * at the screen is actually waiting through — not handler duration, which
     * would flatter every result by a whole frame.
     */
    addEventListener(
      'pointerdown',
      (event) => {
        const started = performance.now();
        const target = event.target instanceof Element ? event.target.closest('[data-key], button') : null;
        const label =
          target?.getAttribute('data-key') ?? target?.textContent?.trim().slice(0, 40) ?? '(none)';
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            probe.taps.push({ label, ms: performance.now() - started });
          }),
        );
      },
      true,
    );
  });
}

/** Everything the page has collected so far. */
export async function readProbe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const probe = window.__kioskPerf;
    if (!probe) throw new Error('The perf probe is not installed on this page.');
    return JSON.parse(JSON.stringify(probe)) as Probe;
  });
}

/**
 * Drops what the probe has collected, so a phase measures only its own.
 *
 * The paint timings are left alone — they belong to the navigation and there is
 * only ever one of them. Everything that accumulates is cleared, because "long
 * tasks while typing" counted from page load is really "long tasks while
 * booting", and it reads as the former.
 */
export async function beginPhase(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.__kioskPerf;
    if (!probe) return;
    probe.taps = [];
    probe.longTasks = [];
    probe.resources = [];
  });
}

/* -------------------------------------------------------------------------- */
/* The main thread's own account                                              */
/* -------------------------------------------------------------------------- */

/** Where a phase's wall time went, as Chromium accounts for it. Milliseconds. */
export interface ThreadTime {
  task: number;
  script: number;
  style: number;
  layout: number;
  /** Heap in bytes at the end of the phase, not a delta. */
  heap: number;
}

const ZERO_THREAD_TIME: ThreadTime = { task: 0, script: 0, style: 0, layout: 0, heap: 0 };

async function threadTime(cdp: CDPSession): Promise<ThreadTime> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const of = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    // Chromium reports these in seconds; a report in seconds would be unreadable.
    task: of('TaskDuration') * 1000,
    script: of('ScriptDuration') * 1000,
    style: of('RecalcStyleDuration') * 1000,
    layout: of('LayoutDuration') * 1000,
    heap: of('JSHeapUsedSize'),
  };
}

/**
 * Runs `body` and reports what the main thread spent on it.
 *
 * The counters are cumulative since the page loaded, so this is a difference —
 * except the heap, which is a level and is reported as one.
 */
export async function measureThread<T>(
  cdp: CDPSession,
  body: () => Promise<T>,
): Promise<{ result: T; thread: ThreadTime; wall: number }> {
  await cdp.send('Performance.enable').catch(() => {});
  const before = await threadTime(cdp).catch(() => ZERO_THREAD_TIME);
  const started = Date.now();
  const result = await body();
  const wall = Date.now() - started;
  const after = await threadTime(cdp).catch(() => ZERO_THREAD_TIME);
  return {
    result,
    wall,
    thread: {
      task: after.task - before.task,
      script: after.script - before.script,
      style: after.style - before.style,
      layout: after.layout - before.layout,
      heap: after.heap,
    },
  };
}

/**
 * Slows the machine down to something a shelf device would recognise.
 *
 * A rate of 1 is "off". Chromium's throttle is a busy-wait on the main thread,
 * so it models a slower CPU and not a slower *device* — the network, the
 * compositor and the GPU are all untouched. That is the right shape here: what
 * the kiosk spends is script, and script is what this dilates.
 */
export async function throttleCpu(cdp: CDPSession, rate: number): Promise<void> {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/* -------------------------------------------------------------------------- */
/* The sampling profiler                                                      */
/* -------------------------------------------------------------------------- */

/** One function, and the time the profiler caught the thread inside it. */
export interface Hotspot {
  /** `src/kiosk/search.ts` where a source map answered, else the chunk. */
  file: string;
  /**
   * The earliest original line any sample in this frame mapped to — a pointer,
   * not a boundary.
   *
   * Here because a minifier renames most of what it does not delete: a frame
   * often arrives as `qt` with no name in the map, and `src/lib/utils.ts:412`
   * is the difference between a hotspot somebody can open and a hotspot
   * somebody shrugs at. Null for frames with no source of their own.
   */
  line: number | null;
  /** The name a human wrote, where the map carried one. */
  name: string;
  /** Milliseconds of *self* time — time in this frame, not its callees. */
  selfMs: number;
  /** Share of the profile's sampled time. */
  share: number;
}

/**
 * A CPU profile of `body`, as a table of self time by function.
 *
 * 100µs sampling: fine enough to see a keystroke, coarse enough that the
 * profiler is not the thing being profiled. Anything under a tenth of a
 * percent is dropped — with a hundred-microsecond interval those rows are one
 * or two samples, which is noise wearing a function name.
 */
export async function profile<T>(
  cdp: CDPSession,
  body: () => Promise<T>,
): Promise<{ result: T; hotspots: Hotspot[]; sampledMs: number }> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const result = await body();
  const { profile: captured } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');

  const selfMicros = new Map<number, number>();
  const samples = captured.samples ?? [];
  const deltas = captured.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index += 1) {
    const id = samples[index]!;
    // A delta is the time *before* its sample, so the last one has no sample of
    // its own; charging it to the sample it precedes is the convention DevTools
    // uses and the error is one interval either way.
    const micros = Math.max(0, deltas[index] ?? 0);
    selfMicros.set(id, (selfMicros.get(id) ?? 0) + micros);
  }

  const sampledMicros = [...selfMicros.values()].reduce((total, micros) => total + micros, 0);
  const byFrame = new Map<string, Hotspot>();
  for (const node of captured.nodes ?? []) {
    const micros = selfMicros.get(node.id) ?? 0;
    if (micros === 0) continue;
    const frame = resolveFrame(node.callFrame);
    /*
     * Keyed on the function, never on the position. Samples land all over a
     * function's body, so keying on the line would shatter one hot loop into a
     * dozen rows of two percent each — and a hotspot that has been divided by
     * twelve does not look like a hotspot. The line is kept as the earliest one
     * seen, which points at the function rather than at whichever statement the
     * sampler happened to catch.
     */
    const key = `${frame.file}#${frame.name}`;
    const held = byFrame.get(key) ?? { ...frame, selfMs: 0, share: 0 };
    held.selfMs += micros / 1000;
    if (frame.line !== null) held.line = Math.min(held.line ?? frame.line, frame.line);
    byFrame.set(key, held);
  }

  const hotspots = [...byFrame.values()]
    .map((spot) => ({ ...spot, share: sampledMicros === 0 ? 0 : (spot.selfMs * 1000) / sampledMicros }))
    .filter((spot) => spot.share >= 0.001)
    .sort((a, b) => b.selfMs - a.selfMs);

  return { result, hotspots, sampledMs: sampledMicros / 1000 };
}

/* -------------------------------------------------------------------------- */
/* Source maps                                                                */
/* -------------------------------------------------------------------------- */

interface DecodedMap {
  sources: (string | null)[];
  names: string[];
  /** Per generated line, the segments on it, sorted by generated column. */
  lines: {
    column: number;
    source: number;
    line: number;
    sourceColumn: number;
    /** Index into `names`, or -1 for a segment that names nothing. */
    name: number;
  }[][];
}

const maps = new Map<string, DecodedMap | null>();

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The mappings field, decoded.
 *
 * Written out rather than taken from a package: this needs one direction of one
 * format, the encoding is forty lines of VLQ, and the suite's dependencies are
 * the suite's to justify. See the source map v3 spec — a segment is
 * `[generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex]`, every
 * field after the first delta-encoded against the previous segment.
 */
function decodeMappings(mappings: string): DecodedMap['lines'] {
  const lines: DecodedMap['lines'] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;

  for (const encoded of mappings.split(';')) {
    const segments: DecodedMap['lines'][number] = [];
    let column = 0;
    if (encoded.length > 0) {
      for (const segment of encoded.split(',')) {
        if (segment.length === 0) continue;
        let index = 0;
        const next = (): number => {
          let shift = 0;
          let value = 0;
          let byte: number;
          do {
            byte = BASE64.indexOf(segment[index++]!);
            value += (byte & 31) << shift;
            shift += 5;
          } while (byte & 32);
          const negative = value & 1;
          value >>= 1;
          return negative ? -value : value;
        };

        column += next();
        // A one-field segment marks generated code with no origin at all.
        if (index >= segment.length) continue;
        source += next();
        sourceLine += next();
        sourceColumn += next();
        // Asked before the read, not after: `next()` moves `index` past the end
        // of the segment, so a test afterwards says "no name" for every segment
        // that has one.
        const named = index < segment.length;
        if (named) name += next();
        segments.push({
          column,
          source,
          line: sourceLine,
          sourceColumn,
          name: named ? name : -1,
        });
      }
    }
    segments.sort((a, b) => a.column - b.column);
    lines.push(segments);
  }
  return lines;
}

/** The map beside a built chunk, or null where the build emitted none. */
function mapFor(chunk: string): DecodedMap | null {
  if (maps.has(chunk)) return maps.get(chunk) ?? null;
  let decoded: DecodedMap | null = null;
  try {
    const raw = JSON.parse(readFileSync(join(DIST, 'assets', `${chunk}.map`), 'utf8')) as {
      sources: string[];
      names: string[];
      mappings: string;
    };
    decoded = {
      sources: raw.sources,
      names: raw.names,
      lines: decodeMappings(raw.mappings),
    };
  } catch {
    // No map: an unmapped frame is reported under its chunk, which is still a
    // fact, and a great many of them are V8's own (`(program)`, `(gc)`).
  }
  maps.set(chunk, decoded);
  return decoded;
}

/** The last segment at or before `column` — the one this position belongs to. */
function segmentAt(segments: DecodedMap['lines'][number], column: number) {
  let found: DecodedMap['lines'][number][number] | undefined;
  for (const segment of segments) {
    if (segment.column > column) break;
    found = segment;
  }
  return found;
}

interface Frame {
  file: string;
  name: string;
  line: number | null;
}

/**
 * A profiler frame in the terms the source was written in.
 *
 * V8 reports zero-based line and column; a source map's generated line is
 * one-based and its column is zero-based, hence the one adjustment and not two.
 */
function resolveFrame(callFrame: {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}): Frame {
  const name = callFrame.functionName || '(anonymous)';
  if (!callFrame.url) {
    /*
     * Frames with no script behind them. Three kinds, and telling them apart
     * matters when reading a table:
     *
     *  - V8's own buckets: `(program)`, `(garbage collector)`, `(idle)`. A
     *    profile that is a quarter GC is a finding. `(program)` is not: it is
     *    where V8 files compilation and the time the CPU throttle spends
     *    busy-waiting, so it grows with the throttle and says nothing.
     *  - Blink's C++ behind a DOM call — `elementsFromPoint`, `closest`.
     *  - Playwright's injected script, which resolves every locator this suite
     *    touches: `captureSnapshot`, `previewNode`, `isElementHiddenForAria`.
     *    That is the measurement, not the app — see the note in the report.
     */
    return { file: '(vm)', name, line: null };
  }

  const chunk = callFrame.url.split('/').pop() ?? callFrame.url;
  const map = mapFor(chunk);
  const segments = map?.lines[callFrame.lineNumber];
  const segment = segments ? segmentAt(segments, callFrame.columnNumber) : undefined;
  if (!map || !segment) {
    return {
      file: chunk,
      name: `${name} @${callFrame.lineNumber}:${callFrame.columnNumber}`,
      line: null,
    };
  }

  const source = (map.sources[segment.source] ?? chunk).replace(/^(\.\.\/)+/, '');
  const mapped = segment.name >= 0 ? map.names[segment.name] : undefined;
  // The map's line is zero-based; every editor a reader will open it in is not.
  return { file: source, name: mapped ?? name, line: segment.line + 1 };
}

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

/** One measured scenario. */
export interface Measurement {
  scenario: string;
  /** How the machine was set for it, so two numbers are never compared blind. */
  cpuThrottle: number;
  /** Whatever the scenario measured: milliseconds unless the key says otherwise. */
  timings: Record<string, number | null>;
  notes?: string[];
  hotspots?: Hotspot[];
  thread?: ThreadTime;
}

/**
 * Not under `test-results/`, which is Playwright's `outputDir` and is emptied
 * at the start of every run. A report the next `npm run e2e` deletes is a
 * report nobody can diff against, which is half of what it is for.
 */
const REPORT_DIR = join(ROOT, 'perf-results');

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

/**
 * Writes the run out twice: JSON to compare with, Markdown to read.
 *
 * Both, because they answer different questions. The JSON is what a later run
 * diffs against to say whether a change helped; the Markdown is what somebody
 * reads once to decide what to change.
 */
export function writeReport(measurements: Measurement[], meta: Record<string, unknown>): string {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    join(REPORT_DIR, 'kiosk-perf.json'),
    `${JSON.stringify({ meta, measurements }, null, 2)}\n`,
  );

  const lines: string[] = [
    '# Kiosk performance',
    '',
    'Measured by `e2e/kiosk-perf.spec.ts` against the same stack the rest of the',
    'suite runs on: a production build, the Firebase emulators, and the Planning',
    'Center simulator. Times are milliseconds.',
    '',
    ...Object.entries(meta).map(([key, value]) => `- **${key}**: ${String(value)}`),
    '',
    '## Reading the hotspot tables',
    '',
    '`self ms` is time the sampler caught the thread *in* that frame, not in its',
    'callees, so the rows are additive and a shallow row is a real cost.',
    '',
    'Three kinds of row are not the app, and are left in rather than filtered out',
    'because a table whose percentages do not add up to a hundred is a table',
    'nobody can reason about:',
    '',
    '- `(program)` and `(idle)` in `(vm)` are V8 and the scheduler. `(program)`',
    '  also absorbs whatever the CPU throttle spends busy-waiting, so it grows',
    '  with the throttle and means nothing on its own.',
    '- Unnamed DOM frames in `(vm)` — `elementsFromPoint`, `closest`, `query` —',
    '  are Blink C++ under a JavaScript call.',
    '- `captureSnapshot`, `previewNode`, `visitNode`, `isElementHiddenForAria`',
    '  and friends are **Playwright**, resolving the locators the scenario drives',
    '  the screen with. Measurement overhead, not kiosk cost.',
    '',
    'Everything under `src/` is the app. Where a name reads as one or two letters',
    'the minifier renamed it and the source map carried no name for that position;',
    'the file and line beside it are the ones to open.',
    '',
  ];

  for (const measurement of measurements) {
    lines.push(
      `## ${measurement.scenario}`,
      '',
      `CPU throttle ×${measurement.cpuThrottle}.`,
      '',
      '| measure | ms |',
      '| --- | ---: |',
      ...Object.entries(measurement.timings).map(([key, value]) => `| ${key} | ${ms(value)} |`),
      '',
    );
    if (measurement.thread) {
      const { task, script, style, layout, heap } = measurement.thread;
      lines.push(
        `Main thread: ${ms(task)} task, of which ${ms(script)} script, ${ms(style)} style, ` +
          `${ms(layout)} layout. Heap ${(heap / 1024 / 1024).toFixed(1)} MB.`,
        '',
      );
    }
    if (measurement.notes?.length) {
      lines.push(...measurement.notes.map((note) => `- ${note}`), '');
    }
    if (measurement.hotspots?.length) {
      lines.push(
        '| self ms | share | function | file |',
        '| ---: | ---: | --- | --- |',
        ...measurement.hotspots
          .slice(0, 20)
          .map(
            (spot) =>
              `| ${ms(spot.selfMs)} | ${(spot.share * 100).toFixed(1)}% | \`${spot.name}\` | ` +
              `${spot.file}${spot.line === null ? '' : `:${spot.line}`} |`,
          ),
        '',
      );
    }
  }

  const markdown = lines.join('\n');
  writeFileSync(join(REPORT_DIR, 'kiosk-perf.md'), `${markdown}\n`);
  return join(REPORT_DIR, 'kiosk-perf.md');
}

/** p50/p95 of a set of samples, for a latency nobody should average. */
export function percentiles(samples: readonly number[]): {
  p50: number | null;
  p95: number | null;
  max: number | null;
  count: number;
} {
  if (samples.length === 0) return { p50: null, p95: null, max: null, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]!, count: sorted.length };
}
