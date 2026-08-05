/**
 * Which service account these functions actually run as.
 *
 * The kiosk signing check can tell a leader that a grant is missing, but
 * "grant it to the functions' runtime service account" is only useful to
 * someone who already knows which account that is — and the answer differs per
 * project (the compute default on most, something custom where a deploy set
 * one). A deployed function does not have to guess: the metadata server tells
 * it its own identity, so the remedy can name the account and be pasted.
 *
 * Nothing here is required for the check to work. Every lookup falls back to
 * null, and the caller words the remedy accordingly — an emulator, where there
 * is no metadata server at all, must not hang or throw on the way to an answer
 * about IAM.
 */

const METADATA_ROOT = 'http://metadata.google.internal/computeMetadata/v1';

/**
 * Short on purpose. On a real deploy this is a link-local request that answers
 * in single-digit milliseconds; anywhere else it fails immediately or not at
 * all, and this is what bounds the "not at all" case.
 */
const METADATA_TIMEOUT_MS = 1_000;

/** Matches `setGlobalOptions` in index.ts, for when metadata cannot be read. */
const FALLBACK_REGION = 'us-central1';

/** The callable that runs the probe, for when `K_SERVICE` is not set. */
const FALLBACK_SERVICE = 'getKioskStatus';

export interface RuntimeIdentity {
  /** The runtime service account's email, or null when it could not be read. */
  serviceAccount: string | null;
  /** The project these functions are deployed in, or null. */
  project: string | null;
  /** The region they are deployed to — needed to describe them from a shell. */
  region: string;
  /** Their deployed name, likewise. */
  service: string;
}

async function metadata(path: string): Promise<string | null> {
  try {
    const response = await fetch(`${METADATA_ROOT}/${path}`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.text()).trim() || null;
  } catch {
    // No metadata server (emulator, a test, a laptop), or it did not answer in
    // time. Either way the caller has a wording that does not need the answer.
    return null;
  }
}

/** The project id, from wherever the runtime happens to have put it. */
export function projectId(): string | null {
  const direct = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (direct) return direct;
  try {
    const config: unknown = JSON.parse(process.env.FIREBASE_CONFIG ?? '{}');
    const id = (config as { projectId?: unknown }).projectId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/** Reads the identity fresh. Exported for tests; callers want the cached one. */
export async function readRuntimeIdentity(): Promise<RuntimeIdentity> {
  const [email, region] = await Promise.all([
    metadata('instance/service-accounts/default/email'),
    metadata('instance/region'),
  ]);
  return {
    // `FUNCTION_IDENTITY` is set on 1st-gen functions and absent on 2nd-gen, so
    // it is a fallback rather than the first choice.
    serviceAccount: email ?? process.env.FUNCTION_IDENTITY ?? null,
    project: projectId(),
    // Cloud Run reports it as `projects/<number>/regions/<region>`.
    region: region?.split('/').pop() || FALLBACK_REGION,
    service: process.env.K_SERVICE || FALLBACK_SERVICE,
  };
}

let cached: RuntimeIdentity | null = null;

/**
 * The identity of this instance, read once.
 *
 * Only a complete answer is cached: a failed metadata read is usually "there
 * is no metadata server here", but it can also be a timeout under load, and
 * caching that would leave every later remedy vaguer than it needed to be for
 * the life of the instance.
 */
export async function resolveRuntimeIdentity(): Promise<RuntimeIdentity> {
  if (cached) return cached;
  const identity = await readRuntimeIdentity();
  if (identity.serviceAccount) cached = identity;
  return identity;
}
