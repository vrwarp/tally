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
      reuseExistingServer: true,
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
      use: { ...devices['Desktop Chrome'], ...launchOptions, viewport: VIEWPORTS.phone, isMobile: false, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], ...launchOptions, viewport: VIEWPORTS.desktop, deviceScaleFactor: 1 },
    },
  ],
});
