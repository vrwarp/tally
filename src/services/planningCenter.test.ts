/**
 * The Planning Center connection, as the Settings screen works with it.
 *
 * Two halves that look alike and are not: status and lists come from callables,
 * because they need the church's Personal Access Token and that never reaches a
 * browser; settings are an ordinary Firestore document the core team writes.
 * That split is the whole design — a credential a browser can write is a
 * credential a browser can read.
 *
 * Both claims below that look fussy are the same claim, and it is the one this
 * module exists to keep straight: *stored* is not *in force*. The address in
 * force may come from a deploy-time parameter with nothing stored at all, and
 * an editor that filled its field from the effective value would submit that
 * address back as a brand-new explicit override — which only an admin may
 * write, so every core-team save would be refused for a field nobody touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPlanningCenterLists,
  fetchPlanningCenterStatus,
  readPlanningCenterConfig,
  savePlanningCenterConfig,
} from '@/services/planningCenter';
import type { PcoConfigDraft } from '@/services/planningCenter';

const getDoc = vi.hoisted(() => vi.fn());
const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const getPlanningCenterStatus = vi.hoisted(() => vi.fn());
const listPlanningCenterLists = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/functions', () => ({ getPlanningCenterStatus, listPlanningCenterLists }));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  doc: (_db: unknown, path: string) => ({ path }),
  getDoc,
  setDoc,
  serverTimestamp: () => 'server-timestamp',
}));

function stored(data: Record<string, unknown> | null) {
  getDoc.mockResolvedValueOnce({ exists: () => data !== null, data: () => data });
}

function written() {
  const call = setDoc.mock.calls.at(-1) as unknown[] | undefined;
  const ref = call?.[0];
  const data = call?.[1];
  return { path: (ref as { path: string } | undefined)?.path, data: data as Record<string, unknown> };
}

beforeEach(() => {
  getDoc.mockReset();
  setDoc.mockClear();
  getPlanningCenterStatus.mockReset();
  listPlanningCenterLists.mockReset();
});

describe('fetchPlanningCenterStatus', () => {
  it('unwraps the callable', async () => {
    getPlanningCenterStatus.mockResolvedValue({ data: { connected: true } });

    await expect(fetchPlanningCenterStatus()).resolves.toEqual({ connected: true });
  });

  it('lets the server answer from its own held status by default', async () => {
    getPlanningCenterStatus.mockResolvedValue({ data: {} });

    await fetchPlanningCenterStatus();

    expect(getPlanningCenterStatus).toHaveBeenCalledWith({ force: false });
  });

  it('skips that when the caller insists', async () => {
    // The moment after somebody fixed a setting: "still broken" must not be a
    // stale echo.
    getPlanningCenterStatus.mockResolvedValue({ data: {} });

    await fetchPlanningCenterStatus(true);

    expect(getPlanningCenterStatus).toHaveBeenCalledWith({ force: true });
  });
});

describe('fetchPlanningCenterLists', () => {
  it('turns the wire dates into dates', async () => {
    listPlanningCenterLists.mockResolvedValue({
      data: { lists: [{ id: '1', name: 'Youth', refreshedAt: '2026-02-13T19:30:00.000Z' }] },
    });

    const [list] = await fetchPlanningCenterLists();

    expect(list?.refreshedAt).toEqual(new Date('2026-02-13T19:30:00.000Z'));
    expect(list?.name).toBe('Youth');
  });

  it('leaves a list nobody has refreshed without a date', async () => {
    listPlanningCenterLists.mockResolvedValue({
      data: { lists: [{ id: '1', name: 'Youth', refreshedAt: null }] },
    });

    const [list] = await fetchPlanningCenterLists();

    expect(list?.refreshedAt).toBeNull();
  });

  it('asks for everything when nobody has typed a search', async () => {
    listPlanningCenterLists.mockResolvedValue({ data: { lists: [] } });

    await fetchPlanningCenterLists();

    expect(listPlanningCenterLists).toHaveBeenCalledWith({});
  });

  it('passes a search upstream rather than filtering a big answer here', async () => {
    // A church with hundreds of lists should send one small page over the wire,
    // not all of them so a browser can hide most of it.
    listPlanningCenterLists.mockResolvedValue({ data: { lists: [] } });

    await fetchPlanningCenterLists('youth');

    expect(listPlanningCenterLists).toHaveBeenCalledWith({ search: 'youth' });
  });

  it('treats an empty search as no search', async () => {
    listPlanningCenterLists.mockResolvedValue({ data: { lists: [] } });

    await fetchPlanningCenterLists('');

    expect(listPlanningCenterLists).toHaveBeenCalledWith({});
  });
});

describe('savePlanningCenterConfig', () => {
  it('writes the whole document rather than a patch', async () => {
    // A patch that omitted a cleared counselor list would resurrect the
    // deployed one, which is the opposite of what Save was asked for.
    await savePlanningCenterConfig(
      { baseUrl: '', counselorListId: '' } as unknown as PcoConfigDraft,
      'uid-admin',
    );

    expect(written().path).toBe('config/planningCenter');
    expect(written().data).toEqual({
      baseUrl: '',
      counselorListId: '',
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-admin',
    });
  });

  it('stamps who saved it and when', async () => {
    await savePlanningCenterConfig({} as PcoConfigDraft, 'uid-miriam');

    expect(written().data).toEqual({
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
  });
});

describe('readPlanningCenterConfig', () => {
  it('reads the document the functions read on every callable', async () => {
    stored({});
    await readPlanningCenterConfig();

    expect(getDoc).toHaveBeenCalledWith({ path: 'config/planningCenter' });
  });

  it('reports that nothing has ever been saved', async () => {
    // The ordinary state of an install still running on its deploy-time
    // parameters — not an error.
    stored(null);

    await expect(readPlanningCenterConfig()).resolves.toEqual({
      exists: false,
      baseUrl: '',
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('reports an empty override rather than undefined', async () => {
    stored({ updatedBy: 'uid-admin' });

    await expect(readPlanningCenterConfig()).resolves.toMatchObject({
      exists: true,
      baseUrl: '',
      updatedBy: 'uid-admin',
    });
  });

  it('reads a stored override back', async () => {
    stored({ baseUrl: 'https://pco.example.org', updatedBy: 'uid-admin' });

    await expect(readPlanningCenterConfig()).resolves.toMatchObject({
      exists: true,
      baseUrl: 'https://pco.example.org',
    });
  });

  it('ignores an override that is not text', async () => {
    stored({ baseUrl: 42 });

    await expect(readPlanningCenterConfig()).resolves.toMatchObject({ baseUrl: '' });
  });

  it('has no author when the field is not text', async () => {
    stored({ updatedBy: 7 });

    await expect(readPlanningCenterConfig()).resolves.toMatchObject({ updatedBy: null });
  });
});
