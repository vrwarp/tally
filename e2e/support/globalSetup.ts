/**
 * Waits for the servers Playwright started, then seeds once.
 *
 * The seeding itself lives in ./seed.ts because it also runs before each
 * browser project — see the `seed:` projects in playwright.config.ts. What is
 * unique to this hook is the readiness checks: every one of them throws with an
 * actionable message, because a half-started emulator produces failures that
 * look exactly like application bugs and cost an hour to tell apart.
 */
import { E2E } from '../../playwright.config';
import { waitForHttp } from './emulator';
import { seedWorld } from './seed';

export default async function globalSetup(): Promise<void> {
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${E2E.firestore}/`, 'Firestore emulator'),
    waitForHttp(`http://127.0.0.1:${E2E.auth}/`, 'Auth emulator'),
    waitForHttp(`${E2E.simulatorUrl}/_health`, 'Planning Center simulator', 30_000),
    waitForHttp(`${E2E.a32SimulatorUrl}/_health`, 'Attendees simulator', 30_000),
  ]);

  // The Functions emulator is the slowest to come up and the one whose absence
  // is hardest to diagnose from a test failure: `provisionAccess` would simply
  // never resolve and every sign-in would time out.
  await waitForHttp(`http://127.0.0.1:${E2E.functions}/`, 'Functions emulator');

  await seedWorld('global setup');
}
