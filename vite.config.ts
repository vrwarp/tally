import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  /*
   * Compile-time flag gating the end-to-end sign-in hook (see src/lib/firebase.ts).
   *
   * Set only for E2E builds — `playwright.config.ts` exports it before building —
   * so it folds to `false` everywhere else and the hook is dead-code-eliminated
   * from anything a church would deploy. A test seam that ships is not a test
   * seam, it is a way in.
   */
  define: {
    __E2E_HOOKS__: JSON.stringify(process.env.VITE_E2E_HOOKS === 'true'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png'],
      manifest: {
        name: 'Tally',
        short_name: 'Tally',
        description: 'Fast attendance check-in for a youth ministry.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Firestore/Auth traffic must never be served from the SW cache — the app
        // relies on live `onSnapshot` streams and the SDK's own offline persistence.
        // The kiosk entry is its own page, deliberately outside the PWA: a device
        // that once loaded the main app must not have /kiosk navigations answered
        // with index.html from the service worker.
        navigateFallbackDenylist: [/^\/__/, /^\/kiosk/],
        runtimeCaching: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // The Firebase SDK is a single ~585 kB vendor chunk and cannot be usefully
    // split further; warning about it on every build would only train people to
    // ignore the warning that matters.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // The self-serve check-in kiosk: its own tiny page, sharing this build
        // so the two entries split vendor chunks instead of shipping two copies.
        kiosk: fileURLToPath(new URL('./kiosk.html', import.meta.url)),
      },
      output: {
        /*
         * Pin the heavy, slow-moving dependencies into their own chunks.
         * Tally ships as a PWA that counselors keep installed for months, so an
         * app-code deploy should not invalidate the ~450 kB of Firebase SDK
         * sitting in their cache.
         *
         * Rolldown replaced the `manualChunks` map with `advancedChunks`, which
         * matches on the module's path rather than on a list of entry points.
         * The map form named the packages Tally imports and swept their
         * dependencies along; matching by path has to name those dependencies
         * too, or the SDK's transitive weight (protobuf, gRPC, idb) lands back
         * in the app chunk and every deploy invalidates it again.
         *
         * Order matters: first match wins. Full Firestore and its transitive
         * weight are peeled off *before* the catch-all firebase group, so the
         * kiosk entry — which imports firebase/firestore/lite, never
         * firebase/firestore — shares app/auth/functions with the main app
         * without downloading the ~585 kB it exists to avoid. The build asserts
         * this: see scripts/check-kiosk-budget.mjs.
         */
        advancedChunks: {
          groups: [
            {
              name: 'firestore-lite',
              test: /[\\/]node_modules[\\/](firebase[\\/]firestore[\\/]lite|@firebase[\\/]firestore[\\/]dist[\\/]lite)[\\/]/,
            },
            {
              name: 'firestore',
              test: /[\\/]node_modules[\\/](firebase[\\/]firestore|@firebase[\\/]firestore|@grpc|protobufjs|@protobufjs|long)[\\/]/,
            },
            {
              name: 'firebase',
              test: /[\\/]node_modules[\\/](firebase|@firebase|idb)[\\/]/,
            },
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
