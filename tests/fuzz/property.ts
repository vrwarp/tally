/**
 * A very small property-test runner.
 *
 * The only thing it does that a `for` loop does not: when a property fails, it
 * reports the seed, the run index and the offending input. Without those three,
 * a fuzz failure is a puzzle rather than a bug report.
 */
import { expect, it } from 'vitest';
import { createRng, runsFromEnv, seedFromEnv, type Rng } from './prng';

export interface PropertyOptions {
  /** Defaults to 200, overridable with `TALLY_FUZZ_RUNS`. */
  runs?: number;
  /** Defaults to a stable per-property seed, overridable with `TALLY_FUZZ_SEED`. */
  seed?: number;
}

/** A stable seed derived from the property's name, so each one explores differently. */
function seedFor(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function describeValue(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, inner: unknown) => {
        if (inner instanceof Date) return `Date(${inner.toISOString()})`;
        if (inner instanceof Set) return `Set(${[...inner].join(', ')})`;
        if (inner instanceof Map) return `Map(${[...inner.keys()].join(', ')})`;
        if (typeof inner === 'number' && !Number.isFinite(inner)) return String(inner);
        return inner;
      },
      2,
    );
  } catch {
    // A generated value can contain a cycle, and losing the whole report to a
    // serialiser failure would be a poor trade.
    return String(value);
  }
}

/**
 * Registers a vitest test that runs `check` against `runs` generated values.
 *
 * The first failure stops the run and throws with everything needed to replay it.
 */
export function forAll<T>(
  name: string,
  generate: (rng: Rng) => T,
  check: (value: T, rng: Rng) => void,
  options: PropertyOptions = {},
): void {
  const seed = seedFromEnv(options.seed ?? seedFor(name));
  const runs = runsFromEnv(options.runs ?? 200);

  it(`${name} [${runs} runs, seed ${seed}]`, () => {
    for (let index = 0; index < runs; index += 1) {
      // Each run gets its own generator derived from the seed, so run 137 is
      // reproducible without replaying the 136 before it.
      const rng = createRng(seed + index * 2654435761);
      let value: T;
      try {
        value = generate(rng);
      } catch (cause) {
        throw new Error(
          `Generator for "${name}" threw on run ${index} (seed ${seed}):\n${String(cause)}`,
        );
      }

      try {
        check(value, rng);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Property "${name}" failed on run ${index}.\n\n` +
            `Reproduce with:  TALLY_FUZZ_SEED=${seed} npm test\n\n` +
            `Input:\n${describeValue(value)}\n\n` +
            `Failure:\n${message}`,
        );
      }
    }
    expect(true).toBe(true);
  });
}
