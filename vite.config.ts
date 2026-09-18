import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
// @ts-expect-error — plain Node ESM, deliberately untyped: Vite's native config
// loader needs the extension, and a `.ts` one would mean enabling
// `allowImportingTsExtensions` project-wide. See the file's own note.
import { compileMessages } from './scripts/vite-compile-messages.mjs';

/**
 * The chunks `index.html` can actually reach, taken from Rollup's own graph.
 *
 * This build emits three entries into one `assets/` directory, and for a long
 * time the comment on `globIgnores` below claimed those chunks were shared —
 * so the only thing kept out of the main app's precache was the kiosk's
 * handful of entry-point files. That claim was simply false. Most of what the
 * kiosk loads is its own: the kiosk app itself, the Brother QL printing code
 * and its raster worker, the registration flow, firestore/lite, the setup
 * page. Workbox precached all of it — a quarter of a megabyte raw that
 * `index.html` cannot reach by any path — and `src/main.tsx` calls
 * `registerSW({ immediate: true })`, so a counselor's phone began downloading
 * the kiosk the moment the roster opened, in competition with the Firestore
 * listeners the roster was waiting on, and then kept it for good. The kiosk
 * gains nothing from this: it is a separate install with its own scope and its
 * own hand-written worker.
 *
 * The filter has to work on reachability rather than on names. The obvious fix
 * — a list of chunk basenames in `globIgnores` — cannot be written correctly,
 * because the kiosk's locale slices and the main app's locale slices are
 * built from different catalogues under the same names (`es-MX-*.js`,
 * `zh-Hans-*.js`, `zh-Hant-*.js`). Any pattern that caught the kiosk's would
 * catch the app's too and quietly delete the counselors' own translations from
 * the precache, which is a failure nobody would see until a phone went offline
 * in Spanish.
 *
 * `generateBundle` runs while the bundle is still in memory and well before
 * VitePWA builds its manifest in `closeBundle`, so the set is populated by the
 * time `manifestTransforms` below reads it.
 */
const reachableFromMainApp = new Set<string>();

