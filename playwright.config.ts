import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  attendees: 4011,
  app: 4173,
} as const;

const a32SimulatorUrl = `http://127.0.0.1:${PORTS.attendees}`;

/**
 * Attendees is the simulator unless `A32_ENV_FILE` names the file the real
 * server's setup command left behind (docker/attendees32/setup.sh, run by
 * docker-compose.integration.yml). Then the suite drives attendees32 itself,
 * at `A32_API_BASE_URL`, with the token and coordinates from that file.
 *
 * The token cannot travel to the Functions emulator through its environment:
 * the emulator applies `functions/.env.demo-tally` over whatever it inherits,
 * and that file names the simulator's token. `functions/.env.local` is applied
 * last and is gitignored, so a live run writes the real token there, and a
 * simulator run removes that file again if the live run wrote it.
 */
const FUNCTIONS_ENV_LOCAL = fileURLToPath(new URL('functions/.env.local', import.meta.url));
const ENV_LOCAL_MARKER = '# Written by playwright.config.ts for a live Attendees run. Safe to delete.';

function syncFunctionsEnvLocal(token: string | undefined) {
  if (token) {
    writeFileSync(FUNCTIONS_ENV_LOCAL, `${ENV_LOCAL_MARKER}\nA32_TOKEN=${token}\n`);
  } else if (existsSync(FUNCTIONS_ENV_LOCAL) && readFileSync(FUNCTIONS_ENV_LOCAL, 'utf8').startsWith(ENV_LOCAL_MARKER)) {
    unlinkSync(FUNCTIONS_ENV_LOCAL);
  }
}

function readLiveAttendees() {
  const file = process.env.A32_ENV_FILE;
  if (!file) return undefined;
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  for (const key of ['A32_TOKEN', 'A32_DIVISION_ID', 'A32_MEET_SLUG', 'A32_CHARACTER_SLUG']) {
    if (!values[key]) throw new Error(`${file} has no ${key}. Did the Attendees setup finish?`);
  }
  const baseUrl = process.env.A32_API_BASE_URL;
  if (!baseUrl) throw new Error('A32_API_BASE_URL names the Attendees server when A32_ENV_FILE is set.');
  return {
    live: true as const,
    baseUrl,
    token: values.A32_TOKEN,
    divisionId: values.A32_DIVISION_ID,
    meetSlug: values.A32_MEET_SLUG,
    // The meet's character, which the live spec needs to read the meet's roster.
    characterSlug: values.A32_CHARACTER_SLUG,
  };
}

const liveAttendees = readLiveAttendees();
syncFunctionsEnvLocal(liveAttendees?.token);

