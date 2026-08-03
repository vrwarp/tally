/**
 * The Attendees (attendees32) simulator — an in-memory stand-in for the
 * Django server, mirroring tools/pco-simulator's two entry points:
 *
 *   - `createSimulatorFetch(store)` hands the functions tests a `fetch` the
 *     real Attendees client cannot tell from a network;
 *   - `startSimulator({port})` runs the same handler as a real HTTP server
 *     for the end-to-end suite (`npm run a32-sim`, port 4011).
 */
export { createSimulatorFetch, SIMULATOR_ORIGIN } from './fetch.js';
export { handleRequest, ATTENDANCE_CATEGORIES } from './handler.js';
export { seedDefaultOrganization } from './fixtures.js';
export { startSimulator } from './server.js';
export {
  A32SimulatorStore,
  DEFAULT_TOKEN,
  FAMILY_CATEGORY,
  HIDDEN_ROLE,
  NON_FAMILY_CATEGORY,
} from './store.js';
export type { SeedAttendeeInput, SimulatorOptions } from './store.js';
export type { AttendeeRow, Envelope, SimRequest, SimResponse } from './types.js';
