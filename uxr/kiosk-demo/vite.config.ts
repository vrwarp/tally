/**
 * The kiosk set-up demo, built to publish.
 *
 * A separate config rather than a fourth entry in the app's own: this build is
 * for a page that gets handed to somebody, so it wants `base: './'` (published
 * artifacts serve no root) and none of the PWA plumbing, and the app's build
 * should not grow an output nobody deploys.
 *
 * The ICU parser is deliberately *not* swapped out here. The app aliases
 * `use-intl/format-message` to a format-only build and compiles its catalogues
 * at build time to match; this demo skips both, pays the 15 kB, and reads the
 * same `messages/kiosk/en.json` the kiosk ships.
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: '@', replacement: fileURLToPath(new URL('../../src', import.meta.url)) }],
  },
  build: {
    outDir: fileURLToPath(new URL('../../uxr/renders/kiosk-demo-dist', import.meta.url)),
    emptyOutDir: true,
    // One file each, so the publish is three paths rather than a directory
    // listing that changes shape every time a chunk splits.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'kiosk.js',
        chunkFileNames: 'kiosk.js',
        assetFileNames: 'kiosk[extname]',
      },
    },
  },
});
