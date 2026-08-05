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
        /*
         * The kiosk's own install surface, kept out of this worker's precache.
         *
         * The kiosk is a separate installable app with a manifest, an icon set
         * and a service worker of its own (kiosk.html, public/kiosk-sw.js), and
         * this worker owns `/`. Precaching that surface would mean a device that
         * once opened the main app answers `/kiosk.html` from *this* cache —
         * pinning a shelf screen to whatever shipped the day somebody last
         * loaded Tally on it, which is precisely the failure the kiosk's
         * no-cache page exists to rule out. The chunks under `assets/` are
         * shared and stay shared; only the entry points part company.
         */
        globIgnores: [
          'kiosk.html',
          'kiosk-sw.js',
          'kiosk.webmanifest',
          'kiosk-icon.svg',
          'icons/kiosk-icon-*.png',
        ],
        // Firestore/Auth traffic must never be served from the SW cache — the app
        // relies on live `onSnapshot` streams and the SDK's own offline persistence.
        // The kiosk and welcome entries are their own pages, deliberately
        // outside the PWA: a device that once loaded the main app must not have
        // those navigations answered with index.html from the service worker.
        // For /welcome that would be a parent's phone — quite likely a leader's
        // — opening the sign-in gate instead of the form the QR promised.
        navigateFallbackDenylist: [/^\/__/, /^\/kiosk/, /^\/welcome/],
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
        // The registration form a family fills in on their own phone, reached
        // from the QR on the kiosk. Separate again, and lighter still: it holds
        // no session and reads no documents, so no Firestore SDK reaches it.
        welcome: fileURLToPath(new URL('./welcome.html', import.meta.url)),
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
            /*
             * The SDK's shared core, peeled off ahead of everything else.
             *
             * `@firebase/app` and the plumbing under it are imported by every
             * product — app, auth, functions, both Firestores — so without a
             * group of their own they are hoisted into whichever product chunk
             * happens to claim them first. That was `firestore-lite`, which
             * made `initializeApp` cost 111 kB: the welcome page imports
             * `firebase/app` and `firebase/functions` and nothing else, and was
             * downloading the whole lite Firestore to get at it. Deliberately
             * first, because first match wins.
             */
            {
              name: 'firebase-core',
              test: /[\\/]node_modules[\\/](firebase[\\/]app|@firebase[\\/](app|component|util|logger))[\\/]/,
            },
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
