/**
 * The people backends, as the Settings screen works with them.
 *
 * One distinction runs through this whole module and every claim below turns on
 * it: *in force* is not the same as *saved*. What is in force comes back from a
 * callable, because working it out needs a credential that never reaches a
 * browser and because a deploy can pin values no document has. What is saved is
 * an ordinary Firestore document the core team wrote.
 *
 * Blurring the two has a specific cost, which is why `readAttendees32Config`
 * exists at all: an editor that filled its address box from the *effective*
 * value would submit that value back as a brand-new override — a write only an
 * admin may make, silently turning a deployed default into a pinned one.
 *
 * `readA32EffectiveSettings` is the other half: `BackendStatus.settings` is
 * `Record<string, unknown>` on the wire, so this is where the a32 shape gets
 * its types back — tolerantly, because an older server may answer without a key
 * and a form still has to open with something sensible in every field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchBackendStatuses,
  readA32EffectiveSettings,
  readAttendees32Config,
  saveAttendees32Config,
  saveDefaultPushBackend,
} from '@/services/backends';

const getDoc = vi.hoisted(() => vi.fn());
const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const getBackendStatuses = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/functions', () => ({ getBackendStatuses }));
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

/** A stored document, or none at all. */
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
  getBackendStatuses.mockReset();
});

describe('fetchBackendStatuses', () => {
  it('unwraps the callable', async () => {
    getBackendStatuses.mockResolvedValue({ data: { backends: [], defaultPushBackend: 'pco' } });

    await expect(fetchBackendStatuses()).resolves.toEqual({
      backends: [],
      defaultPushBackend: 'pco',
    });
  });

  it('lets the server answer from its own held roster by default', async () => {
    getBackendStatuses.mockResolvedValue({ data: {} });

    await fetchBackendStatuses();

    expect(getBackendStatuses).toHaveBeenCalledWith({ force: false });
  });

  it('skips the held answer when asked to', async () => {
    // The moment right after somebody fixed a setting, where "still broken"
    // must not be a stale echo.
    getBackendStatuses.mockResolvedValue({ data: {} });

    await fetchBackendStatuses(true);

    expect(getBackendStatuses).toHaveBeenCalledWith({ force: true });
  });
});

describe('readA32EffectiveSettings', () => {
  it('reads a full settings payload back into its own shape', () => {
    expect(
      readA32EffectiveSettings({
        enabled: true,
        baseUrl: 'https://a32.example.org',
        divisionId: 'div-1',
        meetSlug: 'friday',
        characterSlug: 'grade',
        assemblySlug: 'youth',
        minGrade: 7,
        maxGrade: 11,
        writeBack: 'full',
        cacheTtlSeconds: 90,
        managedInApp: true,
      }),
    ).toEqual({
      enabled: true,
      baseUrl: 'https://a32.example.org',
      divisionId: 'div-1',
      meetSlug: 'friday',
      characterSlug: 'grade',
      assemblySlug: 'youth',
      minGrade: 7,
      maxGrade: 11,
      writeBack: 'full',
      cacheTtlSeconds: 90,
      managedInApp: true,
    });
  });

  it('opens every text box empty rather than undefined', () => {
    // A controlled input handed `undefined` becomes uncontrolled, and React
    // warns about it once and then silently stops tracking the field.
    const settings = readA32EffectiveSettings({});

    expect(settings.baseUrl).toBe('');
    expect(settings.divisionId).toBe('');
    expect(settings.meetSlug).toBe('');
    expect(settings.characterSlug).toBe('');
    expect(settings.assemblySlug).toBe('');
  });

  it('ignores a value of the wrong type in a text field', () => {
    expect(readA32EffectiveSettings({ baseUrl: 42 }).baseUrl).toBe('');
  });

  it('treats a backend nobody switched off as on', () => {
    // Absent means "no opinion", and the deployed default for a configured
    // backend is that it is running.
    expect(readA32EffectiveSettings({}).enabled).toBe(true);
    expect(readA32EffectiveSettings({ enabled: undefined }).enabled).toBe(true);
  });

  it('honours a backend that was switched off', () => {
    expect(readA32EffectiveSettings({ enabled: false }).enabled).toBe(false);
  });

  it('opens the grade range on the youth ministry it was written for', () => {
    expect(readA32EffectiveSettings({}).minGrade).toBe(6);
    expect(readA32EffectiveSettings({}).maxGrade).toBe(12);
  });

  it('keeps a grade bound of zero rather than falling back over it', () => {
    // Kindergarten is grade 0, and `0 || 6` is 6.
    expect(readA32EffectiveSettings({ minGrade: 0 }).minGrade).toBe(0);
  });

  it('ignores a grade bound that is not a finite number', () => {
    expect(readA32EffectiveSettings({ minGrade: Number.NaN }).minGrade).toBe(6);
    expect(readA32EffectiveSettings({ maxGrade: '12' }).maxGrade).toBe(12);
  });

  it('defaults the cache to half a minute', () => {
    expect(readA32EffectiveSettings({}).cacheTtlSeconds).toBe(30);
  });

  it('keeps a cache of zero, which means do not hold anything', () => {
    expect(readA32EffectiveSettings({ cacheTtlSeconds: 0 }).cacheTtlSeconds).toBe(0);
  });

  it('writes back nothing unless a mode says otherwise', () => {
    // The safe default for a backend Tally may not own: read, never write.
    expect(readA32EffectiveSettings({}).writeBack).toBe('off');
    expect(readA32EffectiveSettings({ writeBack: 'everything' }).writeBack).toBe('off');
  });

  it('keeps the two write-back modes it recognises', () => {
    expect(readA32EffectiveSettings({ writeBack: 'create' }).writeBack).toBe('create');
    expect(readA32EffectiveSettings({ writeBack: 'full' }).writeBack).toBe('full');
  });

  it('says a deployed default is not managed in the app', () => {
    // The flag is what tells the editor whether a value is pinned here or came
    // from the deploy, which decides whether it may offer to change it.
    expect(readA32EffectiveSettings({}).managedInApp).toBe(false);
    expect(readA32EffectiveSettings({ managedInApp: 'yes' }).managedInApp).toBe(false);
    expect(readA32EffectiveSettings({ managedInApp: true }).managedInApp).toBe(true);
  });
});

