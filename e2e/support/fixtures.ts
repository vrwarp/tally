/**
 * Shared fixtures.
 *
 * `signedInAs` is the one every spec needs; the rest exist so a test can check
 * what actually reached Firestore rather than trusting what the screen drew.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';
import { TEAM, signIn, type TeamRole } from './auth';
import {
  clearSimulatorFaults,
  createSimulatorStudent,
  deleteDocument,
  failSimulator,
  readCollection,
  resetA32Simulator,
  resetSimulator,
  setA32Down,
  simulatorPeople,
  simulatorRequests,
  writeDocument,
  type FirestoreDoc,
} from './emulator';

export interface TallyFixtures {
  signedInAs: (role: TeamRole) => Promise<Page>;
  firestore: {
    collection: (path: string) => Promise<FirestoreDoc[]>;
    /** Removes a document, so a spec can undo a setting it changed. */
    remove: (path: string) => Promise<void>;
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
    /** Adds a student upstream, the way the church office would. */
    createStudent: (input: {
      firstName: string;
      lastName: string;
      grade: number;
      parentName?: string;
      parentPhone?: string;
      parentEmail?: string;
      allergies?: string;
      /** The same person's Attendees UUID — the `attendees_uuid` custom field. */
      attendeesUuid?: string;
    }) => Promise<void>;
    /** What the app actually asked Planning Center for. */
    requests: () => Promise<Array<{ method: string; path: string }>>;
  };
  /**
   * The second backend, off unless a spec turns it on. `enable` writes the
   * `config/attendees32` document pointing at the simulator; the fixture's
   * teardown removes it and revives the simulator, so no other spec ever sees
   * a world with two backends by accident.
   */
  attendees: {
    enable: (writeBack?: 'off' | 'create' | 'full') => Promise<void>;
    disable: () => Promise<void>;
    reset: () => Promise<void>;
    down: (down: boolean) => Promise<void>;
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
      remove: deleteDocument,
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
    await use({
      reset: resetSimulator,
      fail: failSimulator,
      people: simulatorPeople,
      createStudent: createSimulatorStudent,
      requests: simulatorRequests,
    });
    // Faults are armed per-test; leaving one armed would break whatever ran next
    // in a way that pointed at the wrong test. Only the faults are cleared —
    // resetting the organisation would replace the seeded ministry with the
    // built-in fixtures, and the roster on screen comes from here.
    await clearSimulatorFaults();
  },

  attendees: async ({}, use) => {
    let touched = false;

    await use({
      enable: async (writeBack = 'full') => {
        touched = true;
        // The coordinates the simulator's seeded organisation answers to —
        // the same ones `setup_tally_integration` prints for a real server.
        await writeDocument('config/attendees32', {
          enabled: true,
          baseUrl: E2E.a32SimulatorUrl,
          divisionId: '11',
          meetSlug: 'simorg_tally_gathering',
          characterSlug: 'simorg_tally_student',
          assemblySlug: 'simorg_tally_youth_ministry',
          writeBack,
          minGrade: 6,
          maxGrade: 12,
          cacheTtlSeconds: 5,
        });
      },
      disable: async () => {
        await deleteDocument('config/attendees32');
      },
      reset: async () => {
        touched = true;
        await resetA32Simulator();
      },
      down: async (down: boolean) => {
        touched = true;
        await setA32Down(down);
      },
    });

    // A spec that turned the second backend on leaves a single-backend world
    // behind it — configuration gone, simulator up and reseeded.
    if (touched) {
      await deleteDocument('config/attendees32');
      await setA32Down(false);
      await resetA32Simulator();
    }
  },
});

export { expect, TEAM };
