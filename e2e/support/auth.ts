/**
 * Signing in the way a counselor actually does.
 *
 * The magic-link flow is worth exercising rather than shortcutting: it is the
 * only path most volunteers will ever take, it crosses Auth, Firestore rules and
 * the `provisionAccess` callable, and every one of those can fail on its own.
 * The Auth emulator hands out the link over REST instead of sending mail, so the
 * test can pick it up the way an inbox would.
 */
import type { Page } from '@playwright/test';
import { E2E } from '../../playwright.config';

/** Seeded by `scripts/seed.ts` into `accessRoster`. */
export const TEAM = {
  admin: 'dana.ruiz@footprints.example.org',
  core: 'miriam.achebe@footprints.example.org',
  counselor: 'sam.whitfield@footprints.example.org',
} as const;

export type TeamRole = keyof typeof TEAM;

interface OobCode {
  email: string;
  oobLink: string;
  requestType: string;
}

async function latestSignInLink(email: string): Promise<string> {
  const response = await fetch(
    `http://127.0.0.1:${E2E.auth}/emulator/v1/projects/${E2E.projectId}/oobCodes`,
  );
  if (!response.ok) {
    throw new Error(`Could not read sign-in codes from the Auth emulator: HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { oobCodes?: OobCode[] };
  const codes = (body.oobCodes ?? []).filter(
    (code) => code.email.toLowerCase() === email.toLowerCase(),
  );

  const latest = codes.at(-1);
  if (!latest) {
    throw new Error(
      `No sign-in link was issued for ${email}. Either the form did not submit, or the Auth ` +
        'emulator is not the one the app is pointed at.',
    );
  }
  return latest.oobLink;
}

/**
 * The emulator's link lands on its own action page, which then bounces to the
 * app's `continueUrl`. Rewriting it directly avoids depending on that
 * intermediate page's markup, which is emulator implementation detail.
 */
function toAppUrl(oobLink: string): string {
  const link = new URL(oobLink);
  const continueUrl = link.searchParams.get('continueUrl') ?? `${E2E.baseURL}/login`;

  const target = new URL(continueUrl);
  for (const key of ['mode', 'oobCode', 'apiKey', 'lang']) {
    const value = link.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return target.toString();
}

/**
 * Signs in and waits until the app is genuinely usable — not merely past the
 * login form. For a counselor that means the roster; the check-in screen is the
 * landing page for every role.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');

  await page.getByLabel(/email/i).fill(email);
  await page.getByRole('button', { name: /send sign-in link/i }).click();

  // The emulator issues the code synchronously, but the app's own request has to
  // land first; poll rather than sleep.
  const deadline = Date.now() + 15_000;
  let link = '';
  while (Date.now() < deadline) {
    try {
      link = await latestSignInLink(email);
      break;
    } catch {
      await page.waitForTimeout(250);
    }
  }
  if (!link) link = await latestSignInLink(email);

  await page.goto(toAppUrl(link));

  // `provisionAccess` may have to mint the users/{uid} document on first sign-in,
  // so allow for the callable round-trip before the shell appears.
  await page.getByRole('navigation').or(page.getByRole('banner')).first().waitFor({ timeout: 30_000 });
}

/**
 * Navigates and waits until the app has finished restoring the session.
 *
 * A bare `page.goto` returns as soon as the document loads, but Tally then has
 * to re-resolve the Firebase session before it renders anything real. On a
 * mobile user agent that restore can take tens of seconds when the network
 * blocks Google's auth endpoints, so asserting straight after a navigation
 * races the spinner rather than the app.
 */
export async function gotoReady(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitUntilReady(page);
}

/** `page.reload()` with the same wait — a reload re-runs the whole restore. */
export async function reloadReady(page: Page): Promise<void> {
  await page.reload();
  await waitUntilReady(page);
}

async function waitUntilReady(page: Page): Promise<void> {
  await page
    .getByRole('status', { name: /loading/i })
    .first()
    .waitFor({ state: 'detached', timeout: 60_000 })
    .catch(() => {
      // Already gone by the time we looked, which is the happy path.
    });
}
