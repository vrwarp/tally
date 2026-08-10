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
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * The built entry, not the hosting route.
 *
 * See the note above — `/kiosk` under preview is the main app wearing a
 * kiosk's URL.
 */
export const KIOSK_PATH = '/kiosk.html';

/** `HOLD_MS` in components/HoldButton.tsx, plus room for a slow CI machine. */
const HOLD_MS = 2000;
const HOLD_SLACK_MS = 700;

/**
 * Opens the kiosk on its own device. Caller closes the context.
 *
 * `viewport` is for the walkthrough, which photographs the same tour on a
 * tablet lying in a stand and standing in one. A kiosk is whatever shape the
 * shelf it sits on wants, and the flow has to survive both.
 */
export async function openKiosk(
  browser: Browser,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    options.viewport ? { viewport: options.viewport } : {},
  );
  const page = await context.newPage();
  await page.goto(KIOSK_PATH);
  return { context, page };
}

/**
 * Presses and holds, the way a thumb does.
 *
 * Both holds on the kiosk cancel on pointer-leave — `HoldButton` in JavaScript,
 * the Clear key's staff gate in CSS `:active` — so this has to be a real press
 * at a real position rather than a synthesised click.
 *
 * Half way through, the progress is checked in *pixels* — see
 * `expectProgressShows`. Unconditionally: this used to take an `invisible`
 * escape hatch for the old staff gate, a transparent square in the corner of
 * the header, and the gate that replaced it draws progress like everything
 * else. Every hold a person can find is a hold they can watch.
 *
 * Takes a locator as well as a selector because the holds are no longer all
 * buttons with fixed words on them — an event row on the chooser is reached by
 * role and name like the row it is.
 */
export async function hold(
  page: Page,
  target: string | Locator,
): Promise<void> {
  const locator = typeof target === 'string' ? page.locator(target) : target;
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Cannot hold ${String(target)} — it has no box on screen.`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS / 2);
  await expectProgressShows(page, box);
  await page.waitForTimeout(HOLD_MS / 2 + HOLD_SLACK_MS);
  await page.mouse.up();
}

/**
 * Half way through a hold, the bar has to be somewhere a person can see it.
 *
 * Pixels, not styles, because the bug this exists to catch passed everything
 * else. The fill was `bg-brand-600/40` over buttons already painted
 * `bg-brand-600`, so it composited to the button's own colour to the last unit:
 * the element was in the DOM, the transition was running, the transform was
 * animating, and the screen showed the whole hold as a button doing nothing.
 * Nobody holds through that, so the control read as broken on every device it
 * was tried on while the specs stayed green. What reaches the screen is the
 * only thing that distinguishes that from working, so that is what is asserted.
 *
 * At the half-way point the fill covers somewhere between a third and a half of
 * the control — `HoldButton` starts drawing immediately, the Clear key waits
 * 400ms so an ordinary tap never flashes a bar — so a sample near the left edge
 * is filled and one near the right edge is not, on either of them. The 6% and
 * 94% margins are what keep that true for both, and they also keep the samples
 * clear of the label in the middle and the rounded corners at the ends.
 */
async function expectProgressShows(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const shot = (await page.screenshot()).toString('base64');
  const gap = await page.evaluate(
    async ({ shot, box }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${shot}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);

      // The shot is in device pixels and the box is in CSS pixels.
      const scale = image.width / window.innerWidth;
      const at = (fraction: number) => {
        const x = Math.round((box.x + box.width * fraction) * scale);
        const y = Math.round((box.y + box.height / 2) * scale);
        return Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3);
      };

      const filled = at(0.06);
      const empty = at(0.94);
      return Math.max(...filled.map((channel, index) => Math.abs(channel - empty[index])));
    },
    { shot, box },
  );

  expect(
    gap,
    'the hold progress bar is invisible against the button it is drawn on',
  ).toBeGreaterThan(16);
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
  // The verdict replaces the standing hint under the button rather than
  // arriving beneath it, so this is the same element either way.
  await expect(staff.getByText(/the kiosk signs itself in/i)).toBeVisible();

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

/**
 * Binds the kiosk to a gathering by name — the row, then the two-second hold.
 *
 * The two-gesture route on purpose, even though holding the row does the whole
 * thing now: this is the path with the labelled button on it, and it is the one
 * that would break silently if the button and the rows ever disagreed about
 * which gathering is picked. The one-gesture route has a test of its own in
 * `kiosk.spec.ts`.
 */
export async function bindTo(kiosk: Page, title: string | RegExp): Promise<void> {
  await kiosk.getByRole('button', { name: title }).first().click();
  await hold(kiosk, 'button:has-text("Hold to set kiosk")');
  await expect(kiosk.getByText(/^type a name$/i)).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Types on the kiosk's own keyboard — the native one never rises.
 *
 * One trap worth knowing before you invent test data: the keyboard has a digit
 * row (the search takes phone digits), so every key press here *lands* — but
 * `applyKey` refuses digits into a name field. A "unique" surname like
 * `Marchetti48321` is therefore typed in full and stored as `Marchetti`, and
 * the assertions afterwards look for a child the flow never created. Make
 * per-run names out of letters.
 */
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
