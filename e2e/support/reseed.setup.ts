/**
 * Putting the world back before a browser project starts.
 *
 * The suite mutates shared state on purpose — checking a student in *is* a
 * write, the Planning Center spec imports people who were not there before, and
 * the kiosk spec leaves families it registered behind. `globalSetup` seeds once,
 * which is right for the first project and wrong for every one after it: the
 * second browser walks up to a child the first already checked in and waits for
 * a "Check in" button that is correctly not there.
 *
 * In CI that never bit, because each browser is its own job with its own
 * emulator. Locally it produced a reliable handful of second-project failures
 * that read exactly like application bugs, and cost real time to tell apart from
 * one. `e2e/support/seed.ts` has described this file since before it existed.
 *
 * Wired as a `dependencies` project per browser in `playwright.config.ts`, so it
 * runs whether the suite is invoked whole or with `--project`. Named `.setup.ts`
 * rather than `.spec.ts` so the browser projects' default `testMatch` does not
 * pick it up and run the seed a second time inside them.
 */
import { test as setup } from '@playwright/test';
import { seedWorld } from './seed';

// Long, and deliberately: this clears Firestore, resets both simulators and
// replays the whole seed script, which is a minute of work on a cold emulator.
setup.setTimeout(180_000);

setup('reseed', async () => {
  await seedWorld('browser project');
});
