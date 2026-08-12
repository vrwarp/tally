/**
 * Captures the edit-queue walkthrough in every deployment shape a church can
 * be in, and stops before the two that need arranging get mixed up.
 *
 * Two of the three shapes are settings: Attendees can be switched on and off
 * from the app, so "Planning Center only" and "both connected" are two passes
 * against one emulator. The third is not a setting at all — there is
 * deliberately no in-app switch for Planning Center, because which backends
 * exist is decided by the credentials a deployment holds. A church that never
 * connected it simply has no `PCO_APP_ID`.
 *
 * Arranging that took two wrong turns worth recording. Starting the emulator
 * without those variables does nothing: the credentials come from
 * `functions/.env.demo-tally`, which the CLI loads for the project. Setting
 * them to empty strings in the environment does nothing either — the file
 * wins over the environment. What does work is `functions/.env.local`, which
 * the CLI loads last and which is git-ignored, so the override never touches
 * a tracked file and cannot be committed by accident.
 *
 *   node scripts/capture-edit-queue-walkthrough.mjs
 *
 * Playwright reuses whatever is already listening (`reuseExistingServer`
 * outside CI), which is what lets this swap the stack underneath it. The
 * emulator this starts is this script's own; anything already running on those
 * ports is left alone and the pass is run against it, so a stack you are
 * already debugging against is never silently replaced.
 */
import { spawn, spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const EMULATOR_ENV = {
  PCO_API_BASE_URL: 'http://127.0.0.1:4010/people/v2',
  PCO_APP_ID: 'sim-app-id',
  PCO_SECRET: 'sim-secret',
  PCO_WRITE_BACK: 'create',
  TALLY_ADMIN_EMAILS: 'dana.ruiz@example.org',
  PCO_CACHE_TTL_SECONDS: '5',
  TALLY_EDIT_BACKOFF_MS: '250,250,250,250,250,250,250,250',
  A32_TOKEN: 'a32-sim-token',
  A32_CACHE_TTL_SECONDS: '5',
};

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function emulatorIsUp() {
  try {
    const response = await fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Starts an emulator with the given environment and waits for it to answer.
 *
 * Returns a stop function. The credentials are the whole point of the
 * parameter: passing none is how the third shape is arranged.
 */
async function startEmulator(env) {
  const child = spawn(
    'npx',
    ['firebase', 'emulators:start', '--project', 'demo-tally', '--only', 'auth,firestore,functions'],
    { stdio: 'ignore', env: { ...process.env, ...env }, detached: true },
  );

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await emulatorIsUp()) return () => process.kill(-child.pid, 'SIGTERM');
    await sleep(2000);
  }
  process.kill(-child.pid, 'SIGTERM');
  throw new Error('The emulator never came up.');
}

const capture = (shape, project) =>
  run('npx', ['playwright', 'test', `--project=${project}`, 'e2e/edit-queue-walkthrough.spec.ts'], {
    WALKTHROUGH: '1',
    WALKTHROUGH_BACKENDS: shape,
  });

/* ---- the two shapes that share one deployment ---------------------------- */

const borrowed = await emulatorIsUp();
if (borrowed) {
  console.log('[edit-queue] using the emulator already running.');
}
const stopFirst = borrowed ? () => {} : await startEmulator(EMULATOR_ENV);

capture('pco', 'chromium-desktop');
capture('pco', 'chromium-mobile');
capture('both', 'chromium-desktop');

stopFirst();

/* ---- the shape that needs its own ---------------------------------------- */

if (borrowed) {
  console.log(
    '[edit-queue] skipping the Attendees-only pass: it needs an emulator started with no\n' +
      '            Planning Center credentials, and one was already running. Stop it and\n' +
      '            re-run to capture that section.',
  );
} else {
  /*
   * `.env.local` rather than the environment, and removed in a `finally`: a
   * capture that dies here must not leave the next emulator started against a
   * Planning Center that is switched off, which would look like the whole
   * suite had lost its credentials.
   */
  await writeFile(
    'functions/.env.local',
    '# Written by scripts/capture-edit-queue-walkthrough.mjs, removed when it finishes.\n' +
      '# A deployment that never connected Planning Center, for the third pass.\n' +
      'PCO_APP_ID=\nPCO_SECRET=\n',
    'utf8',
  );
  try {
    const stopSecond = await startEmulator(EMULATOR_ENV);
    try {
      capture('a32', 'chromium-desktop');
    } finally {
      stopSecond();
    }
  } finally {
    await rm('functions/.env.local', { force: true });
  }
}

run('npx', ['tsx', 'scripts/build-edit-queue-walkthrough.ts']);
