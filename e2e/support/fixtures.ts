/**
 * Shared fixtures.
 *
 * `signedInAs` is the one every spec needs; the rest exist so a test can check
 * what actually reached Firestore rather than trusting what the screen drew.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { TEAM, signIn, type TeamRole } from './auth';
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

export { expect, TEAM };
