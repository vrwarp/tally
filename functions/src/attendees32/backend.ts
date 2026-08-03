/**
 * Attendees (attendees32), as a `PeopleBackend`.
 *
 * The same shape as ../pco/backend.ts: pure delegation to this directory's
 * flows, with everything Attendees-specific — the DRF client, the family
 * folks, the infos read-modify-write, the meet enrollment — behind the seam.
 * Registered with the backend registry at module load; importing this module
 * is what makes the backend available to a deployment.
 */
import { registerA32Backend } from '../backends/registry.js';
import type { BackendContext, PeopleBackend } from '../backends/types.js';
import type { A32Config } from '../config.js';
import { BACKEND_PREFIXES } from '../generated/backendIds.js';
import { createA32Client } from './client.js';
import { a32RootEventId, importMeetHistory, listImportableMeets } from './history.js';
import {
  fetchAllergyNotes,
  fetchParentContactStatus,
  fetchPersonDetails,
  fetchRoster,
  orgSweepCacheKey,
  personDetailsCacheKey,
  searchPeople,
} from './roster.js';
import { resetSharedCache, sharedCache } from './sharedCache.js';
import {
  addParent,
  checkPerson,
  pushStudent,
  recreateStudent,
  setParentContact,
  updateStudentProfile,
} from './writes.js';

export const A32_DISPLAY_NAME = 'Attendees';

/**
 * Builds the Attendees backend for one request. Only for a configuration the
 * registry judged enabled — same contract as the Planning Center factory.
 */
export function createA32Backend(args: BackendContext & { config: A32Config }): PeopleBackend {
  const { db, config } = args;
  const client = createA32Client({ token: config.token, baseUrl: config.baseUrl });
  const cache = sharedCache(config);

  return {
    id: 'a32',
    prefix: BACKEND_PREFIXES.a32,
    displayName: A32_DISPLAY_NAME,
    capabilities: {
      writeBack: config.writeBack,
      parentCreatable: true,
      // No merges upstream: a dead id has no forwarding address, ever.
      mergeAware: false,
      listsSupported: false,
      historyImportSupported: true,
      attendancePushSupported: false,
    },

    fetchRoster: ({ personIds, force }) => fetchRoster({ client, config, cache, personIds, force }),
    searchPeople: ({ query, limit }) => searchPeople({ client, config, query, limit }),
    fetchPersonDetails: ({ personId, force }) =>
      fetchPersonDetails({ client, config, cache, personId, force }),
    fetchAllergyNotes: ({ personIds, force }) =>
      fetchAllergyNotes({ client, config, cache, personIds, force }),
    fetchParentContactStatus: ({ personIds, force }) =>
      fetchParentContactStatus({ client, config, cache, personIds, force }),
    checkPerson: ({ personId }) => checkPerson(client, personId),

    pushStudent: ({ studentId, logger }) =>
      pushStudent({ db, client, config, cache, studentId, logger }),
    pushPendingStudents: async ({ logger, limit }) => {
      // The same sweep the Planning Center flow does, against this backend's
      // own push: every active, unlinked, queued student.
      const snapshot = await db.collection('students').get();
      const pending = snapshot.docs
        .filter((doc) => {
          const data = doc.data() ?? {};
          return (
            data.pcoPushPending === true &&
            typeof data.pcoPersonId !== 'string' &&
            typeof data.upstreamPersonId !== 'string'
          );
        })
        .slice(0, limit ?? 100);

      const result = { pushed: 0, skipped: 0, errors: 0 };
      for (const doc of pending) {
        try {
          const outcome = await pushStudent({ db, client, config, cache, studentId: doc.id, logger });
          if (outcome.status === 'skipped') result.skipped += 1;
          else result.pushed += 1;
        } catch (error) {
          result.errors += 1;
          logger?.warn?.('Pending push to Attendees failed', {
            studentId: doc.id,
            error: String(error),
          });
        }
      }
      return result;
    },
    updateStudentProfile: ({ studentId, logger, ...patch }) =>
      updateStudentProfile({ db, client, config, cache, studentId, logger, ...patch }),
    setParentContact: ({ studentId, phone, email, logger }) =>
      setParentContact({ db, client, config, cache, studentId, phone, email, logger }),
    addParent: ({ studentId, personId, firstName, lastName, phone, email, createNew, logger }) =>
      addParent({
        db,
        client,
        config,
        cache,
        studentId,
        personId,
        firstName,
        lastName,
        phone,
        email,
        createNew,
        logger,
      }),
    recreateStudent: ({ studentId, firstName, lastName, grade, logger }) =>
      recreateStudent({ db, client, config, cache, studentId, firstName, lastName, grade, logger }),

    listImportableEvents: () => listImportableMeets({ client, db }),
    importHistory: ({ upstreamEventId, uid, now, logger, existingStudentIds }) =>
      importMeetHistory({
        db,
        client,
        config,
        meetSlug: upstreamEventId,
        uid,
        now,
        logger,
        existingStudentIds,
      }),

    invalidatePersonDetails: (personId) =>
      cache.invalidate(personDetailsCacheKey(config.baseUrl, personId)),
    // The who-can-be-reached answer lives in the org sweep here, so that is
    // what a contact write drops.
    invalidateReachability: () => cache.invalidate(orgSweepCacheKey(config.baseUrl)),
    resetCache: () => resetSharedCache(),
  };
}

registerA32Backend(createA32Backend);

export { a32RootEventId };
