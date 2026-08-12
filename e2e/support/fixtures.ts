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
  patchSimulatorPerson,
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
import { seedWorld } from './seed';

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
    /** Edits somebody upstream, as the church office would, through the API. */
    patchPerson: (personId: string, attributes: Record<string, unknown>) => Promise<void>;
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

export const test = base.extend<TallyFixtures, { seededWorld: void }>({
  /**
   * One reseed per project, before its first test.
   *
   * These specs mutate shared state on purpose — checking a student in *is* a
   * write, the Planning Center spec imports people who were not there before,
   * and the kiosk spec leaves behind the families it registered. `globalSetup`
   * seeds once, which is right for whichever project runs first and wrong for
   * every one after it: the second browser walks up to a child the first
   * already checked in and waits for a "Check in" button that is correctly not
   * there. Locally that was three or four failures a run that read exactly like
   * application bugs.
   *
   * Worker-scoped, and that is the whole trick: Playwright never shares a
   * worker between projects, so a worker fixture runs exactly once per project.
   * The obvious-looking alternative — a setup project per browser, wired
   * through `dependencies` — does not work, because dependencies are resolved
   * as a graph and *all* of them run before any dependent project does. Both
   * reseeds then land back to back at the start of the run, and the second
   * browser is no better off than before.
   *
   * `auto`, so no spec has to remember to ask for it.
   */
  seededWorld: [
    async ({}, use, workerInfo) => {
      await seedWorld(`project ${workerInfo.project.name}`);
      await use();
    },
    { scope: 'worker', auto: true },
  ],

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
      patchPerson: patchSimulatorPerson,
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
