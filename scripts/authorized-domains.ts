/**
 * Adds and removes Firebase Auth *authorized domains* from CI.
 *
 * ## Why this exists
 *
 * A preview channel is served from a URL nobody can predict —
 * `tally-76406--pr29-some-branch-47da0eby.web.app` — and Firebase Auth refuses
 * to start a sign-in from any host that is not on the project's authorized
 * domains list. The client SDK checks it before opening the popup, so the
 * failure is immediate and total: `auth/unauthorized-domain`, and a preview
 * nobody can sign in to is a preview of the login screen.
 *
 * `firebase hosting:channel:deploy` is supposed to handle this by itself — it
 * calls the Identity Toolkit admin API after each deploy and appends the
 * channel's host. On this project it silently does not, for two reasons that
 * compound:
 *
 *  1. The CLI sends `x-goog-user-project: <project>` on both the read and the
 *     write. That header makes the caller the *quota* project, which Google
 *     only allows if the caller holds `serviceusage.services.use`. Neither
 *     `roles/firebase.hostingAdmin` nor `roles/firebaseauth.admin` carries it,
 *     so the call 403s no matter how much Auth access the key is given.
 *  2. When the sync fails the CLI logs a warning and carries on — and
 *     `action-hosting-deploy` invokes it with `--json`, which suppresses
 *     warnings. The deploy is green, the preview is up, and the only evidence
 *     that sign-in is broken is a user hitting the login screen.
 *
 * So Tally does the registration itself, against the same API, without that
 * header — which means the deploy key needs Auth access and nothing else — and
 * fails loudly when it cannot.
 *
 *   tsx scripts/authorized-domains.ts add https://tally-76406--pr29-x-ab12.web.app
 *   tsx scripts/authorized-domains.ts remove-prefix tally-76406--pr29-
 *
 * Both read the service account key from `FIREBASE_SERVICE_ACCOUNT` and the
 * project from `FIREBASE_PROJECT_ID`. Both are idempotent: adding a domain
 * already on the list, or removing a prefix that matches nothing, is a no-op
 * that exits 0. That matters because every push to a pull request re-runs the
 * add, and a pull request can be closed twice.
 */
import { createSign } from 'node:crypto';

const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** How many times to re-read and re-write when another job races us. */
const ATTEMPTS = 3;

/**
 * Which service account is acting, named in every error.
 *
 * A project has several — the Hosting deploy key, the backend one, whatever
 * `firebase init` left behind, `firebase-adminsdk-*` — and a 403 here almost
 * always means the role went to a different one than the key in
 * `FIREBASE_SERVICE_ACCOUNT_TALLY`. Without the address in the message the only
 * way to tell which is to open each key and compare, so it is worth printing.
 * The address is an identifier, not a credential; the secret is the private key
 * beside it, which never leaves this process.
 */
let caller = '(unknown)';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function fail(message: string): never {
  // `::error::` renders as an annotation on the job rather than a line buried
  // in the log, which is the whole point of doing this in the open.
  console.error(`::error::${message.replace(/\n/g, '%0A')}`);
  process.exit(1);
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Exchanges the service account key for an access token, directly.
 *
 * Deliberately not `google-github-actions/auth`: asked for an access token it
 * goes through the IAM Credentials API, which requires the key to hold
 * `roles/iam.serviceAccountTokenCreator` *on itself*. That is one more IAM
 * grant to get wrong, for a token the key can mint on its own — signing a JWT
 * and trading it in is what a service account key is for.
 */
async function accessToken(key: ServiceAccountKey): Promise<string> {
  const issued = Math.floor(Date.now() / 1000);
  const claims = {
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: issued,
    exp: issued + 3600,
  };

  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify(claims),
  )}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    fail(`Could not get an access token for ${key.client_email}: ${response.status} ${body}`);
  }

  const token = (JSON.parse(body) as { access_token?: string }).access_token;
  if (!token) fail(`The token endpoint returned no access_token: ${body}`);
  return token;
}

function configUrl(projectId: string): string {
  return `${IDENTITY_TOOLKIT}/admin/v2/projects/${projectId}/config`;
}

/**
 * The current list.
 *
 * Note the absence of `x-goog-user-project` — see the header comment. Without
 * it the request is billed to the service account's own project, which is this
 * one, and `roles/firebaseauth.admin` alone is enough.
 */
