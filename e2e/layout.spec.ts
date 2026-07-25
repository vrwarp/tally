/**
 * Nothing may scroll sideways.
 *
 * Horizontal overflow on a phone is not cosmetic: it pushes controls off the
 * right edge where a thumb cannot reach them, and on a check-in queue that
 * means names nobody can tap. It is also invisible on a desktop-sized browser,
 * which is why it needs a test rather than a glance.
 *
 * The usual cause is a flex item defaulting to `min-width: auto` and refusing
 * to shrink below its content — so the failure message names the offending
 * elements rather than just the number of pixels.
 */
import { expect, test } from './support/fixtures';
import { gotoReady } from './support/auth';

const ROUTES = ['/', '/dashboard', '/events', '/students', '/settings'] as const;

interface Overflow {
  amount: number;
  viewport: number;
  offenders: string[];
}

test.describe('layout', () => {
  test.beforeEach(async ({ signedInAs }) => {
    // The core team sees every screen, so one session covers all the routes.
    await signedInAs('core');
  });

  for (const route of ROUTES) {
    test(`${route} never scrolls sideways`, async ({ page }) => {
      await gotoReady(page, route);
      // Let the roster and any lazily-loaded chunk settle before measuring.
      await page.waitForTimeout(1200);

      const result = await page.evaluate<Overflow>(() => {
        const root = document.documentElement;
        const amount = root.scrollWidth - root.clientWidth;
        const offenders: string[] = [];

        if (amount > 1) {
          for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            const box = element.getBoundingClientRect();
            if (box.right > root.clientWidth + 1 && box.width > 0) {
              const classes = String(element.className || '').slice(0, 80);
              offenders.push(`<${element.tagName.toLowerCase()} class="${classes}"> width=${Math.round(box.width)}`);
            }
          }
        }

        return { amount, viewport: root.clientWidth, offenders: offenders.slice(0, 5) };
      });

      expect(
        result.amount,
        `${route} overflows by ${result.amount}px at ${result.viewport}px wide.\n` +
          `Widest offenders:\n  ${result.offenders.join('\n  ')}`,
      ).toBeLessThanOrEqual(1);
    });
  }
});
