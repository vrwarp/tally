/**
 * Playwright config for the UXR capture run.
 *
 * It reuses the end-to-end stack wholesale — the same simulator, the same
 * emulators, the same seeded ministry, the same production build — because the
 * whole point of the exercise is that the prototypes are *derivations of the
 * live demo* rather than mockups drawn beside it. What it changes is the test
 * directory and the projects: two viewports, one browser, no assertions.
 *
 *   npx playwright test -c uxr/playwright.config.ts
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import base, { E2E } from '../playwright.config';

/*
 * Every server below is started from the repository root, explicitly.
 *
 * Playwright runs a `webServer` command from the directory holding the config
 * that declared it, and this config does not live at the root. `npm run build`
 * survived that (npm resolves the package root itself) but `npx vite preview`
 * did not: it served `uxr/dist`, which does not exist, and answered 404 to
 * every readiness poll until the run timed out beside a perfectly good build.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * A container that ships its own Chromium rather than Playwright's.
 *
 * The e2e suite already accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for this; the
 * capture falls back to the conventional image path as well, because a
 * walkthrough that cannot be photographed is not a failing test anybody can act
 * on — it is just a missing browser.
 */
const chromiumExecutable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);
const launchOptions = chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {};

/**
 * The two shapes the refinement is about.
 *
 * `phone` is a mid-size modern handset held one-handed at a door. `desktop` is
 * a laptop — deliberately 1440 rather than a 27-inch monitor, because 1440 is
 * the width that actually shows up and the width at which "this is a phone
 * layout centred in a sea of grey" is least deniable.
 */
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;

export default defineConfig({
  testDir: '.',
  globalSetup: '../e2e/support/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: '../test-results/uxr',
  use: { ...base.use, baseURL: E2E.baseURL },
  /*
   * The same three servers the end-to-end suite runs, with two differences that
   * only matter in a sandbox.
   *
   * The emulator's readiness is taken from Firestore rather than from the
   * Emulator UI on 4000. The UI is a zip the CLI fetches on first run, and
   * behind a filtering proxy that fetch can hang long past the point where
   * every emulator this capture actually uses is answering — so waiting on the
   * UI meant timing out beside a working stack.
   *
   * And the budgets are longer, because the first run in a fresh container pays
   * for the emulator jars, a functions build and a production Vite build before
   * anything is listening.
   */
  webServer: [
    {
      command: 'npm run pco-sim',
      url: `${E2E.simulatorUrl}/_health`,
      env: { PCO_SIM_PORT: String(E2E.planningCenter), PCO_SIM_PAGE_SIZE: '25' },
      cwd: repoRoot,
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      /*
       * The second backend's simulator, which this config does not otherwise
       * need and cannot skip: `globalSetup` is shared with the e2e suite and
       * waits for every simulator the suite can reach, so a capture without
       * this one dies before it signs in — "Attendees simulator never became
       * ready", from a config that never meant to start it. Cheaper to run the
       * process than to fork the setup.
       */
      command: 'npm run a32-sim',
      url: `${E2E.a32SimulatorUrl}/_health`,
      env: { A32_SIM_PORT: String(E2E.attendees) },
      cwd: repoRoot,
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npm run functions:build && npx firebase emulators:start --project ${E2E.projectId} --only auth,firestore,functions`,
      url: `http://127.0.0.1:${E2E.firestore}/`,
      env: {
        PCO_API_BASE_URL: `${E2E.simulatorUrl}/people/v2`,
        PCO_APP_ID: 'sim-app-id',
        PCO_SECRET: 'sim-secret',
        PCO_WRITE_BACK: 'create',
        TALLY_ADMIN_EMAILS: 'dana.ruiz@example.org',
        PCO_CACHE_TTL_SECONDS: '5',
      },
      cwd: repoRoot,
      /*
       * Never adopt an emulator suite this run did not start.
       *
       * Readiness is taken from Firestore (see above), and Firestore is the one
       * emulator that reliably outlives a killed run — the CLI leaves its JVM
       * behind. So a leftover answers on 8080, Playwright concludes the stack is
       * up, skips starting it, and `globalSetup` then dies on Auth. That cost
       * this capture two runs, and the second time it was a *silent* hazard: had
       * Auth happened to survive too, the exercise would have photographed the
       * app against a stale seed and nothing would have said so.
       *
       * With reuse off, a leftover is a port-in-use error naming the port. A
       * loud failure beats a wrong capture, and this config is a photographer,
       * not an inner-loop test run.
       */
      reuseExistingServer: false,
      timeout: 420_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `VITE_E2E_HOOKS=true npm run build -- --mode emulated && npx vite preview --mode emulated --port ${E2E.app} --strictPort`,
      url: E2E.baseURL,
      cwd: repoRoot,
      reuseExistingServer: true,
      timeout: 420_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'phone',
      /*
       * Touch, not merely narrow. Tally chooses between its two control sizes
       * on `@media (pointer: fine)` rather than on width, so a phone-sized
       * window driven by a mouse freezes the *pointer* design into the phone
       * prototype. `uxr/shoot.ts` renders these files under the same flags.
       */
      use: { ...devices['Desktop Chrome'], ...launchOptions, viewport: VIEWPORTS.phone, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], ...launchOptions, viewport: VIEWPORTS.desktop, deviceScaleFactor: 1 },
    },
  ],
});
