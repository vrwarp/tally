/**
 * A deterministic pseudo-random generator.
 *
 * Seeded rather than `Math.random()` for one reason: a property failure you
 * cannot reproduce is worse than no test at all. Every run prints its seed, and
 * `TALLY_FUZZ_SEED=<n>` replays it exactly.
 *
 * mulberry32 — 32 bits of state, good enough distribution for input generation,
 * and small enough to read and trust without a dependency.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p` (default 0.5). */
  bool(p?: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** A new array, Fisher-Yates shuffled. */
  shuffle<T>(items: readonly T[]): T[];
  /** `count` picks, with replacement. */
  sample<T>(items: readonly T[], count: number): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) return min;
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('Rng.pick called with an empty array.');
    return items[int(0, items.length - 1)]!;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };

  return {
    next,
    int,
    bool: (p = 0.5) => next() < p,
    pick,
    shuffle,
    sample: <T>(items: readonly T[], count: number): T[] =>
      items.length === 0 ? [] : Array.from({ length: Math.max(0, count) }, () => pick(items)),
  };
}

/** Reads `TALLY_FUZZ_SEED`, so CI can hand a failing seed straight to a laptop. */
export function seedFromEnv(fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.TALLY_FUZZ_SEED : undefined;
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reads `TALLY_FUZZ_RUNS`, so CI can turn the depth up without a code change. */
export function runsFromEnv(fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.TALLY_FUZZ_RUNS : undefined;
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
