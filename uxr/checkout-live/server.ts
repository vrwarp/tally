/**
 * The Vite server both drivers of this harness mount it through — `freeze.ts`
 * (states, for the critique loop) and `walkthrough.ts` (journeys, for the
 * walkthrough page) — so the two can never disagree about what is real.
 *
 * The aliases are the whole argument: the session, the calendar/roster
 * context, the toast, the attendance listener and writes, the one-shot history
 * read, the allergy-note read, the kiosk-presence listener and the clock are
 * answered from `stubs.tsx` / `services.ts`; everything else under `@/` is
 * `src/`.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';

/** Same fallback as `uxr/shoot.ts`: an image that ships its own Chromium. */
export const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].find((path) => existsSync(path));

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = dirname(dirname(here));

export async function startHarness(port = 5199) {
  const src = join(projectRoot, 'src');
  const stubs = join(here, 'stubs.tsx');
  /*
   * `CheckInPage` still imports write services (`services/events`, and the
   * real half of `services/attendance`), which initialise Firebase at module
   * load and refuse to without a config. Emulated mode synthesises one;
   * nothing in these frames reads or writes through it, because every read and
   * every register write is aliased to the fixture.
   */
  process.env.VITE_USE_EMULATORS = 'true';
  const server = await createServer({
    configFile: false,
    root: projectRoot,
    plugins: [react(), tailwindcss()],
    // The app's compile-time flag (see `vite.config.ts`), folded off as in any
    // build that is not the end-to-end one.
    define: { __E2E_HOOKS__: 'false' },
    resolve: {
      alias: [
        { find: /^@\/context\/authContext$/, replacement: stubs },
        { find: /^@\/context\/dataContext$/, replacement: stubs },
        { find: /^@\/context\/toastContext$/, replacement: stubs },
        { find: /^@\/hooks\/useAttendance$/, replacement: stubs },
        { find: /^@\/hooks\/useEventSnapshots$/, replacement: stubs },
        { find: /^@\/hooks\/useAllergyNotes$/, replacement: stubs },
        { find: /^@\/hooks\/useNow$/, replacement: stubs },
        { find: /^@\/services\/kioskPresence$/, replacement: stubs },
        { find: /^@\/services\/attendance$/, replacement: join(here, 'services.ts') },
        { find: /^@\//, replacement: `${src}/` },
      ],
    },
    optimizeDeps: { entries: ['uxr/checkout-live/index.html'] },
    server: { port, strictPort: true },
    logLevel: 'error',
  });
  await server.listen();
  return {
    base: `http://127.0.0.1:${port}/uxr/checkout-live/index.html`,
    close: () => server.close(),
  };
}
