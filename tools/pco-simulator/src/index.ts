/**
 * A Planning Center People API simulator.
 *
 * One implementation serves two callers:
 *   - the Cloud Functions unit tests, via `createSimulatorFetch`, which lets the
 *     real client run end to end with no network;
 *   - the end-to-end suite, via `startSimulator`, which puts the same handler
 *     behind a real socket so the Functions emulator can call it.
 *
 * Sharing one fixture set between them is the point: a behaviour proved in a
 * unit test is the same behaviour the browser test exercises.
 */
export {
  createFixtureOrg,
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  FIXTURE_ANCHOR,
  FIXTURE_IDS,
  SMALL_GROUP_FIELD_SLUG,
  STUDENT_LIST_ID,
  TEAM_LIST_ID,
} from './fixtures.js';

export { SimulatorStore, type RateLimitPlan, type SimulatorOptions } from './store.js';

export { applyWhere, handleRequest, parseQuery, type QueryNode } from './handler.js';

export {
  createSimulatorFetch,
  SIMULATOR_ORIGIN,
  type SimulatorFetchOptions,
} from './fetch.js';

export {
  startSimulator,
  type RunningSimulator,
  type SimulatorServerOptions,
} from './server.js';

export type {
  SimEmail,
  SimFieldDatum,
  SimFieldDefinition,
  SimHousehold,
  SimHouseholdMembership,
  SimList,
  SimOrg,
  SimPerson,
  SimPhoneNumber,
  SimRequest,
  SimRequestLogEntry,
  SimResponse,
} from './types.js';
