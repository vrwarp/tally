/**
 * Planning Center, as a `PeopleBackend`.
 *
 * Everything here is delegation: the flows in this directory have always taken
 * `{db, client, config, cache}` and done the work, and this adapter closes
 * over those once so the entry points can stop knowing what any of them are.
 * Planning Center-isms stay behind the seam on purpose — the JSON:API client,
 * the merge-following `410` handling, the Check-Ins root derived from the
 * People root, the cache keys a write has to drop. If a piece of knowledge is
 * about Planning Center rather than about Tally, this directory is where it
 * lives, and the adapter is the one door out.
 */
import {
  BackendPreconditionError,
  type BackendContext,
  type PeopleBackend,
  type PersonCheck,
} from '../backends/types.js';
import type { PcoConfig } from '../config.js';
import { SILENT_LOGGER } from '../firestore.js';
import { BACKEND_PREFIXES } from '../generated/backendIds.js';
import { checkInsBaseUrl, importCheckInsEvent, listCheckInsEvents } from './checkins.js';
import { createPcoClient, type PcoClient } from './client.js';
import { a32AliasesFromIncluded, resolveA32UuidFieldId } from './fieldData.js';
import { addParent, createFamily, findAdultCandidates } from './household.js';
import { fetchListMemberIds, fetchLists } from './lists.js';
import { setParentContact } from './parentContact.js';
import { collectPhoneLast4 } from './phoneIndex.js';
import { followPersonLink, isPersonGoneError } from './personLink.js';
import { updateStudentProfile } from './profile.js';
import { pushPendingStudents, pushStudent } from './pushStudents.js';
import { recreateStudent } from './recreate.js';
import {
  fetchAllergyNotes,
  fetchParentContactStatus,
  fetchPersonDetails,
  fetchRoster,
  personDetailsCacheKey,
  reachableAdultsCacheKey,
  searchPeople,
} from './roster.js';
import { resetSharedCache, sharedCache } from './sharedCache.js';

export const PCO_DISPLAY_NAME = 'Planning Center';

/**
 * Builds the Planning Center backend for one request.
 *
 * Only for a configuration whose `configError` is null — the registry is what
 * decides whether this backend is connected at all, and it never constructs an
 * adapter it would have to apologise for. Cheap to build: the client is a
 * closure over `fetch`, and the cache is the instance-wide one, keyed by TTL so
 * a settings change takes effect without a redeploy.
 */
