import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The suite runs the real stack: the Planning Center simulator, the Firebase
 * Emulator Suite (auth, firestore, functions) and a production build of the app
 * served by `vite preview`. Nothing is stubbed in the browser — a check-in in
 * these tests goes through Firestore and comes back through `onSnapshot`, which
 * is the only way to prove the thing the PRD actually promises.
 *
 * Four projects, because Tally is a phone app that some people open on a laptop:
 * chromium and webkit, each at desktop and phone size.
 */

const PORTS = {
  firestore: 8080,
  auth: 9099,
  functions: 5001,
  emulatorUi: 4000,
  planningCenter: 4010,
  app: 4173,
} as const;

export const E2E = {
  ...PORTS,
  projectId: 'demo-tally',
  baseURL: `http://127.0.0.1:${PORTS.app}`,
  simulatorUrl: `http://127.0.0.1:${PORTS.planningCenter}`,
} as const;

/**
 * Some CI images ship their own browser build rather than Playwright's.
 * Without an override the suite simply cannot run there, so both browsers
 * accept an explicit executable path. See e2e/README.md.
 */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const webkitExecutable = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;

const launchOptions = (executablePath: string | undefined) =>
  executablePath ? { launchOptions: { executablePath } } : {};

/**
 * The four shapes a counselor might be holding: Chrome and Safari, phone and
 * desktop. Safari matters disproportionately — an iPhone is the single most
 * likely device at a church door — and it is also the engine most likely to
 * disagree about layout and storage.
 */
/*
 * The walkthrough is a documentation build, not a test: it photographs the app
 * rather than asserting on it, and it mutates the seeded data as it goes. It is
 * opted in with `WALKTHROUGH=1` rather than ignored outright, so it can still
 * be run by path.
 */
const SPEC_IGNORE = process.env.WALKTHROUGH ? [] : ['**/walkthrough.spec.ts'];

const BROWSERS = [
  { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...launchOptions(chromiumExecutable) } },
  { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], ...launchOptions(webkitExecutable) } },
  { name: 'chromium-mobile', use: { ...devices['Pixel 7'], ...launchOptions(chromiumExecutable) } },
  { name: 'webkit-mobile', use: { ...devices['iPhone 14'], ...launchOptions(webkitExecutable) } },
] as const;

/** Environment the Functions emulator needs to reach the simulator. */
const planningCenterEnv = {
  PCO_API_BASE_URL: `http://127.0.0.1:${PORTS.planningCenter}/people/v2`,
  PCO_APP_ID: 'sim-app-id',
  PCO_SECRET: 'sim-secret',
  PCO_ROSTER_SOURCE: 'list',
  PCO_STUDENT_LIST_ID: 'FOOTPRINTS_STUDENTS',
  PCO_COUNSELOR_LIST_ID: 'FOOTPRINTS_TEAM',
  PCO_WRITE_BACK: 'create',
};

export default defineConfig({
  testDir: './e2e',
  testIgnore: SPEC_IGNORE,
  globalSetup: './e2e/support/globalSetup.ts',

  /*
   * One emulator, one dataset, one worker. These tests mutate shared state —
   * checking a student in is a write every other test can see — so running them
   * in parallel would produce flake that reads exactly like an app bug.
   */
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: Boolean(process.env.CI),

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
      ]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  outputDir: 'test-results',

  use: {
    baseURL: E2E.baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },

  projects: BROWSERS.map(({ name, use }) => ({ name, use })),

  webServer: [
    {
      command: 'npm run pco-sim',
      url: `${E2E.simulatorUrl}/_health`,
      env: { PCO_SIM_PORT: String(PORTS.planningCenter), PCO_SIM_PAGE_SIZE: '25' },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Functions must be compiled before the emulator can load them; the
      // emulator reports a missing `lib/` as a warning and then serves nothing,
      // which surfaces much later as an unexplained callable timeout.
      command: `npm run functions:build && npx firebase emulators:start --project ${E2E.projectId} --only auth,firestore,functions`,
      url: `http://127.0.0.1:${PORTS.emulatorUi}`,
      env: planningCenterEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // A production build, not the dev server: the service worker, the code
      // splitting and the minified bundle are all things that can break only
      // once built.
      command: `npm run build -- --mode emulated && npx vite preview --mode emulated --port ${PORTS.app} --strictPort`,
      url: E2E.baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
