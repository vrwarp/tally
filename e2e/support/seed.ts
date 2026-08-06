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
 *
 * The per-project half of that is `./reseed.setup.ts`, wired as a `dependencies`
 * project in `playwright.config.ts`. This comment described it for a while
 * before it was there, which is how the second project came to be reliably red.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { E2E } from '../../playwright.config';
import { clearFirestore, readCollection, resetSimulator, simulatorPeople } from './emulator';

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
 * Throws with an actionable message rather than letting an empty roster become
 * thirty confusing test failures that all look like application bugs.
 */
export async function seedWorld(label: string): Promise<void> {
  await clearFirestore();
  await resetSimulator();

  await run('npx', ['tsx', 'scripts/seed.ts']);

  // The roster lives in Planning Center now, so an empty `students` collection
  // is normal and proves nothing. What has to be true is that the simulator
  // holds a ministry and Firestore holds the events to check them into.
  const [people, events] = await Promise.all([simulatorPeople(), readCollection('events')]);

  if (people.length === 0) {
    throw new Error(
      'The Planning Center simulator holds nobody after seeding. Every roster in the suite ' +
        'would be empty, which reads exactly like a broken app; check scripts/seed.ts.',
    );
  }
  if (events.length === 0) {
    throw new Error(
      'Seeding produced no events. There is nothing to check anybody into; check ' +
        'scripts/seed.ts against the emulator.',
    );
  }

  console.log(
    `[e2e] ${label}: ${people.length} people in Planning Center, ${events.length} events in Firestore.`,
  );
}
