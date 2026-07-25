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
          restoreMocks: true,
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