const recordMainAppGraph: Plugin = {
  name: 'tally:main-app-graph',
  generateBundle(_options, bundle) {
    reachableFromMainApp.clear();
    const queue = Object.values(bundle)
      .filter(
        (chunk) =>
          chunk.type === 'chunk' &&
          chunk.isEntry &&
          chunk.facadeModuleId?.endsWith('/index.html') === true,
      )
      .map((chunk) => chunk.fileName);
    while (queue.length > 0) {
      const fileName = queue.pop();
      if (fileName === undefined || reachableFromMainApp.has(fileName)) continue;
      reachableFromMainApp.add(fileName);
      const chunk = bundle[fileName];
      if (chunk?.type === 'chunk') queue.push(...chunk.imports, ...chunk.dynamicImports);
    }
  },
};

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
    compileMessages(),
    react(),
    tailwindcss(),
    // Must come before VitePWA: it is what the `manifestTransforms` below read.
    recordMainAppGraph,
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
         * no-cache page exists to rule out.
         *
         * This list is the *entry points and install files only*, matched by
         * name, and that is all it can ever be: none of these is an
         * `assets/*.js` chunk, so the reachability filter in
         * `manifestTransforms` below does not cover them. The two halves are
         * orthogonal — names here, graph there.
         *
         * This comment used to end by saying that the chunks under `assets/`
         * were shared and stayed shared, and that only the entry points parted
         * company. That was wrong, and being written down is what kept anyone
         * from checking: most of what the kiosk loads is its own code, and all
         * of it was being precached by the counselors' app. See the note on
         * `recordMainAppGraph` at the top of this file.
         */
        globIgnores: [
          'kiosk.html',
          // Precaching this would pin a staging page to whatever shipped the day
          // somebody last opened Tally on the tablet, and its whole value is
          // being current for the deployment in front of you.
          'setup.html',
          'kiosk-sw.js',
          'kiosk.webmanifest',
          'kiosk-icon.svg',
          'icons/kiosk-icon-*.png',
        ],
        /*
         * Everything under `assets/` that `index.html` cannot reach, dropped.
         *
         * Workbox globs the output directory, which in this build holds three
         * apps' chunks, so the precache it produces is filtered against the
         * graph `recordMainAppGraph` walked rather than against any pattern —
         * see the long note at the top of this file for why a name-based list
         * cannot work here.
         *
         * An empty set means the walk found no entry chunk for `index.html`,
         * which would filter every chunk out and ship a worker that precaches
         * nothing at all. Failing the build is the only honest answer: the same
         * argument scripts/check-kiosk-budget.mjs makes about its PRINTING_CHUNK
         * check, that an assertion which has quietly stopped asserting is worse
         * than none, because the build still reads as a pass.
         *
         * Restricted to `.js`. The build emits a single shared stylesheet, so
         * there is nothing for this to sort out there, and a filter that could
         * drop the app's only CSS is not worth having for no gain.
         */
        manifestTransforms: [
          (manifest) => {
            if (reachableFromMainApp.size === 0) {
              throw new Error(
                'No chunks were recorded as reachable from index.html, so this ' +
                  'transform would empty the precache. The usual cause is a Vite ' +
                  'upgrade changing what `facadeModuleId` holds for an HTML entry — ' +
                  'fix `recordMainAppGraph` in vite.config.ts rather than removing it.',
              );
            }
            return {
              manifest: manifest.filter(
                (entry) =>
                  !entry.url.startsWith('assets/') ||
                  !entry.url.endsWith('.js') ||
                  reachableFromMainApp.has(entry.url),
              ),
              warnings: [],
            };
          },
        ],
        // Firestore/Auth traffic must never be served from the SW cache — the app
        // relies on live `onSnapshot` streams and the SDK's own offline persistence.
        // The kiosk entry is its own page, deliberately outside the PWA: a
        // device that once loaded the main app must not have that navigation
        // answered with index.html from the service worker.
        navigateFallbackDenylist: [/^\/__/, /^\/kiosk/, /^\/setup/],
        runtimeCaching: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      /*
       * The ICU parser, swapped for a formatter that reads compiled messages.
       *
       * `use-intl` reaches its formatter through this bare specifier, so the
       * whole swap is this line plus the `compileMessages` plugin above — no
       * application code knows which one it got. `format-only` imports nothing
       * at all (1.9 kB minified); the module it replaces pulls in
       * `intl-messageformat`, which is 15.2 kB gzipped of grammar the browser
       * does not need to know. docs/i18n.md §4.2.
       *
       * Anchored, because a prefix match would rewrite the replacement's own
       * specifier as well.
       */
      {
        find: /^use-intl\/format-message$/,
        replacement: 'use-intl/format-message/format-only',
      },
    ],
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
        // Staging a managed tablet: a static page of values to paste into the
        // device's Chrome configuration. Its own entry for the same reason the
        // kiosk has one — it is opened on a tablet that is not yet a kiosk and
        // should not pull the app in to render a list of strings.
        setup: fileURLToPath(new URL('./setup.html', import.meta.url)),
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
             * happens to claim them first. That was `firestore-lite` once,
             * which made `initializeApp` cost 111 kB on a page that wanted two
             * callables and nothing else (the retired /welcome form was how it
             * was caught). The split still earns its keep: it is what lets the
             * kiosk's first paint carry the core without either Firestore.
             * Deliberately first, because first match wins.
             */
            {
              name: 'firebase-core',
              test: /[\\/]node_modules[\\/](firebase[\\/]app|@firebase[\\/](app|component|util|logger))[\\/]/,
            },
            /*
             * The bloom filter's helpers, claimed before either Firestore can.
             *
             * `@firebase/webchannel-wrapper/dist/bloom-blob` is two utilities
             * (`Md5` and `Integer`) that *both* Firestore builds import, and it
             * matched none of the tests here — so it was swept into whichever
             * Firestore group happened to reach it first, which was
             * `firestore-lite`. The full Firestore chunk then had to import the
             * whole lite chunk to get at them, and `index.html` duly
             * modulepreloaded 85.8 kB (25.6 kB gzipped) of an SDK the main app
             * never calls, parsed it and ran its
             * `_registerComponent('firestore/lite')` — all before a counselor's
             * first tap, on an old Android phone on church wifi. A shared module
             * with no group of its own is not neutral; it silently welds two
             * chunks together.
             *
             * Two things about this group are load-bearing:
             *
             * The name must not begin with `firestore-`. The kiosk legitimately
             * reaches this chunk, and scripts/check-kiosk-budget.mjs fails the
             * build for anything matching /^firestore-(?!lite)/ in the kiosk's
             * graph — so `firebase-bloom` and not `firestore-bloom`.
             *
             * The test must stay pinned to `dist/bloom-blob`. Widening it to all
             * of `@firebase/webchannel-wrapper` also pulls out `webchannel-blob`,
             * which only the full SDK needs; that lands in a chunk the kiosk then
             * downloads and takes its core from 208.0 to 222.5 kB gzipped.
             *
             * Deliberately ahead of both Firestore groups, because first match
             * wins and that is the entire point.
             */
            {
              name: 'firebase-bloom',
              test: /[\\/]node_modules[\\/]@firebase[\\/]webchannel-wrapper[\\/]dist[\\/]bloom-blob[\\/]/,
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
