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
  },
});
