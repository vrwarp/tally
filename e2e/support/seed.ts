/**
 * Putting the world into a known state.
 *
 * Split out of `globalSetup` because seeding has to happen more than once per
 * invocation. The suite mutates shared state on purpose — checking a student in
 * *is* a write, and the Planning Center spec deliberately imports people who
 * were not there before — so a second browser project running against the
 * database the first one left behind sees a roster that no longer matches what
 * the assertions were written for.
 *
 * In CI that never bites, because each browser is its own job with its own
 * emulator. Locally `npx playwright test` runs all four projects in one process,
 * and without this the second one fails in ways that read exactly like
 * application bugs.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { E2E } from '../../playwright.config';
import { clearFirestore, readCollection, resetSimulator } from './emulator';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function run(command: string, args: string[]): Promise<void> {
  return new Promise((fulfil, fail) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${E2E.firestore}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

    child.on('error', fail);
    child.on('exit', (code) => {
      if (code === 0) fulfil();
      else fail(new Error(`\`${command} ${args.join(' ')}\` exited ${code}:\n${output}`));
    });
  });
}

/**
 * Wipes Firestore and the Planning Center simulator, then reseeds both.
 *
 * Throws with an actionable message rather than letting an empty database
 * become thirty confusing test failures.
 */
export async function seedWorld(label: string): Promise<void> {
  await clearFirestore();
  await resetSimulator();

  await run('npx', ['tsx', 'scripts/seed.ts']);

  const [students, roster] = await Promise.all([
    readCollection('students'),
    readCollection('accessRoster'),
  ]);

  if (students.length === 0 || roster.length === 0) {
    throw new Error(
      `Seeding produced ${students.length} students and ${roster.length} access-roster entries. ` +
        'The suite cannot sign anyone in or show a roster; check scripts/seed.ts against the emulator.',
    );
  }

  console.log(
    `[e2e] ${label}: seeded ${students.length} students, ${roster.length} team members; simulator reset.`,
  );
}