describe('readAttendees32Config', () => {
  it('reports that nothing has ever been saved', async () => {
    stored(null);

    await expect(readAttendees32Config()).resolves.toEqual({
      exists: false,
      enabled: null,
      baseUrl: '',
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('reads the document from the config collection', async () => {
    stored({});
    await readAttendees32Config();

    expect(getDoc).toHaveBeenCalledWith({ path: 'config/attendees32' });
  });

  it('reads a saved document back', async () => {
    stored({
      enabled: false,
      baseUrl: 'https://a32.example.org',
      updatedBy: 'uid-admin',
    });

    await expect(readAttendees32Config()).resolves.toMatchObject({
      exists: true,
      enabled: false,
      baseUrl: 'https://a32.example.org',
      updatedBy: 'uid-admin',
    });
  });

  it('says null for an off switch the document has never mentioned', async () => {
    // Distinct from `false`: "nobody has said" is what lets the editor show
    // the deployed default rather than claiming somebody chose it.
    stored({ baseUrl: 'https://a32.example.org' });

    await expect(readAttendees32Config()).resolves.toMatchObject({ enabled: null });
  });

  it('says null for an off switch that is not a boolean', async () => {
    stored({ enabled: 'true' });

    await expect(readAttendees32Config()).resolves.toMatchObject({ enabled: null });
  });

  it('reports no override rather than undefined when the address is unset', async () => {
    stored({ enabled: true });

    await expect(readAttendees32Config()).resolves.toMatchObject({ baseUrl: '' });
  });

  it('has no author when the field is not text', async () => {
    stored({ updatedBy: 7 });

    await expect(readAttendees32Config()).resolves.toMatchObject({ updatedBy: null });
  });
});

describe('saving', () => {
  it('writes the whole Attendees document, not a patch', async () => {
    // A cleared field is written as `''` — "cleared on purpose" — where an
    // omitted key would read as "no opinion, fall back to the deploy".
    await saveAttendees32Config(
      {
        enabled: true,
        baseUrl: '',
        divisionId: 'div-1',
        meetSlug: 'friday',
        characterSlug: 'grade',
        assemblySlug: 'youth',
        minGrade: 6,
        maxGrade: 12,
        writeBack: 'create',
        cacheTtlSeconds: 30,
      } as Parameters<typeof saveAttendees32Config>[0],
      'uid-admin',
    );

    expect(written().path).toBe('config/attendees32');
    expect(written().data).toMatchObject({
      enabled: true,
      baseUrl: '',
      divisionId: 'div-1',
      writeBack: 'create',
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-admin',
    });
  });

  it('stamps who saved it and when', async () => {
    await saveAttendees32Config(
      {} as Parameters<typeof saveAttendees32Config>[0],
      'uid-miriam',
    );

    expect(written().data).toEqual({
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
  });

  it('points new students at a backend in a document of its own', async () => {
    // Deployment-wide rather than per student, and absent has always meant
    // Planning Center.
    await saveDefaultPushBackend('a32', 'uid-admin');

    expect(written().path).toBe('config/backends');
    expect(written().data).toEqual({
      defaultPushBackend: 'a32',
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-admin',
    });
  });
});
