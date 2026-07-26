/**
 * Talking to Google's APIs from CI, with a service account key.
 *
 * Shared by the two scripts that do something the Firebase CLI is supposed to
 * do and does not — registering a preview channel's sign-in domain
 * (`authorized-domains.ts`) and keeping the callable functions reachable from a
 * browser (`callable-invokers.ts`). Both need the same three things: a token, a
 * loud failure, and the address of the account that failed, because a project
 * has several service accounts and a 403 almost always means the role went to a
 * different one.
 */
import { createSign } from 'node:crypto';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export function fail(message: string): never {
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

/** Parses a whole key file out of an environment variable, or exits saying why. */
export function serviceAccountKey(variable: string): ServiceAccountKey {
  const raw = process.env[variable]?.trim();
  if (!raw) fail(`${variable} is not set.`);

  let key: ServiceAccountKey;
  try {
    key = JSON.parse(raw) as ServiceAccountKey;
  } catch {
    fail(`${variable} is not valid JSON. It should be the whole key file.`);
  }
  if (!key.client_email || !key.private_key) {
    fail(`${variable} has no client_email/private_key — is it a service account key?`);
  }
  return key;
}

/**
 * Exchanges a service account key for an access token, directly.
 *
 * Deliberately not `google-github-actions/auth`: asked for an access token it
 * goes through the IAM Credentials API, which requires the key to hold
 * `roles/iam.serviceAccountTokenCreator` *on itself*. That is one more IAM
 * grant to get wrong, for a token the key can mint on its own — signing a JWT
 * and trading it in is what a service account key is for.
 */
export async function accessToken(key: ServiceAccountKey): Promise<string> {
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
