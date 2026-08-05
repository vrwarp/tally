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

const ROUTES = ['/', '/dashboard', '/events', '/students', '/settings', '/review'] as const;

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

  /*
   * The seeded ministry has forty-five ordinary names, so it never exercised the
   * case that actually broke this: one student whose name is long enough to
   * matter. A row's name is clipped by `truncate`, which is `overflow: hidden`
   * plus `white-space: nowrap` — and overflow does not apply to a non-replaced
   * *inline* box. The directory's name span sat inside a parent that is only a
   * flex container above `lg`, so on a phone the name was inline: it refused to
   * wrap, was never clipped, and pushed every other row's content off the right
   * edge of the screen.
   *
   * The name goes in through the app's own New-visitor form, so this is a real
   * roster student, and the document is removed afterwards rather than left for
   * whatever runs next.
   */
  test('/students survives a student with a very long name', async ({ page, firestore }) => {
    const surname =
      'Vandersteen-Okonkwo Fitzwilliam Abernathy Featherstonehaugh Wintermute Vasquez';

    await gotoReady(page, '/students');
    await page.getByRole('button', { name: /new visitor/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/first name/i).fill('Bartholomew');
    await dialog.getByLabel(/last name/i).fill(surname);
    await dialog.getByLabel(/^grade/i).selectOption('9');
    await dialog.getByRole('button', { name: /add student/i }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });

    // The row has to be on screen before measuring what it does to the page.
    await page.getByText('Bartholomew', { exact: false }).first().waitFor({ timeout: 30_000 });

    const amount = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });

    const created = await firestore.until(
      'students',
      (docs) => docs.some((doc) => doc.data.lastName === surname),
      'the long-named student',
    );
    const id = created.find((doc) => doc.data.lastName === surname)?.id;
    if (id) await firestore.remove(`students/${id}`);

    expect(amount, `/students overflows by ${amount}px with one long name on the roster.`)
      .toBeLessThanOrEqual(1);
  });
});
