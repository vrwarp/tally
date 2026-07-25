/**
 * Puts the world into a known state before the first test.
 *
 * Playwright has already started the three servers by the time this runs; what
 * is left is making the data deterministic. Every failure here throws with an
 * actionable message, because a half-seeded run produces test failures that look
 * exactly like application bugs and cost an hour to tell apart.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { E2E } from '../../playwright.config';
import { clearFirestore, readCollection, resetSimulator, waitForHttp } from './emulator';

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

export default async function globalSetup(): Promise<void> {
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${E2E.firestore}/`, 'Firestore emulator'),
    waitForHttp(`http://127.0.0.1:${E2E.auth}/`, 'Auth emulator'),
    waitForHttp(`${E2E.simulatorUrl}/_health`, 'Planning Center simulator', 30_000),
  ]);

  // The Functions emulator is the slowest to come up and the one whose absence
  // is hardest to diagnose from a test failure: `provisionAccess` would simply
  // never resolve and every sign-in would time out.
  await waitForHttp(`http://127.0.0.1:${E2E.functions}/`, 'Functions emulator');

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
    `[e2e] seeded ${students.length} students, ${roster.length} team members; simulator reset.`,
  );
}
