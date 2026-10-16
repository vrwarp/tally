/**
 * Merging two attendees through attendees32's own merge, and undoing it.
 *
 * What a fold needs from the other end: the merge made, the duplicate's id
 * answering with the primary afterwards, the server's own reason when it says
 * no, and an undo that is done rather than refused when the duplicate already
 * stands on its own.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  A32SimulatorStore,
  createSimulatorFetch,
  DEFAULT_TOKEN,
  seedDefaultOrganization,
  SIMULATOR_ORIGIN,
} from '../../../tools/a32-simulator/src/index.js';
import { A32ApiError, createA32Client, getA32Attendee, type A32Client } from './client.js';
import { mergePeople, unmergePeople } from './merge.js';

let store: A32SimulatorStore;
let client: A32Client;

beforeEach(() => {
  store = new A32SimulatorStore();
  seedDefaultOrganization(store);
  client = createA32Client({
    token: DEFAULT_TOKEN,
    baseUrl: SIMULATOR_ORIGIN,
    fetchImpl: createSimulatorFetch(store),
    sleep: async () => {},
  });
});

/** Two live attendees: the first is the primary, the second the duplicate. */
function two(): [string, string] {
  const [primary, duplicate] = [...store.attendees.values()].filter((attendee) => !attendee.isRemoved);
  return [primary!.id, duplicate!.id];
}

describe('mergePeople', () => {
  it('merges the duplicate into the primary, whose id the duplicate then answers with', async () => {
    const [primary, duplicate] = two();

    expect(await mergePeople(client, duplicate, primary)).toEqual({ status: 'done' });

    expect(store.attendees.get(duplicate)?.mergedInto).toBe(primary);
    await expect(getA32Attendee(client, duplicate)).rejects.toMatchObject({ status: 410, mergedInto: primary });
  });

  it('reports a refusal in the server’s words', async () => {
    const [primary, duplicate] = two();

    expect(await mergePeople(client, primary, primary)).toEqual({
      status: 'refused',
      reason: expect.stringMatching(/into themselves/),
    });

    await mergePeople(client, duplicate, primary);
    expect(await mergePeople(client, duplicate, primary)).toEqual({
      status: 'refused',
      reason: expect.stringMatching(/already been merged/),
    });
  });

  it('lets anything else through as the error it is', async () => {
    const [primary] = two();
    await expect(mergePeople(client, 'no-such-attendee', primary)).rejects.toBeInstanceOf(A32ApiError);
  });
});

describe('unmergePeople', () => {
  it('puts the duplicate back', async () => {
    const [primary, duplicate] = two();
    await mergePeople(client, duplicate, primary);

    expect(await unmergePeople(client, duplicate)).toEqual({ status: 'done' });

    expect(store.attendees.get(duplicate)).toMatchObject({ mergedInto: null, isRemoved: false });
    await expect(getA32Attendee(client, duplicate)).resolves.toMatchObject({ id: duplicate });
  });

  it('is done when the duplicate already stands on its own, without asking', async () => {
    const [, duplicate] = two();

    expect(await unmergePeople(client, duplicate)).toEqual({ status: 'done' });

    expect(store.requests.filter((request) => request.path.endsWith('/unmerge/'))).toEqual([]);
  });

  it('reports a refusal', async () => {
    const [, duplicate] = two();
    // Deleted the ordinary way, never merged: gone, with no merge to undo.
    store.attendees.get(duplicate)!.isRemoved = true;

    expect(await unmergePeople(client, duplicate)).toEqual({
      status: 'refused',
      reason: expect.stringMatching(/was not merged/),
    });
  });
});
