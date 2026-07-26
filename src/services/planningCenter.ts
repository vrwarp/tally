/**
 * The Planning Center connection, as the Settings screen works with it.
 *
 * Two halves that look alike and are not. *Status and lists* come from
 * callables, because they need the church's Personal Access Token and that
 * never reaches a browser. *Settings* are an ordinary Firestore document the
 * core team writes directly, exactly like the predictive thresholds next to
 * them — the security rules validate the shape, and the server re-clamps
 * everything it reads back anyway.
 *
 * That split is the whole design of this feature: a credential a browser can
 * write is a credential a browser can read, so the credentials stay in Secret
 * Manager and everything else becomes editable.
 */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import {
  getPlanningCenterStatus,
  listPlanningCenterLists,
  type PcoListPayload,
} from '@/services/functions';
import type { PcoList, PcoRuntimeConfigDoc, PcoStatus } from '@/types';

function toList(payload: PcoListPayload): PcoList {
  return { ...payload, refreshedAt: payload.refreshedAt ? new Date(payload.refreshedAt) : null };
}

/** The connection, plus the settings in force behind it. */
export async function fetchPlanningCenterStatus(force = false): Promise<PcoStatus> {
  const response = await getPlanningCenterStatus({ force });
  return {
    ...response.data,
    studentList: response.data.studentList ? toList(response.data.studentList) : null,
    counselorList: response.data.counselorList ? toList(response.data.counselorList) : null,
  };
}

/**
 * The lists this church has, for the picker.
 *
 * `search` is passed through to Planning Center rather than filtered here: a
 * church with hundreds of lists should send one small page over the wire, not
 * all of them so a browser can hide most of it.
 */
export async function fetchPlanningCenterLists(search?: string): Promise<PcoList[]> {
  const response = await listPlanningCenterLists(search ? { search } : {});
  return response.data.lists.map(toList);
}

/** The settings a leader may change. Never the credentials. */
export type PcoConfigDraft = Omit<PcoRuntimeConfigDoc, 'updatedAt' | 'updatedBy'>;

/**
 * Saves the whole document rather than a patch.
 *
 * Cleared fields are written as `''`, deliberately: the server reads a missing
 * key as "no opinion, fall back to what was deployed" and an empty one as "the
 * leader cleared this on purpose". A patch that simply omitted a cleared
 * counselor list would resurrect the deployed one, which is the opposite of
 * what the person pressing Save just asked for.
 */
export async function savePlanningCenterConfig(draft: PcoConfigDraft, uid: string): Promise<void> {
  await setDoc(doc(db, paths.planningCenter()), {
    ...draft,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export interface PcoStoredConfig {
  /** False when nothing has ever been saved from inside the app. */
  exists: boolean;
  /**
   * The stored API-root *override*, which is not the address in force.
   *
   * The distinction matters exactly once, and it is load-bearing. The effective
   * address may come from a deploy-time parameter — a proxy, or the end-to-end
   * suite's simulator — while nothing is stored here at all. An editor that
   * filled its field from the effective value would then submit that address as
   * a brand-new explicit override, which only an admin may do; every core-team
   * save would be refused by the rules, for a field the person never touched.
   */
  baseUrl: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * What is actually saved, as opposed to what is in force.
 *
 * Not part of the status callable because most of it is not the server's
 * business: the effective configuration is, but "who changed this, and what did
 * they pin" is a Firestore fact the screen can read for itself. A missing
 * document is the ordinary state of an install still running on its deploy-time
 * parameters, so that reads as `exists: false` rather than as an error.
 */
export async function readPlanningCenterConfig(): Promise<PcoStoredConfig> {
  const snapshot = await getDoc(doc(db, paths.planningCenter()));
  const data = snapshot.exists() ? snapshot.data() : null;
  return {
    exists: data !== null,
    baseUrl: typeof data?.baseUrl === 'string' ? data.baseUrl : '',
    updatedAt: toDateOrNull(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : null,
  };
}
