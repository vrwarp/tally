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
        navigateFallbackDenylist: [/^\/__/],
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
      output: {
        /*
         * Pin the two heavy, slow-moving dependencies into their own chunks.
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
         */
        advancedChunks: {
          groups: [
            {
              name: 'firebase',
              test: /[\\/]node_modules[\\/](firebase|@firebase|@grpc|protobufjs|idb|@protobufjs|long)[\\/]/,
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
