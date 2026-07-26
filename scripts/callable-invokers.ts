/**
 * Keeps every callable Cloud Function reachable from a browser.
 *
 * ## Why this exists
 *
 * A 2nd-gen callable is a Cloud Run service, and a Cloud Run service that does
 * not grant `roles/run.invoker` to `allUsers` rejects the request before the
 * container ever sees it — including the CORS *preflight*, which by definition
 * carries no `Authorization` header:
 *
 *     OPTIONS /getPersonDetails → 403
 *     "Empty Authorization header value."
 *
 * The browser cannot see that 403. All it reports is
 *
 *     No 'Access-Control-Allow-Origin' header is present on the requested
 *     resource
 *
 * which reads like a CORS bug in the function and is not one: `onCall` answers
 * preflights itself and always has. Nothing in this repository can fix it,
 * because the request never arrives. The fix is an IAM binding on the service.
 *
 * That binding is *not* what keeps a caller out. Authentication is the Firebase
 * ID token inside the request body's `Authorization` header, which `onCall`
 * verifies and every function here then checks against Tally's own roles
 * (`requireCoreTeam` and friends). "Unauthenticated invocations allowed" means
 * "the door answers when knocked on", not "the door is open" — see
 * https://firebase.google.com/docs/functions/callable#deploying.
 *
 * `firebase deploy` sets the binding when it *creates* a function, and never
 * again. So a service whose binding is removed afterwards — an org policy
 * sweep, a hand edit in the console, a project-wide IAM tidy-up — stays broken
 * through every subsequent deploy, which is exactly what a callable failing in
 * production while its code is plainly correct looks like.
 *
 * So Tally asserts it after each deploy, for every function Firebase labelled
 * callable, and fails loudly when it cannot:
 *
 *     npm run functions:invokers
 *
 * The project comes from `FIREBASE_PROJECT_ID` or `.firebaserc`, the region
 * from `FUNCTIONS_REGION` (default `us-central1`), and the credential from
 * `FIREBASE_SERVICE_ACCOUNT` — the backend deploy key in CI — falling back to
 * whoever `gcloud` is logged in as, so a maintainer can run it by hand after a
 * manual deploy. It is idempotent: a service that already grants the binding is
 * reported and left alone, so this is safe to run at any time.
 *
 * The event-triggered functions are deliberately untouched. `onStudentCreated`
 * is invoked by Eventarc as the project's compute service account and must stay
 * private; it carries no callable label, so it is never in the list.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { accessToken, fail, serviceAccountKey } from './google-auth';

const CLOUD_FUNCTIONS = 'https://cloudfunctions.googleapis.com/v2';
const CLOUD_RUN = 'https://run.googleapis.com/v2';

/** The label `firebase deploy` puts on a callable, and on nothing else. */
const CALLABLE_LABEL = 'deployment-callable';

const INVOKER = 'roles/run.invoker';
const EVERYONE = 'allUsers';

/**
 * Which account is acting, named in every error.
 *
 * The backend deploy key, the Hosting one, `firebase-adminsdk-*`, whatever
 * `firebase init` created — a 403 here is nearly always the role sitting on a
 * different one of those, which looks identical to not having granted it.
 */
let caller = '(unknown)';

interface CloudFunction {
  name: string;
  labels?: Record<string, string>;
  serviceConfig?: { service?: string; uri?: string };
}

interface Binding {
  role: string;
  members?: string[];
  condition?: unknown;
}

interface Policy {
  version?: number;
  etag?: string;
  bindings?: Binding[];
}

/** `projects/p/locations/us-central1/functions/getPersonDetails` → the last part. */
function shortName(resource: string): string {
  return resource.split('/').pop() ?? resource;
}

