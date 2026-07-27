/**
 * Signing in the way a counselor actually does.
 *
 * There is one way in — Google — and this drives the real thing: the button,
 * the popup, the emulator's account chooser standing in for Google, and then
 * `provisionAccess` deciding whether the address is a seeded admin, an invited
 * volunteer, or a stranger.
 *
 * ## The one environment where it cannot
 *
 * `signInWithPopup` boots Firebase's hidden iframe from `apis.google.com`
 * before it opens anything — unconditionally, since only the *iframe's URL* is
 * emulator-aware, not the loader that fetches gapi. A sandbox with no route to
 * Google therefore fails at Google's front door, with an `auth/internal-error`
 * and no popup, having tested nothing about Tally.
 *
 * So the suite probes for that once per run and falls back to a build-flagged
 * hook that mints the same credential (`src/lib/firebase.ts`), announcing it
 * loudly. The fallback still exercises everything that matters downstream —
 * the invitation lookup, the seeded-admin grant, the role, every rule that
 * reads the profile — because the session it produces carries
 * `sign_in_provider: google.com`, which is the only thing the server inspects.
 * What it does not cover is the handshake, and the log says so rather than
 * letting a green run imply otherwise.
 */
import { expect, type Page } from '@playwright/test';

/**
 * Who the seed authorises, and how.
 *
 * `admin` is deliberately not in Firestore at all: they come from
 * `TALLY_ADMIN_EMAILS`, which is the only way the first admin of a real install
 * can exist. The other two arrive on invitations `scripts/seed.ts` writes.
 */
export const TEAM = {
  admin: 'dana.ruiz@example.org',
  core: 'miriam.achebe@example.org',
  counselor: 'sam.whitfield@example.org',
} as const;

export type TeamRole = keyof typeof TEAM;

/** Display names, so the emulator's account chooser is readable in a trace. */
const DISPLAY_NAMES: Record<string, string> = {
  [TEAM.admin]: 'Dana Ruiz',
  [TEAM.core]: 'Miriam Achebe',
  [TEAM.counselor]: 'Sam Whitfield',
};

/**
 * Whether this browser can reach the script `signInWithPopup` needs.
 *
 * Probed once per run, and from inside the page rather than from Node: it is
 * the *browser's* route to Google that decides, and in a container those two
 * are not the same network.
 */
let popupSupported: boolean | null = null;

