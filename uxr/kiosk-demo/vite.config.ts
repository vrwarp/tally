/**
 * Builds the live demo as one static page — `kiosk.html` and its hashed
 * assets under `./assets/` — with relative URLs, so the output can be served
 * from any folder: the walkthrough artifact publishes it as supporting files.
 *
 * The app's own config, minus the PWA plugin (a demo has no service worker to
 * install) and with the demo folder as the root. Run from the repository root
 * so Tailwind's source scan covers `src/`.
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// @ts-expect-error — plain Node ESM, deliberately untyped: it has to run
// standalone as `--check` with no toolchain around it (see tests/messages.test.ts).
import { compileMessages } from '../../scripts/vite-compile-messages.mjs';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('.'),
  base: './',
  define: { __E2E_HOOKS__: 'false' },
  plugins: [compileMessages(), react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@', replacement: here('../../src') },
      { find: /^use-intl\/format-message$/, replacement: 'use-intl/format-message/format-only' },
    ],
  },
  build: {
    outDir: process.env.KIOSK_DEMO_OUT ?? here('../renders/kiosk-demo/dist'),
    emptyOutDir: true,
    rollupOptions: { input: { kiosk: here('./kiosk.html') } },
  },
});