export const E2E = {
  ...PORTS,
  projectId: 'demo-tally',
  baseURL: `http://127.0.0.1:${PORTS.app}`,
  simulatorUrl: `http://127.0.0.1:${PORTS.planningCenter}`,
  a32SimulatorUrl,
  /** Where Attendees is and how to reach it: the simulator, or the real server. */
  a32: liveAttendees ?? {
    live: false as const,
    baseUrl: a32SimulatorUrl,
    token: 'a32-sim-token',
    // The coordinates the simulator's seeded organisation answers to, the
    // same ones `setup_tally_integration` prints for a real server.
    divisionId: '11',
    meetSlug: 'simorg_tally_gathering',
    characterSlug: '',
  },
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
 * The walkthrough and the tour are documentation builds, not tests: they
 * photograph the app rather than asserting on it, and they mutate the seeded
 * data as they go. They are opted in with `WALKTHROUGH=1` rather than ignored
 * outright, so they can still be run by path.
 *
 * The tour belongs here for a second reason its filename hides: it needs a
 * world nobody has touched. It walks a seeded family up to the door and checks
 * them in, so a suite that had already checked that child in left it looking at
 * a pickup button and waiting for a "Check in" that was never coming — and
 * everything it registered on the way through poisoned whatever ran after it.
 */
const SPEC_IGNORE = [
  ...(process.env.WALKTHROUGH ? [] : ['**/*walkthrough.spec.ts', '**/tour.spec.ts']),
  /*
   * The benchmarks are opted in with `KIOSK_PERF=1` (`npm run perf:kiosk`) for
   * the same reason the walkthrough is: they are not tests. They measure — a
   * throttled boot, a profiled keystroke, a roster grown to four hundred
   * children — and they take minutes to do it, mutate the seeded world on
   * purpose, and answer with a report rather than a verdict. A number that
   * gated CI on a shared runner would be silenced inside a month.
   */
  ...(process.env.KIOSK_PERF ? [] : ['**/kiosk-perf.spec.ts']),
];

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
  PCO_WRITE_BACK: 'create',
  /*
   * The bootstrap admin, exactly as a real deploy would set it.
   *
   * Deliberately only the admin: the other two roles arrive on invitations the
   * seed writes into Firestore, so the suite exercises both halves of the
   * access model — the break-glass that cannot be revoked from inside the app,
   * and the ordinary invitation that can.
   */
  TALLY_ADMIN_EMAILS: 'dana.ruiz@example.org',
  // Short but non-zero, so the suite exercises the cache rather than routing
  // around it — and so a run does not depend on `functions/.env.demo-tally`
  // being in sync with the params the code declares.
  PCO_CACHE_TTL_SECONDS: '5',
  /*
   * A retry the suite can actually watch.
   *
   * The shipped schedule starts at fifteen seconds, which is right for an API
   * that rate-limits and impossible for a test: a spec proving that a
   * rate-limited edit resumes on its own would either sleep through it or skip
   * the only interesting part. Small here for the same reason the cache TTL is
   * — so a run exercises the backoff rather than routing around it.
   */
  TALLY_EDIT_BACKOFF_MS: '250,250,250,250,250,250,250,250',
  /*
   * Nothing about Attendees. The token is in `functions/.env.demo-tally` (the
   * simulator's) or `functions/.env.local` (a live run's, see above); the
   * emulator reads those over its environment. Everything else arrives through
   * the `config/attendees32` document, which the Attendees specs write and
   * remove around themselves — so every other spec runs with the second
   * backend genuinely absent, exactly like a deployment that never set it up.
   */
  A32_CACHE_TTL_SECONDS: '5',
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
    /*
     * Every spec runs in English, and that is what keeps the suite meaningful.
     *
     * The app negotiates its language from `navigator.languages` when nobody has
     * chosen one (`detectLocale`), so a runner whose image happens to be set to
     * Chinese would put the whole suite in a catalogue nobody has reviewed and
     * fail eight hundred assertions written against the English wording. Pinned
     * here rather than in each spec, because the failure would arrive on the
     * machine that has never run them.
     *
     * `e2e/i18n.spec.ts` is the one that switches language on purpose, and it
     * does it through the control a reader would use rather than through this.
     */
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },

  /*
   * Plain projects. The reseed each one needs is a worker-scoped auto fixture
   * in `e2e/support/fixtures.ts`, not a setup project wired through
   * `dependencies` — dependencies are resolved as a graph and all of them run
   * before any dependent project starts, which puts every reseed at the front
   * of the run and leaves the second browser exactly as contaminated as before.
   */
  projects: BROWSERS.map((browser) => ({ ...browser })),

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
    // No simulator when the real server is there.
    ...(E2E.a32.live
      ? []
      : [
          {
            command: 'npm run a32-sim',
            url: `${E2E.a32SimulatorUrl}/_health`,
            env: { A32_SIM_PORT: String(PORTS.attendees) },
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            stdout: 'pipe' as const,
            stderr: 'pipe' as const,
          },
        ]),
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
      // `VITE_E2E_HOOKS` bakes in the sign-in hook the suite falls back to when
      // the browser cannot reach Google (see e2e/support/auth.ts). It is a build
      // flag rather than a runtime one so it cannot reach a real deployment.
      // `--sourcemap` under KIOSK_PERF and never otherwise: a CPU profile of the
      // shipped bundle attributes every hotspot to `kiosk-DkB2ctgC.js:1:84213`,
      // which is true and useless. The maps are emitted beside the chunks and
      // read from `dist/` by e2e/support/perf.ts; the page itself downloads a
      // `sourceMappingURL` comment and nothing more, so what is measured is
      // still the bundle a church would be served.
      command:
        `VITE_E2E_HOOKS=true npm run build -- --mode emulated${process.env.KIOSK_PERF ? ' --sourcemap' : ''}` +
        ` && npx vite preview --mode emulated --port ${PORTS.app} --strictPort`,
      url: E2E.baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