async function readDomains(projectId: string, token: string): Promise<string[]> {
  const response = await fetch(configUrl(projectId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.text();

  if (!response.ok) {
    fail(
      `Could not read the Firebase Auth config for ${projectId}: ${response.status} ${body}\n` +
        `The account in FIREBASE_SERVICE_ACCOUNT_TALLY is ${caller}. It needs ` +
        `roles/firebaseauth.admin on ${projectId} — grant it to that address exactly, since a ` +
        'project has several service accounts and the role does nothing on the others:\n' +
        `  gcloud projects add-iam-policy-binding ${projectId} \\\n` +
        `    --member=serviceAccount:${caller} --role=roles/firebaseauth.admin\n` +
        'PERMISSION_DENIED means the grant is missing or on another account; a message about the ' +
        'API being disabled means Identity Toolkit (identitytoolkit.googleapis.com) needs ' +
        'enabling instead. See docs/deployment-setup.md#preview-channels-and-sign-in.',
    );
  }

  return (JSON.parse(body) as { authorizedDomains?: string[] }).authorizedDomains ?? [];
}

async function writeDomains(projectId: string, token: string, domains: string[]): Promise<void> {
  const response = await fetch(`${configUrl(projectId)}?updateMask=authorizedDomains`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorizedDomains: domains }),
  });

  if (!response.ok) {
    const body = await response.text();
    fail(
      `Could not update the authorized domains for ${projectId}: ${response.status} ${body}\n` +
        `${caller} can read the Auth config but not write it, so it holds something narrower ` +
        'than roles/firebaseauth.admin — the read above succeeding does not imply the write. ' +
        'See docs/deployment-setup.md#preview-channels-and-sign-in.',
    );
  }
}

/** `https://host/path` and `host` both reduce to `host`. */
function hostOf(value: string): string {
  const bare = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return bare.split('/')[0].toLowerCase();
}

/**
 * Read, change, write — retried, because the list is one field with no etag.
 *
 * Two pull requests deploying at the same moment both read the list, both
 * append their own host, and the second write erases the first's. Nothing in
 * the API prevents that, so the guard is to re-read afterwards and, if the
 * change did not survive, do it again. `change` is called fresh each attempt so
 * it always sees the list as it is now, not as it was when we started.
 */
async function amend(
  projectId: string,
  token: string,
  change: (current: string[]) => string[] | undefined,
  describe: (result: string[]) => string,
): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const current = await readDomains(projectId, token);
    const next = change(current);

    if (!next) {
      console.log(describe(current));
      return;
    }

    await writeDomains(projectId, token, next);

    const settled = await readDomains(projectId, token);
    if (!change(settled)) {
      console.log(describe(settled));
      return;
    }

    console.log(
      `Another deploy rewrote the authorized domains while this one was writing ` +
        `(attempt ${attempt} of ${ATTEMPTS}).`,
    );
  }

  fail(
    `Gave up after ${ATTEMPTS} attempts: another job kept overwriting the authorized domains. ` +
      'Re-running this workflow is safe and should settle it.',
  );
}

async function add(projectId: string, token: string, target: string): Promise<void> {
  const host = hostOf(target);
  if (!host) fail(`"${target}" is not a domain this can add.`);

  await amend(
    projectId,
    token,
    (current) => (current.includes(host) ? undefined : [...current, host]),
    () => `${host} can now be used for sign-in.`,
  );
}

async function removePrefix(projectId: string, token: string, prefix: string): Promise<void> {
  const match = prefix.trim().toLowerCase();
  if (!match) fail('remove-prefix needs a prefix to match.');

  await amend(
    projectId,
    token,
    (current) => {
      const kept = current.filter((domain) => !domain.toLowerCase().startsWith(match));
      return kept.length === current.length ? undefined : kept;
    },
    (settled) => {
      const remaining = settled.filter((domain) => domain.toLowerCase().startsWith(match));
      return remaining.length === 0
        ? `No authorized domains start with ${match}.`
        : `${remaining.length} domain(s) starting with ${match} are still authorized.`;
    },
  );
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) fail('FIREBASE_PROJECT_ID is not set.');

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) fail('FIREBASE_SERVICE_ACCOUNT is not set.');

  let key: ServiceAccountKey;
  try {
    key = JSON.parse(raw) as ServiceAccountKey;
  } catch {
    fail('FIREBASE_SERVICE_ACCOUNT is not valid JSON. It should be the whole key file.');
  }
  if (!key.client_email || !key.private_key) {
    fail('FIREBASE_SERVICE_ACCOUNT has no client_email/private_key — is it a service account key?');
  }

  caller = key.client_email;
  console.log(`Acting as ${caller} on ${projectId}.`);

  const token = await accessToken(key);

  switch (command) {
    case 'add':
      if (!argument) fail('Usage: authorized-domains.ts add <url-or-host>');
      await add(projectId, token, argument);
      return;
    case 'remove-prefix':
      if (!argument) fail('Usage: authorized-domains.ts remove-prefix <prefix>');
      await removePrefix(projectId, token, argument);
      return;
    default:
      fail(`Unknown command "${command ?? ''}". Expected "add" or "remove-prefix".`);
  }
}

await main();