export function createPcoBackend(args: BackendContext & { config: PcoConfig }): PeopleBackend {
  const { db, config } = args;
  const client = createPcoClient({
    appId: config.appId,
    secret: config.secret,
    baseUrl: config.baseUrl,
  });
  const cache = sharedCache(config);

  /**
   * Check-Ins lives beside People on the same host, so its root is derived
   * from the configured People root rather than being a second setting —
   * pointing one at the simulator points both. The same Personal Access Token
   * authenticates either product; whether it is *allowed* to read Check-Ins is
   * Planning Center's call, and comes back as an ordinary 403 the error path
   * explains.
   */
  const checkInsClient = (): PcoClient => {
    const baseUrl = checkInsBaseUrl(config.baseUrl);
    if (!baseUrl) {
      throw new BackendPreconditionError(
        `The configured Planning Center URL ("${config.baseUrl}") does not end in /people/v2, so the Check-Ins API root cannot be derived from it.`,
      );
    }
    return createPcoClient({ appId: config.appId, secret: config.secret, baseUrl });
  };

  return {
    id: 'pco',
    prefix: BACKEND_PREFIXES.pco,
    displayName: PCO_DISPLAY_NAME,
    capabilities: {
      writeBack: config.writeBack,
      parentCreatable: true,
      mergeAware: true,
      listsSupported: true,
      historyImportSupported: true,
      attendancePushSupported: false,
    },

    fetchRoster: ({ personIds, force }) =>
      fetchRoster({ client, config, cache, personIds, force }),
    searchPeople: ({ query, limit }) => searchPeople({ client, config, query, limit, cache }),
    fetchPersonDetails: ({ personId, force }) =>
      fetchPersonDetails({ client, config, cache, personId, force }),
    fetchAllergyNotes: ({ personIds, force }) =>
      fetchAllergyNotes({ client, config, cache, personIds, force }),
    fetchParentContactStatus: ({ personIds, force }) =>
      fetchParentContactStatus({ client, config, cache, personIds, force }),
    collectPhoneLast4: ({ personIds, force }) =>
      collectPhoneLast4({ client, config, cache, personIds, force }),

    /*
     * Confirm a person is real before the roster records that they are. A
     * merged id is followed to the record the church kept — whoever pasted it
     * meant that person — and only a trail that ends dead is reported gone.
     */
    checkPerson: async ({ personId }): Promise<PersonCheck> => {
      // Their Attendees identity rides along on the same request, so an add
      // can recognise a person the roster already holds through the other
      // backend. Resolved from cache; null when the org keeps no such field.
      const a32FieldId = await resolveA32UuidFieldId({ client, cache, baseUrl: config.baseUrl });
      const fetchOne = async (id: string): Promise<{ a32PersonId?: string }> => {
        const body = await client.get(`/people/${encodeURIComponent(id)}`, {
          ...(a32FieldId ? { include: ['field_data'] } : {}),
        });
        const alias = a32FieldId
          ? a32AliasesFromIncluded(body.included ?? [], a32FieldId)[id]
          : undefined;
        return alias ? { a32PersonId: alias } : {};
      };

      try {
        const extra = await fetchOne(personId);
        return { outcome: 'exists', personId, ...extra };
      } catch (error) {
        if (!isPersonGoneError(error)) throw error;
        const link = await followPersonLink(client, personId, error);
        if (link.outcome === 'gone') return { outcome: 'gone' };
        try {
          const extra = await fetchOne(link.personId);
          return { outcome: 'relinked', personId: link.personId, ...extra };
        } catch {
          return { outcome: 'relinked', personId: link.personId };
        }
      }
    },

    pushStudent: ({ studentId, logger }) => pushStudent({ db, client, config, studentId, logger }),
    pushPendingStudents: ({ logger, limit }) =>
      pushPendingStudents({ db, client, config, logger, limit }),
    updateStudentProfile: ({ studentId, logger, ...patch }) =>
      updateStudentProfile({ db, client, config, studentId, logger, ...patch }),
    setParentContact: ({ studentId, phone, email, logger }) =>
      setParentContact({ db, client, config, studentId, phone, email, logger }),
    addParent: ({ studentId, personId, firstName, lastName, phone, email, createNew, logger }) =>
      addParent({
        db,
        client,
        config,
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
      recreateStudent({ db, client, config, studentId, firstName, lastName, grade, logger }),
    createFamily: ({
      studentIds,
      anchorStudentIds,
      firstName,
      lastName,
      parentPersonId,
      createNewParent,
      phone,
      email,
      logger,
    }) =>
      createFamily({
        db,
        client,
        config,
        studentIds,
        anchorStudentIds,
        firstName,
        lastName,
        parentPersonId,
        createNewParent,
        phone,
        email,
        logger,
      }),
    findAdultCandidates: ({ firstName, lastName, phone, excludePersonIds }) =>
      findAdultCandidates({ client, firstName, lastName, phone, excludePersonIds }),

    fetchLists: ({ search, limit }) => fetchLists({ client, search, limit }),
    fetchListMemberIds: (listId) => fetchListMemberIds(client, listId),

    listImportableEvents: () => listCheckInsEvents({ client: checkInsClient(), db }),
    importHistory: ({ upstreamEventId, uid, now, logger }) =>
      importCheckInsEvent({
        db,
        client: checkInsClient(),
        pcoEventId: upstreamEventId,
        uid,
        now,
        logger: logger ?? SILENT_LOGGER,
      }),

    invalidatePersonDetails: (personId) =>
      cache.invalidate(personDetailsCacheKey(config.baseUrl, personId)),
    invalidateReachability: () => cache.invalidate(reachableAdultsCacheKey(config.baseUrl)),
    resetCache: () => resetSharedCache(),
  };
}
