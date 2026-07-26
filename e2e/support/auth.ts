/**
 * Signing in the way a counselor actually does.
 *
 * There is one way in now — Google — and the interesting half of it is what
 * happens *after* the credential arrives: `provisionAccess` deciding whether
 * this address is a seeded admin, an invited volunteer, or a stranger. That
 * half is driven for real here.
 *
 * The Google round-trip itself is minted through an emulator-only hook the app
 * installs (see `src/lib/firebase.ts`). Not for speed: `signInWithPopup` boots
 * Firebase's hidden iframe from `apis.google.com`, so in a sandbox with no
 * route to Google the suite would fail at Google's front door rather than at
 * anything Tally owns. The session it produces carries
 * `sign_in_provider: google.com`, which is the only thing the server inspects.
 *
 * The login *screen* is still asserted — the button has to be there, and it has
 * to be the only way in — so a regression that removed or broke it still fails
 * a test.
 */
import type { Page } from '@playwright/test';

/**
 * Who the seed authorises, and how.
 *
 * `admin` is deliberately not in Firestore at all: they come from
 * `TALLY_ADMIN_EMAILS`, which is the only way the first admin of a real install
 * can exist. The other two arrive on invitations `scripts/seed.ts` writes.
 */
export const TEAM = {
  admin: 'dana.ruiz@footprints.example.org',
  core: 'miriam.achebe@footprints.example.org',
  counselor: 'sam.whitfield@footprints.example.org',
} as const;

export type TeamRole = keyof typeof TEAM;

/** Display names, so the emulator's account list is readable in a trace. */
const DISPLAY_NAMES: Record<string, string> = {
  [TEAM.admin]: 'Dana Ruiz',
  [TEAM.core]: 'Miriam Achebe',
  [TEAM.counselor]: 'Sam Whitfield',
};

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
        'completed.',
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

async function waitUntilReady(page: Page): Promise<void> {
  await page
    .getByRole('status', { name: /loading/i })
    .first()
    .waitFor({ state: 'detached', timeout: 60_000 })
    .catch(() => {
      // Already gone by the time we looked, which is the happy path.
    });
}
