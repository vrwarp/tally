/**
 * Can this deployment actually mint a kiosk token?
 *
 * `claimKioskToken` ends in `createCustomToken`, and a deployed 2nd-gen function
 * signs that token through the IAM Credentials API rather than with a local
 * private key — which needs the runtime service account to hold
 * `roles/iam.serviceAccountTokenCreator` on itself. Nothing in the code says so,
 * nothing in the emulator exercises it (the Auth emulator mints unsigned tokens
 * and needs no permission at all), and the failure lands at the very last step
 * of pairing, inside a poll the kiosk deliberately treats as a flaky lobby
 * network. So the grant can be missing for as long as nobody reads the function
 * logs.
 *
 * This module is the check that closes that gap: Settings asks, and the answer
 * comes from actually signing something rather than from inspecting policy.
 * Reading the IAM policy would need a further permission and would still only
 * describe the grant — signing proves it.
 */

import { resolveRuntimeIdentity, type RuntimeIdentity } from './runtimeIdentity.js';

/** How a signing attempt turned out. */
export type SigningState = 'ok' | 'denied' | 'unknown';

export interface SigningStatus {
  state: SigningState;
  /**
   * Which deployment answered, and as whom.
   *
   * Both were once read only on the way to a remedy, on the argument that
   * signing usually works and the metadata server has no part in saying so.
   * That left "Ready to pair" — a green badge and nothing else — identical in
   * staging and in production, on the one screen somebody opens *because* a
   * lobby iPad is not pairing and they are no longer sure which of the two
   * they are looking at. Either may be null: there is no metadata server on a
   * laptop or in the emulator, and an answer about IAM must not hang waiting
   * for one.
   */
  project: string | null;
  serviceAccount: string | null;
  /** Null when signing works; otherwise the reason, in plain language. */
  problem: string | null;
  /** The remedy, when there is one a leader can hand to whoever runs the project. */
  remedy: string | null;
  /**
   * The remedy as something to paste into a terminal, when it can be written
   * out. Separate from `remedy` so the screen can offer it as a command —
   * monospaced, copyable, unwrapped — rather than as a sentence to retype.
   */
  command: string | null;
}

/**
 * The permission shows up under several names depending on which layer refuses:
 * the Admin SDK's own error code, the IAM Credentials API's method name, or the
 * role that would have granted it. Matching on any of them is what keeps this
 * honest across SDK versions — the alternative is matching one exact string and
 * silently reporting `unknown` the day it changes.
 */
const DENIAL_MARKERS = [
  'iam.serviceaccounts.signblob',
  'signblob',
  'serviceaccounttokencreator',
  'auth/insufficient-permission',
  'permission_denied',
  'permission denied',
];

/**
 * Deliberately not a plausible account id. Custom-token minting creates no user,
 * but a token naming a uid that later exists would be a way in, and this one
 * cannot be registered through any sign-in method.
 */
export const SIGNING_PROBE_UID = 'kiosk-signing-probe.invalid';

/**
 * A service account named inside an IAM refusal, if it named one.
 *
 * The message varies by layer — some refusals spell the resource out as
 * `projects/-/serviceAccounts/<email>`, others only say that signBlob was
 * denied. Worth reading when it is there: it is the account the refusal was
 * actually about, which is the question a reader is left with otherwise.
 */
function accountInError(text: string): string | null {
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*gserviceaccount\.com/.exec(text)?.[0] ?? null;
}

const DOC_REFERENCE =
  'Background: docs/deployment-setup.md, "The kiosk needs two one-time grants".';

/**
 * What to do about it, said as concretely as this deployment allows.
 *
 * "Grant it to the functions' runtime service account" is only actionable to
 * someone who already knows which account that is, and the whole reason this
 * check exists is that they usually do not. So when the account is known it is
 * named, and when it is not the command looks it up first rather than leaving
 * a reader to guess between the compute default and whatever a deploy set.
 *
 * The role goes on the account itself, not on the project: that is the part
 * people get wrong, so both wordings say it.
 */
