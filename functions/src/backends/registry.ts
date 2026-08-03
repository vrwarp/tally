/**
 * Which people-backends this deployment is connected to, resolved per request.
 *
 * Built fresh on every call for the same reason `resolveConfig` reads its
 * document on every call: a leader who has just connected or disconnected a
 * backend must see the change on the next request, not when some memo expires.
 * Construction is a handful of Firestore point reads and two closures; there
 * is nothing here worth caching at the price of that staleness.
 *
 * "Enabled" is decided here and nowhere else: a backend with a configuration
 * error is not enabled, and the registry never constructs an adapter it would
 * have to apologise for. The reason a backend is *not* enabled stays
 * askable (`configErrorOf`), because the Settings screen's whole job is to
 * name it.
 */
import {
  isA32Enabled,
  resolveA32Config,
  resolveConfig,
  resolveDefaultPushBackend,
  type A32Config,
  type PcoConfig,
} from '../config.js';
import type { FirestoreLike } from '../firestore.js';
import { BACKEND_IDS, type BackendId } from '../generated/backendIds.js';
import { createPcoBackend, PCO_DISPLAY_NAME } from '../pco/backend.js';
import type { PeopleBackend } from './types.js';

export const A32_DISPLAY_NAME = 'Attendees';

export const BACKEND_DISPLAY_NAMES: Record<BackendId, string> = {
  pco: PCO_DISPLAY_NAME,
  a32: A32_DISPLAY_NAME,
};

/**
 * The Attendees adapter factory, registered by functions/src/attendees32 at
 * module load. A registration hook rather than an import so this module —
 * which every entry point pulls in — does not decide by itself that the whole
 * a32 client rides along; the entry point that wants the backend imports the
 * adapter package, and that import wires it here.
 */
type A32Factory = (args: { db: FirestoreLike; config: A32Config }) => PeopleBackend;
let a32Factory: A32Factory | null = null;

/** Null unregisters — a test seam; production only ever registers. */
export function registerA32Backend(factory: A32Factory | null): void {
  a32Factory = factory;
}

export interface BackendRegistry {
  /** The enabled backends, Planning Center first — the order fan-outs run in. */
  ids(): BackendId[];
  /** The adapter, or null when the backend is not enabled. */
  get(id: BackendId): PeopleBackend | null;
  /**
   * Why `get` answered null: the configuration error, `'disabled'` for a
   * backend somebody switched off, or null for one that is actually enabled.
   */
  configErrorOf(id: BackendId): string | null;
  /** For sentences about a backend that may not be enabled. */
  displayNameOf(id: BackendId): string;
  /** Where a student Tally created gets pushed. */
  defaultPush(): { backend: PeopleBackend } | { error: string };
  /** The resolved configurations, for the status screen's settings echo. */
  readonly configs: { pco: PcoConfig; a32: A32Config };
  readonly defaultPushBackendId: BackendId;
}

export async function createRegistry(db: FirestoreLike): Promise<BackendRegistry> {
  const [pco, a32, defaultPushBackendId] = await Promise.all([
    resolveConfig(db),
    resolveA32Config(db),
    resolveDefaultPushBackend(db),
  ]);

  const backends = new Map<BackendId, PeopleBackend>();
  if (!pco.configError) backends.set('pco', createPcoBackend({ db, config: pco }));
  if (isA32Enabled(a32) && a32Factory) backends.set('a32', a32Factory({ db, config: a32 }));

  const configErrors: Record<BackendId, string | null> = {
    pco: pco.configError,
    a32:
      a32.configError ??
      (!a32.enabled
        ? 'Attendees is switched off in Settings.'
        : a32Factory
          ? null
          : 'The Attendees adapter is not part of this build.'),
  };

  return {
    ids: () => BACKEND_IDS.filter((id) => backends.has(id)),
    get: (id) => backends.get(id) ?? null,
    configErrorOf: (id) => (backends.has(id) ? null : configErrors[id]),
    displayNameOf: (id) => BACKEND_DISPLAY_NAMES[id],
    defaultPush: () => {
      const backend = backends.get(defaultPushBackendId);
      if (backend) return { backend };
      return {
        error:
          configErrors[defaultPushBackendId] ??
          `${BACKEND_DISPLAY_NAMES[defaultPushBackendId]} is not connected.`,
      };
    },
    configs: { pco, a32 },
    defaultPushBackendId,
  };
}
