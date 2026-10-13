import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

const ALL_TESTS = ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'];

/*
 * Which tests a mutation run gets to use.
 *
 * Stryker runs the whole suite once before it starts, to learn which test
 * covers which line, and that dry run is the fixed cost of every run — minutes,
 * because it is one process rather than the four `npm test` spreads itself
 * over. Narrowing the suite to the tests that could plausibly kill the mutants
 * being made turns a ten-minute answer into a twenty-second one, which is the
 * difference between iterating on one module and not.
 *
 * A narrowed run can only *undercount*: a mutant killed by a test outside the
 * list is reported as survived. So it is a triage tool, never the number that
 * gets published — `npm run test:mutation` runs the whole suite and is what CI
 * uses.
 */
const include = process.env.TALLY_MUTATION_TESTS
  ? process.env.TALLY_MUTATION_TESTS.split(',').map((glob) => glob.trim())
  : ALL_TESTS;

/*
 * One time zone for the whole run, and one that observes daylight saving.
 *
 * The `*.dst.test.ts` files pin `process.env.TZ` in a `beforeAll`, and under
 * `npm test` that moves the clock: each file runs in its own forked process,
 * and Node resets the time zone whenever a process's main thread assigns `TZ`.
 * Stryker runs Vitest on a single worker *thread* instead, and a worker
 * thread's `process.env` is a copy whose writes reach neither the process
 * environment nor the time zone cache. The pin is silently a no-op there, the
 * tests run in whatever zone the host has, and on a UTC runner (every GitHub
 * runner) their first assertion, "is running in a zone that observes daylight
 * saving", fails. Stryker reads any failing test in its initial run as a
 * broken setup and stops before mutating anything, which is how the weekly
 * run spent a month red.
 *
 * This file is evaluated on the main thread of each test runner process,
 * before any worker exists, so an assignment here does take: it is written to
 * the real environment and the workers inherit it. New York because two of
 * the three pinned files ask for it; the third asks for Los Angeles and
 * asserts only wall-clock times, which hold in any zone that changes its
 * clocks on the same two nights. Every other test has to hold here as well as
 * on the UTC runner `npm test` gets, so none may assume the host is UTC.
 */
process.env.TZ = 'America/New_York';

/*
 * Stryker drives Vitest directly rather than through `npm test`, and its runner
 * wants a single flat project: with `projects` set it cannot tell which one to
 * instrument, and the `rules` project needs a Firestore emulator that a
 * mutation run has no business starting. This is the `unit` project from
 * `vitest.config.ts`, flattened, and nothing else.
 */
export default defineConfig({
  resolve: { alias },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include,
    restoreMocks: true,
    mockReset: true,
    /*
     * The code under test here is Stryker's instrumented copy: every branch
     * asks which mutant is active and every statement counts itself for the
     * per-test coverage map. That is several times slower than the code
     * `npm test` runs, so Vitest's default five seconds is a budget for a
     * different program. The QR read-back tests encode and decode a symbol at
     * every version, and on a CI runner the instrumented encoder took one of
     * them past five seconds — which Stryker reads as a failing test and
     * refuses to start. Stryker's own `timeoutMS` governs mutant runs, not the
     * dry run, so the ceiling for the dry run has to be set here.
     */
    testTimeout: 30_000,
  },
});
