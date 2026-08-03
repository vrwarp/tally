/**
 * One pass over the students collection, answering "who is on the roster and
 * which backend holds each of them".
 *
 * The membership is Tally's own: a `students/{id}` document exists for
 * everyone somebody has put on the roster, and that document is the decision.
 * What this scan adds is the sorting into backends — by document id prefix for
 * students a backend originated, by linkage fields for visitors Tally created
 * and later pushed — so a roster read can ask each connected backend about
 * exactly its own people.
 *
 * Read here rather than trusted from the caller, because the whole point of
 * the id scheme is that it says which upstream person a row refers to — a
 * browser that could name the ids would be choosing whose personal details the
 * server fetches.
 */
import { PATHS, type FirestoreLike } from '../firestore.js';
import {
  BACKEND_IDS,
  isBackendId,
  parseStudentId,
  studentIdFor,
  type BackendId,
} from '../generated/backendIds.js';

/** Which backend a student document is linked to, and as whom. */
export interface StudentLinkage {
  backendId: BackendId;
  personId: string;
}

/**
 * The linkage a document's *fields* assert — for a visitor whose document
 * keeps its Tally id for ever. The generic pair wins when present; the older
 * `pcoPersonId` field keeps meaning what it always meant, so documents written
 * before the pair existed need no migration.
 *
 * Trusted because these fields are server-written: the security rules forbid a
 * client to set or change any of them.
 */
export function linkageOfData(data: Record<string, unknown>): StudentLinkage | null {
  const backend = data.upstreamBackend;
  const personId = data.upstreamPersonId;
  if (isBackendId(backend) && typeof personId === 'string' && personId.length > 0) {
    return { backendId: backend, personId };
  }
  const legacy = data.pcoPersonId;
  if (typeof legacy === 'string' && legacy.length > 0) {
    return { backendId: 'pco', personId: legacy };
  }
  return null;
}

function emptyPerBackend<T>(make: () => T): Record<BackendId, T> {
  return Object.fromEntries(BACKEND_IDS.map((id) => [id, make()])) as Record<BackendId, T>;
}

export interface RosterScan {
  /**
   * Backend people Tally has on its roster, per backend — the students whose
   * document id *is* the claim (`students/pco_123`, `students/a32_9f0c…`).
   */
  personIds: Record<BackendId, string[]>;
  /**
   * The people Tally itself put into a backend, whose documents still carry
   * the id Tally gave them. A visitor quick-added at a door is
   * `students/{tally-id}` with no person behind them; the push writes the
   * linkage onto that document — it does not rename it, because every
   * attendance record already points at the id.
   *
   * Kept apart from `personIds` because the two halves answer differently on
   * the client: a `personIds` student *is* their roster row, while a linked
   * student is already a row of their own and the roster read answers for the
   * fields the backend owns, which `mergeRoster` lays onto the document's row.
   */
  linkedPersonIds: Record<BackendId, string[]>;
  /**
   * Which student document each linked person id came from, so a merge the
   * roster read follows can be written back to the right visitor document —
   * their doc id is Tally's own and says nothing about the person.
   */
  studentIdByLinkedPersonId: Record<BackendId, Record<string, string>>;
  /**
   * Which active documents currently carry `pcoRecordMissing: true`, so the
   * roster read writes the flag only when the answer *changed* — four hundred
   * students must not cost four hundred writes per read.
   */
  recordMissing: Record<string, boolean>;
  /**
   * Active students with no backend person yet — the same rows the Students
   * screen marks "Queued". Counted on this pass rather than its own because
   * the collection has already been read.
   */
  queued: number;
}

/** One scan of the students collection, for the things anybody asks of it. */
export async function scanRoster(database: FirestoreLike): Promise<RosterScan> {
  const snapshot = await database.collection(PATHS.students).get();
  const scan: RosterScan = {
    personIds: emptyPerBackend(() => []),
    linkedPersonIds: emptyPerBackend(() => []),
    studentIdByLinkedPersonId: emptyPerBackend(() => ({})),
    recordMissing: {},
    queued: 0,
  };

  for (const document of snapshot.docs) {
    const data = document.data() ?? {};

    /*
     * A student taken off the roster keeps their document — every attendance
     * record points at it, so deleting the row would drop past head counts —
     * but stops being somebody Tally asks a backend about. Skipping them here
     * is what makes "remove" mean anything, and it also means Tally reads no
     * personal data at all about a child who has left the ministry. Somebody
     * who has left is not waiting to be created upstream either, so the same
     * skip is what keeps them out of the queued count.
     */
    if (data.status === 'inactive') continue;

    const parsed = parseStudentId(document.id);
    if (parsed) {
      scan.personIds[parsed.backendId].push(parsed.personId);
    } else {
      const linkage = linkageOfData(data);
      if (linkage) {
        scan.linkedPersonIds[linkage.backendId].push(linkage.personId);
        scan.studentIdByLinkedPersonId[linkage.backendId][linkage.personId] = document.id;
      } else {
        scan.queued += 1;
      }
    }
    if (data.pcoRecordMissing === true) scan.recordMissing[document.id] = true;
  }

  return scan;
}

/** Both halves of one backend's membership, the shape its roster read wants. */
export function scanIdsFor(scan: RosterScan, backendId: BackendId): string[] {
  return [...scan.personIds[backendId], ...scan.linkedPersonIds[backendId]];
}

/**
 * The student document a backend person's answer lands on — the prefixed
 * document when the id is the claim, the visitor document when the linkage is.
 */
export function studentDocFor(
  scan: RosterScan,
  backendId: BackendId,
  personId: string,
): string | undefined {
  return scan.personIds[backendId].includes(personId)
    ? studentIdFor(backendId, personId)
    : scan.studentIdByLinkedPersonId[backendId][personId];
}

/**
 * `studentDocFor` inverted: which backend person a scanned document stands
 * for. From the id when the id is the claim; otherwise from the scan's linked
 * maps, which saves re-reading a document the scan already read.
 */
export function linkageOfStudentDoc(scan: RosterScan, studentDoc: string): StudentLinkage | null {
  const parsed = parseStudentId(studentDoc);
  if (parsed) return parsed;
  for (const backendId of BACKEND_IDS) {
    const entry = Object.entries(scan.studentIdByLinkedPersonId[backendId]).find(
      ([, docId]) => docId === studentDoc,
    );
    if (entry) return { backendId, personId: entry[0] };
  }
  return null;
}
