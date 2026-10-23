import { describe, expect, it } from 'vitest';
import { A32ApiError, type A32Client } from './client.js';
import { followA32PersonLink } from './personLink.js';
import { API } from './types.js';

const gone = (id: string, mergedInto: string | null = null, status = 410) =>
  new A32ApiError(status, API.attendeeById(id), [], null, undefined, mergedInto);

/** A client whose only working verb is `get`, answering from a fixed table. */
function clientOver(table: Record<string, unknown>): { client: A32Client; asked: string[] } {
  const asked: string[] = [];
  const client = {
    get: async (path: string) => {
      const id = decodeURIComponent(path.split('/').filter(Boolean).pop()!);
      asked.push(id);
      const answer = table[id];
      if (answer instanceof Error) throw answer;
      if (answer === undefined) throw gone(id, null, 404);
      return answer;
    },
  } as unknown as A32Client;
  return { client, asked };
}

describe('followA32PersonLink', () => {
  it('reports a plain deletion as gone without a second request', async () => {
    const { client, asked } = clientOver({});
    expect(await followA32PersonLink(client, 'a', gone('a', null, 404))).toEqual({ outcome: 'gone' });
    expect(asked).toEqual([]);
  });

  it('follows a merge to the primary', async () => {
    const primary = { id: 'b', first_name: 'Bo' };
    const { client } = clientOver({ b: primary });
    expect(await followA32PersonLink(client, 'a', gone('a', 'b'))).toEqual({
      outcome: 'live',
      personId: 'b',
      attendee: primary,
    });
  });

  it('walks a chain of merges to its end', async () => {
    const { client, asked } = clientOver({ b: gone('b', 'c'), c: { id: 'c' } });
    const link = await followA32PersonLink(client, 'a', gone('a', 'b'));
    expect(link).toMatchObject({ outcome: 'live', personId: 'c' });
    expect(asked).toEqual(['b', 'c']);
  });

  it('answers gone for a cycle instead of hanging', async () => {
    const { client } = clientOver({ b: gone('b', 'a') });
    expect(await followA32PersonLink(client, 'a', gone('a', 'b'))).toEqual({ outcome: 'gone' });
  });

  it('answers gone when the primary was itself deleted', async () => {
    const { client } = clientOver({ b: gone('b', null, 404) });
    expect(await followA32PersonLink(client, 'a', gone('a', 'b'))).toEqual({ outcome: 'gone' });
  });

  it('stops after the hop bound on a long chain', async () => {
    const table: Record<string, unknown> = {};
    for (let i = 1; i <= 8; i += 1) table[`n${i}`] = gone(`n${i}`, `n${i + 1}`);
    const { client, asked } = clientOver(table);
    expect(await followA32PersonLink(client, 'n0', gone('n0', 'n1'))).toEqual({ outcome: 'gone' });
    expect(asked).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('lets a failure that is not a tombstone propagate', async () => {
    const { client } = clientOver({ b: new A32ApiError(500, API.attendeeById('b'), []) });
    await expect(followA32PersonLink(client, 'a', gone('a', 'b'))).rejects.toThrow(/500/);
  });
});
