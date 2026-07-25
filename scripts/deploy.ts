/**
 * `npm run deploy` entry point.
 *
 * Firebase's own error messages for "not logged in" or "no project" are easy
 * to misread as a broken deploy rather than a missing one-time setup step, and
 * a build with no `.env.local` succeeds but ships an app that throws at load
 * (see `src/lib/firebase.ts`). This checks for both up front, then hands off
 * to the normal build + `firebase deploy`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const firebaserc = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
const projectId: string | undefined = firebaserc.projects?.default;
if (!projectId) {
  fail('.firebaserc has no default project configured — see the "Deployment" section in README.md.');
}

if (!existsSync(new URL('../.env.local', import.meta.url))) {
  fail(
    'No .env.local found. Copy .env.example to .env.local and fill in the Firebase web config ' +
      'from the console (Project settings -> General -> Your apps), or the deployed app ships ' +
      'with no Firebase config and fails at load.',
  );
}

function firebase(args: string[]) {
  return execFileSync('npx', ['--no-install', 'firebase', ...args], { encoding: 'utf8' });
}

let accounts: unknown[];
try {
  accounts = JSON.parse(firebase(['login:list', '--json'])).result ?? [];
} catch (err) {
  fail(
    `Could not run the Firebase CLI (${(err as Error).message}). Run \`npm install\` first ` +
      '— firebase-tools is a dev dependency, not a global install.',
  );
}

if (accounts.length === 0) {
  fail('Not logged in to the Firebase CLI. Run `npx firebase login` once, then try again.');
}

console.log(`Deploying to Firebase project "${projectId}"...\n`);
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
execFileSync('npx', ['--no-install', 'firebase', 'deploy', '--project', projectId], { stdio: 'inherit' });
