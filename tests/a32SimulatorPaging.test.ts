import { describe, expect, it } from 'vitest';
import { A32SimulatorStore } from '../tools/a32-simulator/src/store';
import { handleRequest } from '../tools/a32-simulator/src/handler';
import { startSimulator } from '../tools/a32-simulator/src/server';

function listAttendees(store: A32SimulatorStore, query: Record<string, string>) {
  return handleRequest(store, {
    method: 'GET',
    path: '/persons/api/datagrid_data_attendee/',
    query,
    headers: { authorization: `Token ${store.token}` },
    body: null,
  });
}

describe('a32 simulator paging', () => {
  const store = new A32SimulatorStore();
  for (const firstName of ['A', 'B', 'C', 'D']) store.createAttendee({ firstName });

  it('pages with take and skip', () => {
    const page = listAttendees(store, { take: '2', skip: '1' }).body as {
      totalCount: number;
      data: unknown[];
    };
    expect(page.totalCount).toBe(4);
    expect(page.data).toHaveLength(2);
  });

  it('does not count from the end of the list for a negative skip', () => {
    const page = listAttendees(store, { take: '2', skip: '-1' }).body as { data: unknown[] };
    const first = listAttendees(store, { take: '2', skip: '0' }).body as { data: unknown[] };
    expect(page.data).toEqual(first.data);
  });

  it('answers an empty page, not a tail slice, for a negative take', () => {
    const page = listAttendees(store, { take: '-1', skip: '1' }).body as { data: unknown[] };
    expect(page.data).toEqual([]);
  });
});

describe('a32 simulator control plane', () => {
  it('forgets the request log on reset', async () => {
    const sim = await startSimulator({ port: 0, verbose: false, seed: false });
    try {
      await fetch(`${sim.url}/persons/api/datagrid_data_attendee/`);
      expect(sim.store.requests.length).toBeGreaterThan(0);
      await fetch(`${sim.url}/_sim/reset`, { method: 'POST' });
      expect(sim.store.requests).toHaveLength(0);
    } finally {
      await sim.close();
    }
  });
});
