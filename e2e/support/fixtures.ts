/**
 * Shared fixtures.
 *
 * `signedInAs` is the one every spec needs; the rest exist so a test can check
 * what actually reached Firestore rather than trusting what the screen drew.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { TEAM, signIn, type TeamRole } from './auth';
import { seedWorld } from './seed';
import {
  failSimulator,
  readCollection,
  resetSimulator,
  simulatorPeople,
  type FirestoreDoc,
} from './emulator';

export interface TallyFixtures {
  signedInAs: (role: TeamRole) => Promise<Page>;
  firestore: {
    collection: (path: string) => Promise<FirestoreDoc[]>;
    /** Polls until `predicate` holds, so a test never races an onSnapshot write. */
    until: (
      path: string,
      predicate: (docs: FirestoreDoc[]) => boolean,
      label: string,
    ) => Promise<FirestoreDoc[]>;
  };
  planningCenter: {
    reset: () => Promise<void>;
    fail: (status: number, message: string, count?: number) => Promise<void>;
    people: () => Promise<Array<Record<string, unknown>>>;
  };
}

export const test = base.extend<TallyFixtures>({
  signedInAs: async ({ page }, use) => {
    await use(async (role: TeamRole) => {
      await signIn(page, TEAM[role]);
      return page;
    });
  },

  firestore: async ({}, use) => {
    await use({
      collection: readCollection,
      until: async (path, predicate, label) => {
        const deadline = Date.now() + 15_000;
        let docs: FirestoreDoc[] = [];
        while (Date.now() < deadline) {
          docs = await readCollection(path);
          if (predicate(docs)) return docs;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        throw new Error(`Timed out waiting for ${label} in "${path}" (${docs.length} documents).`);
      },
    });
  },

  planningCenter: async ({}, use) => {
    await use({ reset: resetSimulator, fail: failSimulator, people: simulatorPeople });
    // Faults are armed per-test; leaving one armed would break whatever ran next
    // in a way that pointed at the wrong test.
    await resetSimulator();
  },
});

/**
 * Puts Firestore and the Planning Center simulator back to the seeded state.
 *
 * Call this from a `test.beforeAll` at the top of every spec file. The suite
 * mutates shared state on purpose — a check-in is a write, a sync imports people
 * who were not on the roster before, a quick-add creates a student — so a spec
 * that inherits the previous one's leftovers is asserting against a world nobody
 * designed. That shows up as a failure in the *second* spec, describing a bug
 * that is not there.
 *
 * It costs a couple of seconds per file, and it buys specs that can be run in
 * any order, alone or together, on one browser or four.
 */
export async function resetWorld(): Promise<void> {
  await seedWorld('reset');
}

export { expect, TEAM };
