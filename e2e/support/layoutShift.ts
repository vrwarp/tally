/**
 * Watching the screen hold still — or fail to.
 *
 * The complaint this instrument exists for: a leader opens a screen, starts
 * reading it, and then a slow Planning Center answer lands and everything they
 * were reading moves. The rest of the suite waits for screens to settle before
 * looking at them, which is exactly why it can never see this; these helpers
 * look *during*.
 *
 * Three probes, installed into the page before it loads:
 *
 *  - A `layout-shift` PerformanceObserver — the browser's own account of what
 *    moved, when, and by how much, element by element. This is the headline:
 *    an entry here is a thing a person watched jump.
 *  - A ResizeObserver over every element on screen, armed at a moment the spec
 *    chooses. Layout-shift names what *moved*; this names what *grew*, which
 *    is usually the cause sitting one line above the effect.
 *  - A cheap quiet-clock (mutations + shifts bump a timestamp), so a spec can
 *    wait for "nothing has changed for N ms" instead of sleeping and hoping.
 *
 * Chromium only: WebKit ships no `layout-shift` entry type. The property being
 * protected is not browser-specific — a screen that holds still in Chromium
 * holds still in Safari, because the fix is sizing, not timing.
 */
import type { Page } from '@playwright/test';

/** One element a layout shift displaced, as the browser attributed it. */
export interface ShiftSource {
  selector: string;
  previousRect: Rect;
  currentRect: Rect;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One layout-shift entry: a moment where things on screen moved. */
export interface ShiftEntry {
  /** Milliseconds since navigation (performance.now timeline). */
  at: number;
  /** The entry's score — fraction of viewport affected × distance moved. */
  value: number;
  /** True within 500ms of user input; those are expected and excluded. */
  hadRecentInput: boolean;
  sources: ShiftSource[];
}

/** One element that changed size between arming and reading. */
export interface ResizeRecord {
  selector: string;
  from: { w: number; h: number };
  to: { w: number; h: number };
}

/** One element that ended up somewhere else than it started. */
export interface MoveRecord {
  selector: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** A named instant, for attributing shifts to before/after a release. */
export interface PhaseMark {
  name: string;
  at: number;
}

export interface StabilityReadout {
  shifts: ShiftEntry[];
  resizes: ResizeRecord[];
  /**
   * What moved between each pair of marks, keyed `"first→held"`, `"held→settled"`.
   *
   * The `layout-shift` entries are the verdict but not the whole picture: the
   * browser caps how many sources it attributes per entry, so the box that
   * moved furthest is not reliably among them, and nothing below the fold is
   * scored at all — right for scoring, useless for finding the cause. This is
   * measured rather than attributed, and it is what names the thing to fix.
   */
  moves: Record<string, MoveRecord[]>;
  phases: PhaseMark[];
  /** Whole-page height at each phase mark, for "the page grew N px". */
  pageHeights: Array<{ phase: string; height: number }>;
}

interface ProbeState {
  entries: ShiftEntry[];
  phases: PhaseMark[];
  pageHeights: Array<{ phase: string; height: number }>;
  lastChangeAt: number;
  resizes: Map<Element, ResizeRecord>;
  /** Phase name -> where every box on screen stood at that instant. */
  positions: Map<string, Map<Element, { x: number; y: number }>>;
  resizeObserver: ResizeObserver | null;
  describe: (node: Node | null) => string;
  capture: (phase: string) => void;
}

declare global {
  interface Window {
    __stability?: ProbeState;
  }
}

/**
 * Installs the probes into every document the page loads from here on.
 *
 * Must be called before the navigation being measured — an init script only
 * reaches documents created after it is added.
 */
export async function installStabilityProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    /**
     * A short, readable identity for an element — enough for a person reading
     * the report to find it in the source. Tailwind classes *are* the app's
     * naming scheme, so a few of them plus a text head is usually unambiguous.
     */
    const describe = (node: Node | null): string => {
      if (!node) return '(detached)';
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (!element) return `#text "${(node.textContent ?? '').trim().slice(0, 30)}"`;

      const part = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const classes = String(el.getAttribute('class') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .map((c) => `.${c}`)
          .join('');
        const label = el.getAttribute('aria-label');
        return `${tag}${id}${classes}${label ? `[aria-label="${label.slice(0, 24)}"]` : ''}`;
      };

      const chain: string[] = [];
      let cursor: Element | null = element;
      while (cursor && cursor !== document.body && chain.length < 3) {
        chain.unshift(part(cursor));
        cursor = cursor.parentElement;
      }
      const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${chain.join(' > ')}${text ? ` :text("${text}")` : ''}`;
    };

    const state: ProbeState = {
      entries: [],
      phases: [],
      pageHeights: [],
      lastChangeAt: performance.now(),
      resizes: new Map(),
      positions: new Map(),
      resizeObserver: null,
      describe,
      capture: () => {},
    };
    window.__stability = state;

    const round = (n: number) => Math.round(n * 10) / 10;
    const toRect = (r: DOMRectReadOnly) => ({
      x: round(r.x),
      y: round(r.y),
      w: round(r.width),
      h: round(r.height),
    });

    interface LayoutShiftAttribution {
      node: Node | null;
      previousRect: DOMRectReadOnly;
      currentRect: DOMRectReadOnly;
    }
    interface LayoutShift extends PerformanceEntry {
      value: number;
      hadRecentInput: boolean;
      sources?: LayoutShiftAttribution[];
    }

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LayoutShift[]) {
          state.lastChangeAt = performance.now();
          state.entries.push({
            at: Math.round(entry.startTime),
            value: entry.value,
            hadRecentInput: entry.hadRecentInput,
            sources: (entry.sources ?? []).map((source) => ({
              selector: describe(source.node),
              previousRect: toRect(source.previousRect),
              currentRect: toRect(source.currentRect),
            })),
          });
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    } catch {
      // WebKit: no layout-shift. The spec skips itself there.
    }

    /** Where every laid-out box stands right now, in document space. */
    const capture = (phase: string) => {
      const positions = new Map<Element, { x: number; y: number }>();
      for (const element of document.body.querySelectorAll('*')) {
        const tag = element.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') continue;
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        positions.set(element, {
          x: Math.round(box.x + window.scrollX),
          y: Math.round(box.y + window.scrollY),
        });
      }
      state.positions.set(phase, positions);
      state.phases.push({ name: phase, at: Math.round(performance.now()) });
      state.pageHeights.push({ phase, height: document.documentElement.scrollHeight });
    };
    state.capture = capture;

    // Only to know when the page has stopped changing — never read for content.
    const mutations = new MutationObserver(() => {
      state.lastChangeAt = performance.now();
    });
    const start = () =>
      mutations.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }

    /*
     * The screen's first real paint, stamped from inside the page.
     *
     * Timing this from the test does not work: `goto` resolves at the load
     * event, when the app is a spinner and a root div, and by the time anything
     * can be asked from outside, the composition worth watching has happened.
     * So the probe watches for the frame where the app has actually drawn a
     * screen — a heading, or a card — and records where everything stood.
     */
    const watchForFirstPaint = () => {
      if (state.positions.has('first')) return;
      const painted =
        document.querySelector('h1, main section, [role="status"] + *') !== null &&
        document.body.querySelectorAll('*').length >= 40;
      if (painted) {
        capture('first');
        return;
      }
      requestAnimationFrame(watchForFirstPaint);
    };
    requestAnimationFrame(watchForFirstPaint);
  });
}

/**
 * Waits until nothing on the page has shifted or mutated for `quietMs`.
 *
 * The screens under measurement are deliberately mid-load — spinners up,
 * answers held — so the suite's usual "no loading status" wait does not apply.
 * `capMs` bounds a page that never goes quiet (a CSS animation that mutates
 * attributes, say) rather than failing the test: the readout still means
 * something, it is just taken from a busier page.
 */
export async function waitForQuiet(
  page: Page,
  { quietMs = 900, capMs = 20_000 }: { quietMs?: number; capMs?: number } = {},
): Promise<void> {
  await page
    .waitForFunction(
      (quiet) => {
        const state = window.__stability;
        if (!state) return false;
        return performance.now() - state.lastChangeAt >= quiet;
      },
      quietMs,
      { timeout: capMs, polling: 100 },
    )
    .catch(() => {
      // Never went quiet inside the cap; measure the page as it is.
    });
}

/**
 * Stamps a named instant: the clock, the page's height, and where every box on
 * screen is standing.
 *
 * The positions are what make the report answer "what moved" rather than "how
 * much did the browser think moved". `layout-shift` caps how many sources it
 * attributes to an entry, so the element that travelled furthest is not
 * reliably among them — and it says nothing at all about movement below the
 * fold, which is correct for scoring and useless for finding the cause.
 */
export async function markPhase(page: Page, name: string): Promise<void> {
  await page.evaluate((phase) => {
    const state = window.__stability;
    if (!state || state.positions.has(phase)) return;
    state.capture(phase);
  }, name);
}

/**
 * Starts watching every element currently on screen for size changes.
 *
 * Arm this at the settled held-state, just before releasing the held answers:
 * anything that reports afterwards changed size *because the data landed*.
 * Elements added later are not observed — their arrival grows a parent that
 * is, which is the line the report needs anyway.
 */
export async function armResizeTracking(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__stability;
    if (!state) return;

    const observer = new ResizeObserver((entries) => {
      state.lastChangeAt = performance.now();
      for (const entry of entries) {
        const box = entry.borderBoxSize?.[0];
        const width = box ? box.inlineSize : entry.contentRect.width;
        const height = box ? box.blockSize : entry.contentRect.height;
        const known = state.resizes.get(entry.target);
        if (!known) {
          // The initial callback on observe(): this is the baseline.
          state.resizes.set(entry.target, {
            selector: state.describe(entry.target),
            from: { w: Math.round(width), h: Math.round(height) },
            to: { w: Math.round(width), h: Math.round(height) },
          });
        } else {
          known.to = { w: Math.round(width), h: Math.round(height) };
        }
      }
    });
    state.resizeObserver = observer;

    const all = document.body.querySelectorAll('*');
    let observed = 0;
    for (const element of all) {
      // Script/style/meta boxes never lay out; skipping them keeps the initial
      // callback burst proportionate to what is actually on screen.
      const tag = element.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') continue;
      observer.observe(element, { box: 'border-box' });
      observed += 1;
      if (observed >= 5000) break;
    }
  });
}

/** Reads everything the probes saw. The page is left observing; reads are idempotent. */
export async function readStability(page: Page): Promise<StabilityReadout> {
  return page.evaluate(() => {
    const state = window.__stability;
    if (!state) return { shifts: [], resizes: [], moves: {}, phases: [], pageHeights: [] };

    const resizes: ResizeRecord[] = [];
    for (const record of state.resizes.values()) {
      if (record.from.w !== record.to.w || record.from.h !== record.to.h) resizes.push(record);
    }

    /** Every box present at both marks that is not where it was. */
    const between = (fromPhase: string, toPhase: string): MoveRecord[] => {
      const before = state.positions.get(fromPhase);
      const after = state.positions.get(toPhase);
      if (!before || !after) return [];
      const moves: MoveRecord[] = [];
      for (const [element, from] of before) {
        const to = after.get(element);
        // Gone from the page is not moved: what a removed box leaves behind
        // shows up as the movement of whatever closed over the gap.
        if (!to) continue;
        if (to.x !== from.x || to.y !== from.y) {
          moves.push({ selector: state.describe(element), from, to });
        }
      }
      return moves;
    };

    const moves: Record<string, MoveRecord[]> = {};
    for (let index = 1; index < state.phases.length; index += 1) {
      const from = state.phases[index - 1]!.name;
      const to = state.phases[index]!.name;
      moves[`${from}→${to}`] = between(from, to);
    }

    return {
      shifts: state.entries,
      resizes,
      moves,
      phases: state.phases,
      pageHeights: state.pageHeights,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Making the readout speak                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether an entry describes a box that really moved.
 *
 * Chromium attributes an inserted or removed box as a source whose rect on one
 * side is `0×0` at the origin — so a card arriving at the foot of a column is
 * reported as a jump of however far down the page it landed, and scores as one.
 * Nothing is lost by ignoring those: an insertion that actually pushes the page
 * around also lists the boxes it pushed, and each of those is a box with a real
 * rect on both sides.
 */
function movedSomethingReal(entry: ShiftEntry): boolean {
  if (entry.sources.length === 0) return true;
  return entry.sources.some(
    (source) =>
      source.previousRect.w > 0 &&
      source.previousRect.h > 0 &&
      source.currentRect.w > 0 &&
      source.currentRect.h > 0,
  );
}

/** The shifts that landed at or after a phase mark, input-driven ones excluded. */
export function shiftsSincePhase(readout: StabilityReadout, phase: string): ShiftEntry[] {
  const mark = readout.phases.find((p) => p.name === phase);
  if (!mark) return [];
  return readout.shifts.filter(
    (entry) => entry.at >= mark.at && !entry.hadRecentInput && movedSomethingReal(entry),
  );
}

/** Sum of shift scores — the CLS contribution of a slice of the timeline. */
export function shiftScore(entries: readonly ShiftEntry[]): number {
  return entries.reduce((total, entry) => total + entry.value, 0);
}

/**
 * The readout as a report a person can act on: what moved, what grew, and by
 * how much — worst first, capped so a bad screen does not print a novel.
 */
export function formatReadout(
  label: string,
  entries: readonly ShiftEntry[],
  resizes: readonly ResizeRecord[],
  pageHeights: StabilityReadout['pageHeights'],
  moves: readonly MoveRecord[] = [],
): string {
  const lines: string[] = [];
  lines.push(`## ${label}`);
  lines.push(`layout-shift score: ${shiftScore(entries).toFixed(4)} across ${entries.length} shift(s)`);

  const heights = pageHeights.map((p) => `${p.phase}=${p.height}px`).join(', ');
  if (heights) lines.push(`page height: ${heights}`);

  if (moves.length > 0) {
    /*
     * Ranked by distance, and only the outermost box at each landing spot: a
     * card that drops 40px drags every word inside it the same 40px, and a
     * hundred lines saying so buries the one line that names the card.
     */
    const seen = new Set<string>();
    const worstMoves = [...moves]
      .sort(
        (a, b) =>
          Math.abs(b.to.y - b.from.y) + Math.abs(b.to.x - b.from.x) -
          (Math.abs(a.to.y - a.from.y) + Math.abs(a.to.x - a.from.x)),
      )
      .filter((move) => {
        const at = `${move.from.x},${move.from.y}→${move.to.x},${move.to.y}`;
        if (seen.has(at)) return false;
        seen.add(at);
        return true;
      })
      .slice(0, 10);

    lines.push(`moved between the two moments (${moves.length} boxes, outermost of each):`);
    for (const move of worstMoves) {
      const dx = move.to.x - move.from.x;
      const dy = move.to.y - move.from.y;
      lines.push(
        `    (${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy})px  ${move.selector}`,
      );
    }
  }

  const worst = [...entries].sort((a, b) => b.value - a.value).slice(0, 8);
  for (const entry of worst) {
    lines.push(`- shift ${entry.value.toFixed(4)} at ${entry.at}ms`);
    for (const source of entry.sources.slice(0, 4)) {
      const from = source.previousRect;
      const to = source.currentRect;
      const dy = to.y - from.y;
      const dx = to.x - from.x;
      // Both rects, not only the delta: a source that grew *and* moved, or one
      // whose "movement" is really a box appearing where another box was, is
      // unreadable from a delta alone.
      lines.push(
        `    (${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy})px` +
          `  [${from.x},${from.y} ${from.w}×${from.h}] → [${to.x},${to.y} ${to.w}×${to.h}]` +
          `  ${source.selector}`,
      );
    }
  }

  const grown = [...resizes]
    .sort(
      (a, b) =>
        Math.abs(b.to.h - b.from.h) + Math.abs(b.to.w - b.from.w) -
        (Math.abs(a.to.h - a.from.h) + Math.abs(a.to.w - a.from.w)),
    )
    .slice(0, 12);
  if (grown.length > 0) {
    lines.push(`resized elements (${resizes.length} total):`);
    for (const record of grown) {
      lines.push(
        `    ${record.from.w}×${record.from.h} → ${record.to.w}×${record.to.h}  ${record.selector}`,
      );
    }
  }

  return lines.join('\n');
}