function remedyFor(
  identity: RuntimeIdentity,
  account: string | null,
): { remedy: string; command: string } {
  const project = identity.project ?? '<project-id>';
  const projectFlag = `  --project ${project} \\\n`;

  if (account) {
    return {
      remedy:
        `These functions run as ${account}. Grant that account ` +
        'roles/iam.serviceAccountTokenCreator on itself — on the account, not on the project — ' +
        `then pair the kiosk again. Someone with owner access to ${project} can run this. ` +
        DOC_REFERENCE,
      command:
        `gcloud iam service-accounts add-iam-policy-binding ${account} \\\n` +
        projectFlag +
        `  --member="serviceAccount:${account}" \\\n` +
        '  --role=roles/iam.serviceAccountTokenCreator',
    };
  }

  return {
    remedy:
      'Tally could not read which service account these functions run as, so the first command ' +
      'below asks Google for it — it is also shown as "Service account" on the function’s ' +
      'Details tab in the Cloud console, and on a project that never changed it, it is ' +
      '<project-number>-compute@developer.gserviceaccount.com. That account needs ' +
      'roles/iam.serviceAccountTokenCreator on itself — on the account, not on the project. ' +
      `Someone with owner access to ${project} can run this, then pair the kiosk again. ` +
      DOC_REFERENCE,
    command:
      `SA=$(gcloud functions describe ${identity.service} --gen2 \\\n` +
      `  --region ${identity.region} --project ${project} \\\n` +
      "  --format='value(serviceConfig.serviceAccountEmail)')\n" +
      'gcloud iam service-accounts add-iam-policy-binding "$SA" \\\n' +
      projectFlag +
      '  --member="serviceAccount:$SA" \\\n' +
      '  --role=roles/iam.serviceAccountTokenCreator',
  };
}

function textOf(error: unknown): string {
  if (error instanceof Error) {
    // Firebase's auth errors carry the useful half in `code`, and the SDK's
    // wrapped cause often carries the IAM detail the top-level message drops.
    const code = (error as { code?: unknown }).code;
    const parts = [error.message, typeof code === 'string' ? code : ''];
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) parts.push(cause.message);
    return parts.join(' ');
  }
  return typeof error === 'string' ? error : JSON.stringify(error ?? '');
}

/** True when this error is the missing-grant one rather than any other failure. */
export function isSigningDenial(error: unknown): boolean {
  const haystack = textOf(error).toLowerCase();
  return DENIAL_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Signs a throwaway token and reports whether it worked.
 *
 * `mint` is injected so this stays a unit rather than a deploy: the callable
 * passes `createCustomToken`, the tests pass a function that throws whatever a
 * real refusal looks like. `describeIdentity` is injected for the same reason.
 * It is now asked on every path rather than only on a refusal: the answer names
 * the deployment it is about, and "signing works" is exactly as ambiguous
 * between staging and production as "signing does not" — see `SigningStatus`.
 * The read is cached per instance and bounded by a one-second timeout, so the
 * cost is one link-local request on the first call of an instance's life.
 *
 * The minted token is discarded here and never leaves the function. It is a
 * real credential for as long as it exists, so the uid it names is one no
 * account can hold, and it carries no `kiosk` claim — a leaked probe token
 * would authorise nothing.
 */
export async function probeSigning(
  mint: (uid: string) => Promise<string>,
  describeIdentity: () => Promise<RuntimeIdentity> = resolveRuntimeIdentity,
): Promise<SigningStatus> {
  const identity = await describeIdentity();
  const where = { project: identity.project, serviceAccount: identity.serviceAccount };

  try {
    await mint(SIGNING_PROBE_UID);
    return { state: 'ok', ...where, problem: null, remedy: null, command: null };
  } catch (error) {
    if (isSigningDenial(error)) {
      // The runtime's own answer first: it is what these functions authenticate
      // as. The refusal's wording is the fallback, for when there is no
      // metadata server to ask.
      const account = identity.serviceAccount ?? accountInError(textOf(error));
      const { remedy, command } = remedyFor(identity, account);
      return {
        state: 'denied',
        ...where,
        // A refusal can name the account when the metadata server could not, and
        // that is the one this reader has to act on.
        serviceAccount: account,
        problem:
          'This project cannot sign kiosk tokens, so pairing a kiosk will hang at the last ' +
          'step — the code stays on screen after it is approved.',
        remedy,
        command,
      };
    }
    return {
      state: 'unknown',
      ...where,
      problem:
        'Tally could not tell whether kiosk tokens can be signed: ' +
        textOf(error).slice(0, 200),
      remedy: null,
      command: null,
    };
  }
}
