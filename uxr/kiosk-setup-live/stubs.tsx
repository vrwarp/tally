/**
 * What the kiosk screen asks the rest of the app for, answered locally.
 *
 * Same argument as `uxr/team-live/stubs.tsx`: the screen is very nearly a pure
 * function of a role and one callable's answer, so the harness aliases the four
 * modules that reach Firebase and nothing else. The component, its markup, its
 * classes and its stylesheet are the app's own.
 *
 * The app shell is mounted around it rather than re-drawn, which is why
 * `dataContext` is here too — the shell reads it for the error banner — and why
 * the stubs answer as a signed-in person rather than as an empty session. The
 * whole point of this scene is *the path to the screen*, and the path is the
 * account menu.
 */
import type { Role, UserProfile } from '@/types';
import type { KioskStatus } from '@/services/functions';

const params = new URLSearchParams(location.search);

/**
 * Who is looking.
 *
 * `?role=counselor` is not a cosmetic variation. A counselor gets no nav rail
 * at all — the shell hides it when only one destination survives the filter —
 * and no core-team controls on the screen, so it is a genuinely different page
 * in a genuinely different frame. It is also the role that the kiosk's own
 * screen tells to go and pair it, which is the reason this refinement exists.
 */
const role = (params.get('role') as Role | null) ?? 'admin';

/** Which answer `getKioskStatus` gives: the healthy deployment or the broken one. */
const state = (params.get('state') as KioskStatus['state'] | null) ?? 'ok';

const PROFILE: UserProfile = {
  id: 'user-0',
  email: 'dana.ruiz@example.org',
  displayName: 'Dana Ruiz',
  role,
  active: true,
  pcoPersonId: null,
  createdAt: new Date(),
  lastSeenAt: new Date(),
};

const RANK: Record<Role, number> = { counselor: 0, core: 1, admin: 2 };

export function useAuth() {
  return {
    profile: PROFILE,
    user: { uid: PROFILE.id },
    can: (needed: Role) => RANK[role] >= RANK[needed],
    signOut: async () => {},
  };
}

export function useData() {
  return { error: null };
}

export function useToast() {
  return { show: () => '' };
}

/**
 * The deployment's answer about whether it can sign kiosk tokens at all.
 *
 * `denied` carries the whole apparatus — a problem, a remedy and a `gcloud`
 * command — and it is the state most likely to be designed past, because it is
 * absent from the frame everybody looks at.
 */
const STATUSES: Record<KioskStatus['state'], KioskStatus> = {
  ok: { state: 'ok', problem: null, remedy: null, command: null },
  denied: {
    state: 'denied',
    problem:
      'This deployment cannot sign kiosk tokens: the functions service account is missing the Service Account Token Creator role.',
    remedy:
      'Grant the role to the service account below, then reload this page. A kiosk already showing a code will pair on its next poll.',
    command:
      'gcloud projects add-iam-policy-binding tally-76406 --member=serviceAccount:tally-76406@appspot.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator',
  },
  unknown: {
    state: 'unknown',
    problem: 'Tally could not verify that it can sign kiosk tokens.',
    remedy: 'Pairing may still work. Try it, and come back here if the kiosk does not sign itself in.',
    command: null,
  },
};

/* The writes resolve without doing anything: a frame is a state, not a session. */
export const getKioskStatus = async () => ({ data: STATUSES[state] });
export const approveKioskPairing = async () => ({ data: { status: 'approved' as const } });
export const refreshKioskPhoneIndex = async () => ({
  data: { students: 125, entries: 96, builtAt: new Date().toISOString() },
});

export type { KioskStatus };
