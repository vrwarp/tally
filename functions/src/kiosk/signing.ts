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

/** How a signing attempt turned out. */
export type SigningState = 'ok' | 'denied' | 'unknown';

export interface SigningStatus {
  state: SigningState;
  /** Null when signing works; otherwise the reason, in plain language. */
  problem: string | null;
  /** The remedy, when there is one a leader can hand to whoever runs the project. */
  remedy: string | null;
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

const REMEDY =
  'Grant the functions’ runtime service account roles/iam.serviceAccountTokenCreator on ' +
  'itself, then pair the kiosk again. See docs/deployment-setup.md, "The kiosk needs two ' +
  'one-time grants".';

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
 * real refusal looks like.
 *
 * The minted token is discarded here and never leaves the function. It is a
 * real credential for as long as it exists, so the uid it names is one no
 * account can hold, and it carries no `kiosk` claim — a leaked probe token
 * would authorise nothing.
 */
export async function probeSigning(
  mint: (uid: string) => Promise<string>,
): Promise<SigningStatus> {
  try {
    await mint(SIGNING_PROBE_UID);
    return { state: 'ok', problem: null, remedy: null };
  } catch (error) {
    if (isSigningDenial(error)) {
      return {
        state: 'denied',
        problem:
          'This project cannot sign kiosk tokens, so pairing a kiosk will hang at the last ' +
          'step — the code stays on screen after it is approved.',
        remedy: REMEDY,
      };
    }
    return {
      state: 'unknown',
      problem:
        'Tally could not tell whether kiosk tokens can be signed: ' +
        textOf(error).slice(0, 200),
      remedy: null,
    };
  }
}