async function canUseGooglePopup(page: Page): Promise<boolean> {
  if (popupSupported !== null) return popupSupported;

  popupSupported = await page.evaluate(async () => {
    try {
      // `no-cors` because the answer wanted is "did anything arrive", not what.
      await fetch('https://apis.google.com/js/api.js', { mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch {
      return false;
    }
  });

  if (!popupSupported) {
    console.warn(
      '[e2e] apis.google.com is unreachable from the browser, so signInWithPopup cannot run ' +
        'here. Falling back to the emulator credential hook: everything after the credential ' +
        'is still exercised, the Google handshake is not.',
    );
  }
  return popupSupported;
}

/**
 * Completes the Auth emulator's stand-in for Google, in the popup it opened.
 *
 * The widget offers accounts it has seen before and a form for new ones, so
 * this takes whichever is on screen — reusing an existing account is also the
 * returning-volunteer path, which is worth exercising.
 */
async function completeGoogleSignIn(popup: Page, email: string): Promise<void> {
  await popup.waitForLoadState('domcontentloaded');

  const existing = popup.locator('#accounts-list').getByText(email, { exact: false }).first();
  if (await existing.isVisible({ timeout: 2000 }).catch(() => false)) {
    await existing.click();
    return;
  }

  await popup.locator('#add-account-button').click({ timeout: 15_000 });
  await popup.locator('#email-input').fill(email);

  const displayName = popup.locator('#display-name-input');
  if (await displayName.isVisible({ timeout: 2000 }).catch(() => false)) {
    await displayName.fill(DISPLAY_NAMES[email] ?? email);
  }

  await popup.locator('#sign-in').click();
}

/**
 * Signs in and waits until the app is genuinely usable — not merely past the
 * login form. For a counselor that means the roster; the check-in screen is the
 * landing page for every role.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');

  // Google, and nothing else: if a second way in ever reappears, this fails.
  const button = page.getByRole('button', { name: /continue with google/i });
  await button.waitFor({ timeout: 30_000 });

  if (await canUseGooglePopup(page)) {
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 30_000 }),
      button.click(),
    ]);
    await completeGoogleSignIn(popup, email);
    // The popup closes itself once the emulator posts the credential back. If
    // it lingers, the assertion below is the real check anyway.
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => popup.close());
  } else {
    await page.waitForFunction(() => '__tallyEmulatorSignIn' in window, undefined, {
      timeout: 30_000,
    });
    await page.evaluate(
      ([address, name]) =>
        (
          window as unknown as {
            __tallyEmulatorSignIn: (email: string, displayName?: string) => Promise<void>;
          }
        ).__tallyEmulatorSignIn(address!, name),
      [email, DISPLAY_NAMES[email] ?? email] as const,
    );
  }

  /*
   * Wait for the sign-in button to *go away*, not for a landmark to appear.
   *
   * The login screen has its own `banner`, and a counselor — who sees only one
   * tab — gets no `navigation` landmark at all, so waiting for either accepted
   * the page we were trying to leave. A failed sign-in then looked like a
   * successful one, and the test failed several steps later pointing at a
   * missing button instead of at the sign-in that never happened.
   *
   * `provisionAccess` may have to mint the users/{uid} document on first
   * sign-in, so this allows for a callable round-trip.
   */
  await button.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {
    throw new Error(
      `Signing in as ${email} left the login screen up. Either provisionAccess refused the ` +
        'address — no invitation, and not in TALLY_ADMIN_EMAILS — or the Google flow never ' +
        `completed (popup path: ${popupSupported ? 'yes' : 'no'}).`,
    );
  });
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

/**
 * Gets to a roster, the way a counselor does: by choosing tonight's gathering.
 *
 * `/` is a question now, not a roster. Tally used to answer it from the clock
 * and open straight into the list, and every spec below simply landed there
 * after signing in. This is the tap that replaced that, factored out because
 * three specs need it and because the day it changes again there should be one
 * place to change.
 *
 * The card whose check-in window is open sorts to the top of the chooser, so
 * the first one is the one a counselor at a door would reach for. The seed
 * guarantees something is live — see `buildEvents` in `scripts/seed.ts`.
 */
export async function openCheckIn(page: Page): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith('/event/')) {
    await gotoReady(page, '/');
  }

  const card = page.getByRole('link', { name: /start check-in|take attendance/i }).first();
  await card.waitFor({ timeout: 30_000 }).catch(() => {
    throw new Error(
      'No gathering was offered on the check-in screen. The seed guarantees one is live, ' +
        'so either seeding did not run or the chooser is broken.',
    );
  });
  await card.click();
  await page.getByLabel(/search students by name/i).waitFor({ timeout: 30_000 });
}

/**
 * Signs out through the app's own menu, then clears the Firebase session from
 * the browser.
 *
 * Both halves are needed: the menu is the real user-facing path, but Firebase
 * keeps its session in IndexedDB, and a stale one makes the next sign-in skip
 * the login form entirely.
 */
export async function signOut(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: /signed in|@/i }).first();
  if (await menu.count()) {
    await menu.click().catch(() => {});
    await page.getByRole('menuitem', { name: /sign out/i }).click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.context().clearCookies();
  await page.evaluate(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const databases = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      databases.map(
        (db) =>
          new Promise<void>((resolve) => {
            if (!db.name) return resolve();
            const request = indexedDB.deleteDatabase(db.name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          }),
      ),
    );
  });
  await page.goto('/login');
}

/**
 * Waits until nothing on the screen is still loading.
 *
 * Every one of them, not the first one found. A screen can load in stages —
 * the dashboard waits for its streams, renders, and only then discovers it is
 * still waiting for the roster — and watching a single element meant returning
 * the moment stage one finished, while stage two had not yet mounted its own
 * status. Assertions then read a screen that was still filling in, and failed
 * against a page that looked perfectly correct by the time anyone screenshotted
 * it.
 */
async function waitUntilReady(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0, {
    timeout: 60_000,
  });
}
