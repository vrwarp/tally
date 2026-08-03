import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          /*
           * `restoreMocks` alone used to mean both of these. Vitest 4 narrowed
           * it to what the name says — putting back what `vi.spyOn` replaced —
           * and a bare `vi.fn()` from a `vi.mock` factory is not a spy over
           * anything, so its calls now survive into the next test. That is how
           * a test asserting a module was never read passed while the test
           * before it had read one: the calls it was shown were not its own.
           */
          restoreMocks: true,
          mockReset: true,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'rules',
          environment: 'node',
          globals: true,
          include: ['firestore-tests/**/*.test.ts'],
          // Rules tests share one emulator project and clear it between suites,
          // so they must not run in parallel. The `test:rules` script passes
          // `--no-file-parallelism`; project configs cannot set it themselves.
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
