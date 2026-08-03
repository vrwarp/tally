/**
 * The people backends, as the Settings screen works with them.
 *
 * The same split as `planningCenter.ts`, which this generalises: *status*
 * comes from a callable, because probing a backend needs its credential and
 * that never reaches a browser; *settings* are ordinary Firestore documents
 * the core team writes directly, validated by the security rules and
 * re-clamped by the server on every read.
 *
 * Planning Center's own card keeps using `planningCenter.ts`; this module is
 * for what that one cannot say — every backend at once, and the documents the
 * second backend added.
 */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import { getBackendStatuses } from '@/services/functions';
import type {
  A32RuntimeConfigDoc,
  BackendId,
  BackendStatuses,
  PcoWriteBackMode,
} from '@/types';

/**
 * Every backend's connection report, plus which one receives new students.
 * `force` skips the server's held roster answers — for the moment right after
 * somebody fixed a setting, when "still broken" must not be a stale echo.
 */
export async function fetchBackendStatuses(force = false): Promise<BackendStatuses> {
  return (await getBackendStatuses({ force })).data;
}

/**
 * The Attendees settings in force, as `BackendStatus.settings` carries them.
 *
 * That field is `Record<string, unknown>` on the wire — its shape belongs to
 * each backend — so this is where the a32 shape gets its types back. Tolerant
 * of anything missing, because an older server may answer without a key and a
 * form must open with something sensible in every field.
 */
export interface A32EffectiveSettings {
  enabled: boolean;
  baseUrl: string;
  divisionId: string;
  meetSlug: string;
  characterSlug: string;
  assemblySlug: string;
  minGrade: number;
  maxGrade: number;
  writeBack: PcoWriteBackMode;
  cacheTtlSeconds: number;
  /** True when a saved document, rather than the deploy, decides these. */
  managedInApp: boolean;
}

export function readA32EffectiveSettings(settings: Record<string, unknown>): A32EffectiveSettings {
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const writeBack = settings.writeBack;
  return {
    enabled: settings.enabled !== false,
    baseUrl: str(settings.baseUrl),
    divisionId: str(settings.divisionId),
    meetSlug: str(settings.meetSlug),
    characterSlug: str(settings.characterSlug),
    assemblySlug: str(settings.assemblySlug),
    minGrade: num(settings.minGrade, 6),
    maxGrade: num(settings.maxGrade, 12),
    writeBack: writeBack === 'create' || writeBack === 'full' ? writeBack : 'off',
    cacheTtlSeconds: num(settings.cacheTtlSeconds, 30),
    managedInApp: settings.managedInApp === true,
  };
}

/** The settings a leader may change. Never the token. */
export type A32ConfigDraft = Omit<A32RuntimeConfigDoc, 'updatedAt' | 'updatedBy'>;

/**
 * Saves the whole Attendees document rather than a patch — same contract as
 * `savePlanningCenterConfig`, and for the same reason: a cleared field is
 * written as `''` ("cleared on purpose"), where an omitted key would read as
 * "no opinion, fall back to what was deployed".
 */
export async function saveAttendees32Config(draft: A32ConfigDraft, uid: string): Promise<void> {
  await setDoc(doc(db, paths.attendees32()), {
    ...draft,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export interface A32StoredConfig {
  /** False when nothing has ever been saved from inside the app. */
  exists: boolean;
  /** The off switch as stored. Null when the document has never said. */
  enabled: boolean | null;
  /**
   * The stored address *override*, which is not the address in force — the
   * same load-bearing distinction as `PcoStoredConfig.baseUrl`, with the same
   * consequence: an editor that filled this field from the effective value
   * would submit it as a brand-new override, which only an admin may write.
   */
  baseUrl: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * What is actually saved for Attendees, as opposed to what is in force. The
 * effective settings come from `fetchBackendStatuses`; this is the half the
 * editor needs to tell apart "pinned here" from "deployed default".
 */
export async function readAttendees32Config(): Promise<A32StoredConfig> {
  const snapshot = await getDoc(doc(db, paths.attendees32()));
  const data = snapshot.exists() ? snapshot.data() : null;
  return {
    exists: data !== null,
    enabled: typeof data?.enabled === 'boolean' ? data.enabled : null,
    baseUrl: typeof data?.baseUrl === 'string' ? data.baseUrl : '',
    updatedAt: toDateOrNull(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : null,
  };
}

/**
 * Points new students at a backend: which one `onStudentCreated` and the push
 * queue send a visitor to. A one-field document on purpose — the choice is
 * deployment-wide, not per student, and absent has always meant Planning
 * Center.
 */
export async function saveDefaultPushBackend(backendId: BackendId, uid: string): Promise<void> {
  await setDoc(doc(db, paths.backends()), {
    defaultPushBackend: backendId,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
