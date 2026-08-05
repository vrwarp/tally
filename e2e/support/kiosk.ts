/**
 * Driving the lobby kiosk.
 *
 * The kiosk is a second application on the same origin: its own entry, its own
 * Firebase app instance (named `kiosk`, so its auth key does not collide), its
 * own localStorage namespace, and a session minted by a pairing handshake
 * rather than by signing in. Everything here exists because those differences
 * are real and a spec that ignored them would be testing something else.
 *
 * ## Two things that will bite
 *
 * **`/kiosk` does not exist under `vite preview`.** The rewrite lives in
 * `firebase.json`, which is hosting-only, and `vite.config.ts` sets no
 * `appType` — so preview's SPA fallback quietly serves `index.html`, the *main*
 * app, and a spec that navigated there would pass while testing nothing. Hence
 * `KIOSK_PATH`.
 *
 * **The kiosk is a different device.** A separate browser context, not a second
 * page: sharing storage with the staff session would work, and would not be the
 * thing being tested.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * The built entry, not the hosting route.
 *
 * See the note above — `/kiosk` under preview is the main app wearing a
 * kiosk's URL.
 */
export const KIOSK_PATH = '/kiosk.html';

/** `HOLD_MS` in components/HoldButton.tsx, plus room for a slow CI machine. */
const HOLD_MS = 3000;
const HOLD_SLACK_MS = 700;

/** Opens the kiosk on its own device. Caller closes the context. */
export async function openKiosk(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(KIOSK_PATH);
  return { context, page };
}

/**
 * Presses and holds, the way a thumb does.
 *
 * `HoldButton` listens for pointer events and cancels on leave, so this has to
 * be a real press at a real position rather than a synthesised click.
 */
export async function hold(page: Page, selector: Parameters<Page['locator']>[0]): Promise<void> {
  const target = page.locator(selector);
  const box = await target.boundingBox();
  if (!box) throw new Error(`Cannot hold ${String(selector)} — it has no box on screen.`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS + HOLD_SLACK_MS);
  await page.mouse.up();
}

/**
 * The pairing handshake, end to end.
 *
 * The kiosk shows a six-character code and polls; a staff member types it into
 * `/pair-kiosk` in the main app. Both halves are real here — `startKioskPairing`
 * is unauthenticated, `approveKioskPairing` takes any active member, and
 * `createCustomToken` needs no IAM grant against the Auth emulator.
 */
export async function pairKiosk(kiosk: Page, staff: Page): Promise<string> {
  const code = await readPairingCode(kiosk);

  await staff.goto('/pair-kiosk');
  await staff.getByLabel(/pairing code/i).fill(code);
  await staff.getByRole('button', { name: /approve this kiosk/i }).click();
  await expect(staff.getByText(/the kiosk will sign itself in/i)).toBeVisible();

  // The kiosk polls every couple of seconds, then signs in with the minted
  // token before the chooser appears.
  await expect(kiosk.getByText(/which gathering/i)).toBeVisible({ timeout: 30_000 });
  return code;
}

/** The six-character code on the pairing screen. */
export async function readPairingCode(kiosk: Page): Promise<string> {
  const code = kiosk.getByTestId('kiosk-pairing-code');
  await expect(code).toBeVisible({ timeout: 30_000 });
  return ((await code.textContent()) ?? '').trim();
}

/** Binds the kiosk to a gathering by name — the row, then the three-second hold. */
export async function bindTo(kiosk: Page, title: string | RegExp): Promise<void> {
  await kiosk.getByRole('button', { name: title }).first().click();
  await hold(kiosk, 'button:has-text("Hold to set kiosk")');
  await expect(kiosk.getByText(/type a name, or the last 4 digits/i)).toBeVisible({
    timeout: 30_000,
  });
}

/** Types on the kiosk's own keyboard — the native one never rises. */
export async function typeOnKiosk(kiosk: Page, text: string): Promise<void> {
  // The letter keys are drawn uppercase; digits are themselves.
  for (const character of text) {
    const key = character === ' ' ? 'space' : character.toUpperCase();
    await kiosk.locator(`[data-key="${key}"]`).click();
  }
}

/* -------------------------------------------------------------------------- */
/* Label printing                                                              */
/* -------------------------------------------------------------------------- */

/** One label the kiosk sent, as the recorder in printing/index.ts saw it. */
export interface RecordedLabel {
  bytes: number;
  pageCount: number;
}

/**
 * Sets this kiosk up to print, and to record instead of printing.
 *
 * Two halves, both needed. The localStorage key is what makes `KioskApp` load
 * the printing module at all — a kiosk with no printer deliberately never
 * touches it. The array is the seam in `printing/index.ts`, which stands in for
 * the one thing Playwright cannot provide: a USB device.
 *
 * Everything before the wire is real. The worker starts, `OffscreenCanvas`
 * measures and draws actual text with actual system fonts, and `createJob`
 * emits a real Brother raster job — all in a real browser, which is exactly
 * what the unit tests cannot reach. What is recorded is that job's size.
 *
 * Must run before the page loads, hence `addInitScript`: the module is imported
 * during boot and the recorder is read on the first label.
 */
export async function recordLabels(kiosk: Page): Promise<void> {
  await kiosk.addInitScript(() => {
    localStorage.setItem(
      'tally:kiosk:printer',
      JSON.stringify({ model: 'QL-810W', label: '62x29' }),
    );
    (window as unknown as Record<string, unknown>).__tallyKioskLabels = [];
  });
}

/** The labels sent so far. */
export async function recordedLabels(kiosk: Page): Promise<RecordedLabel[]> {
  return kiosk.evaluate(
    () => (window as unknown as { __tallyKioskLabels?: RecordedLabel[] }).__tallyKioskLabels ?? [],
  );
}

/**
 * Waits for the label count to settle on `expected`.
 *
 * Printing is fire-and-forget by design — nothing on screen waits for it — so a
 * spec has to poll rather than await. For `expected` of zero this is a
 * negative claim and needs a moment for the label that must not appear to fail
 * to appear.
 */
export async function expectLabelCount(kiosk: Page, expected: number): Promise<void> {
  if (expected === 0) {
    await kiosk.waitForTimeout(1500);
    expect(await recordedLabels(kiosk)).toHaveLength(0);
    return;
  }
  await expect
    .poll(async () => (await recordedLabels(kiosk)).length, { timeout: 15_000 })
    .toBe(expected);
}
