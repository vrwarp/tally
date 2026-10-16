/**
 * Merging two attendees, and undoing it, through attendees32's own merge.
 *
 * `POST …/<duplicate>/merge/` with the primary moves everything the duplicate
 * held onto the primary and leaves the duplicate as a tombstone answering
 * `410`; `POST …/<duplicate>/unmerge/` puts it all back, once. The merge takes
 * no choices: the primary's details stay, the duplicate's fill its blanks, and
 * contacts of every kind are kept. Both calls are guarded by the organization's
 * `groups_see_all_meets_attendees`, the group the setup command puts the
 * integration user in.
 */
import type { UpstreamMergeResult } from '../backends/types.js';
import { A32ApiError, getA32Attendee, isA32GoneError, type A32Client } from './client.js';

const ATTENDEES = '/persons/api/datagrid_data_attendee';

/** attendees32's own reason for saying no, or null when the error is something else. */
function refusalOf(error: unknown): string | null {
  if (!(error instanceof A32ApiError)) return null;
  if (error.status === 400) return error.errors.join('; ') || 'Attendees refused.';
  if (error.status === 403) return 'The integration user is not in a group that may merge attendees.';
  return null;
}

export async function mergePeople(
  client: A32Client,
  duplicateId: string,
  primaryId: string,
): Promise<UpstreamMergeResult> {
  try {
    await client.post(`${ATTENDEES}/${duplicateId}/merge/`, { primary: primaryId });
    return { status: 'done' };
  } catch (error) {
    const reason = refusalOf(error);
    if (reason === null) throw error;
    return { status: 'refused', reason };
  }
}

export async function unmergePeople(client: A32Client, duplicateId: string): Promise<UpstreamMergeResult> {
  // A duplicate that already stands on its own was undone upstream first:
  // nothing to do, and not a refusal.
  try {
    await getA32Attendee(client, duplicateId);
    return { status: 'done' };
  } catch (error) {
    if (!isA32GoneError(error)) throw error;
  }
  try {
    await client.post(`${ATTENDEES}/${duplicateId}/unmerge/`, {});
    return { status: 'done' };
  } catch (error) {
    const reason = refusalOf(error);
    if (reason === null) throw error;
    return { status: 'refused', reason };
  }
}