async function google(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

/**
 * Every callable in the region, with the Cloud Run service behind it.
 *
 * Read from the Cloud Functions API rather than assembled from the source,
 * because the thing being fixed is the state of the *project*: a function this
 * repository no longer declares can still be deployed and broken, and a
 * function added tomorrow needs no edit here to be covered.
 */
async function listCallables(
  projectId: string,
  region: string,
  token: string,
): Promise<CloudFunction[]> {
  const parent = `projects/${projectId}/locations/${region}`;
  const functions: CloudFunction[] = [];
  let pageToken = '';

  do {
    const url = new URL(`${CLOUD_FUNCTIONS}/${parent}/functions`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await google(url.toString(), token);
    const body = await response.text();

    if (!response.ok) {
      fail(
        `Could not list the Cloud Functions in ${parent}: ${response.status} ${body}\n` +
          `The account acting here is ${caller}. It needs cloudfunctions.functions.list — ` +
          'roles/cloudfunctions.admin, which the backend deploy key already holds. See ' +
          'docs/deployment-setup.md#callable-functions-must-allow-unauthenticated-invocations.',
      );
    }

    const page = JSON.parse(body) as { functions?: CloudFunction[]; nextPageToken?: string };
    functions.push(...(page.functions ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);

  if (functions.length === 0) {
    fail(
      `No Cloud Functions are deployed in ${parent}. Deploy them first: ` +
        'npx firebase deploy --only functions.',
    );
  }

  const callables = functions.filter((fn) => fn.labels?.[CALLABLE_LABEL] === 'true');

  if (callables.length === 0) {
    // Silence would be the dangerous outcome: "checked 0 functions, all fine"
    // is what this script exists to stop happening.
    fail(
      `None of the ${functions.length} functions in ${parent} carry the "${CALLABLE_LABEL}" ` +
        'label, so this script cannot tell which are callable and has changed nothing. That ' +
        'label is set by `firebase deploy`; if it has been renamed or dropped, this script ' +
        'needs updating rather than ignoring.',
    );
  }

  return callables;
}

async function readPolicy(service: string, token: string): Promise<Policy> {
  // Version 3 or a conditional binding on the service comes back rejected
  // rather than returned, and writing the policy back would then drop it.
  const url = `${CLOUD_RUN}/${service}:getIamPolicy?options.requestedPolicyVersion=3`;
  const response = await google(url, token);
  const body = await response.text();

  if (!response.ok) {
    fail(
      `Could not read the IAM policy of ${shortName(service)}: ${response.status} ${body}\n` +
        `${caller} needs run.services.getIamPolicy and run.services.setIamPolicy on ` +
        `${projectOf(service)} — both are in roles/cloudfunctions.admin, and ` +
        'roles/run.admin carries them too. See ' +
        'docs/deployment-setup.md#callable-functions-must-allow-unauthenticated-invocations.',
    );
  }

  return JSON.parse(body) as Policy;
}

function projectOf(service: string): string {
  return service.split('/')[1] ?? '(unknown project)';
}

/** True when unauthenticated requests — and so preflights — already get through. */
function alreadyOpen(policy: Policy): boolean {
  return (policy.bindings ?? []).some(
    (binding) =>
      binding.role === INVOKER && !binding.condition && (binding.members ?? []).includes(EVERYONE),
  );
}

/**
 * Adds `allUsers` to the invoker binding, leaving every other binding alone.
 *
 * A conditional invoker binding is not reused: a condition is somebody's
 * deliberate restriction, and widening it silently would be the wrong repair.
 * The unconditional binding is added beside it instead.
 */
function withEveryone(policy: Policy): Policy {
  const bindings = (policy.bindings ?? []).map((binding) => ({ ...binding }));
  const existing = bindings.find((binding) => binding.role === INVOKER && !binding.condition);

  if (existing) existing.members = [...(existing.members ?? []), EVERYONE];
  else bindings.push({ role: INVOKER, members: [EVERYONE] });

  return { ...policy, bindings };
}

async function open(service: string, token: string, policy: Policy): Promise<void> {
  const response = await google(`${CLOUD_RUN}/${service}:setIamPolicy`, token, {
    method: 'POST',
    // The etag is what makes this safe to run beside a deploy: a policy changed
    // since the read is rejected rather than overwritten.
    body: JSON.stringify({ policy: withEveryone(policy) }),
  });

  if (!response.ok) {
    const body = await response.text();
    const restricted = body.includes('allowedPolicyMemberDomains') || body.includes('org policy');

    fail(
      `Could not allow unauthenticated invocations of ${shortName(service)}: ` +
        `${response.status} ${body}\n` +
        (restricted
          ? 'The organisation policy constraints/iam.allowedPolicyMemberDomains forbids granting ' +
            'anything to allUsers, so no credential can make this call succeed. Either exempt ' +
            `${projectOf(service)} from that constraint, or put the callables behind a Firebase ` +
            'Hosting rewrite and grant the Hosting service agent the invoker role instead.'
          : `${caller} can read the policy but not write it, so it holds something narrower than ` +
            'run.services.setIamPolicy — the read succeeding does not imply the write. A stale ' +
            'read is the other possibility: re-running this is safe and picks up a fresh etag.') +
        '\nSee docs/deployment-setup.md#callable-functions-must-allow-unauthenticated-invocations.',
    );
  }
}

function projectFromFirebaserc(): string | undefined {
  try {
    const rc = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
    return rc.projects?.default;
  } catch {
    return undefined;
  }
}

/**
 * The deploy key in CI; whoever is logged in to `gcloud` by hand.
 *
 * The fallback is what makes this usable the moment a callable breaks, without
 * anybody having to mint a key first — and a human deploying with
 * `npm run deploy` has no service account key at all, only a Firebase CLI
 * login, which does not yield a Google access token.
 */
async function token(): Promise<string> {
  if (process.env.FIREBASE_SERVICE_ACCOUNT?.trim()) {
    const key = serviceAccountKey('FIREBASE_SERVICE_ACCOUNT');
    caller = key.client_email;
    return accessToken(key);
  }

  try {
    const value = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    caller = execFileSync('gcloud', ['config', 'get-value', 'account'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!value) throw new Error('gcloud printed no token');
    return value;
  } catch (err) {
    fail(
      'No credential to act with. Set FIREBASE_SERVICE_ACCOUNT to a service account key (this is ' +
        'what CI does with FIREBASE_SERVICE_ACCOUNT_TALLY_BACKEND), or run `gcloud auth login` ' +
        `first. gcloud said: ${(err as Error).message}`,
    );
  }
}

async function main(): Promise<void> {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || projectFromFirebaserc();
  if (!projectId) fail('FIREBASE_PROJECT_ID is not set and .firebaserc has no default project.');

  const region = process.env.FUNCTIONS_REGION?.trim() || 'us-central1';
  const access = await token();
  console.log(`Acting as ${caller} on ${projectId} (${region}).`);

  const callables = await listCallables(projectId, region, access);
  let opened = 0;

  for (const fn of callables) {
    const service = fn.serviceConfig?.service;
    const name = shortName(fn.name);

    if (!service) {
      fail(
        `${name} is callable but reports no Cloud Run service, so its invokers cannot be ` +
          'checked. A deploy that is still rolling out can look like this — try again in a ' +
          'minute.',
      );
    }

    const policy = await readPolicy(service, access);

    if (alreadyOpen(policy)) {
      console.log(`  ${name}: already answers unauthenticated requests.`);
      continue;
    }

    await open(service, access, policy);
    opened++;
    console.log(
      `  ${name}: opened to unauthenticated requests — it was rejecting every CORS preflight, ` +
        'so the browser saw a missing Access-Control-Allow-Origin header.',
    );
  }

  console.log(
    opened === 0
      ? `All ${callables.length} callable functions were already reachable.`
      : `Fixed ${opened} of ${callables.length} callable functions. IAM changes can take a minute ` +
          'to take effect.',
  );
}

await main();
