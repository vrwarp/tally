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
import { bindTo, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';
import { rosterAction } from './support/rosterActions';

const ROUTES = [
  '/',
  '/dashboard',
  '/events',
  '/students',
  '/settings',
  '/team',
  '/review',
] as const;

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
    await (await rosterAction(page, /new visitor/i)).click();

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

  /*
   * The lobby kiosk, with a child like that on its glass.
   *
   * The search screen is a one-column grid, and a grid column is never
   * narrower than the widest thing in it — a minimum that `truncate` does not
   * lower, because clipping a name leaves its min-content width the whole
   * name. A family registered a child with a sentence where a first name goes,
   * and a tablet under 720px wide went sideways: the header centred off the
   * glass, the count lost its last letter and the keyboard its last column of
   * keys, while the row that caused it looked perfectly truncated. The column
   * is pinned to the glass now (see SearchScreen's root); this is the frame
   * that keeps it there, at the narrowest shape a kiosk takes — the phone the
   * shooter in uxr/kiosk-live uses, where the same name once overflowed by
   * 330px.
   *
   * The child goes in through the New-visitor form, as above, and never
   * attends anything, so the scoped search says "no match" and the row is
   * reached through **Search everyone** — which is also the door a long name
   * arrives by on a real evening, on a gathering the family is new to.
   */
  test('the kiosk survives a student with a very long name', async ({
    browser,
    page,
    firestore,
  }) => {
    const surname =
      'Vandersteen-Okonkwo Fitzwilliam Abernathy Featherstonehaugh Wintermute Vasquez';

    await gotoReady(page, '/students');
    await (await rosterAction(page, /new visitor/i)).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/first name/i).fill('Wilhelmina');
    await dialog.getByLabel(/last name/i).fill(surname);
    await dialog.getByLabel(/^grade/i).selectOption('9');
    await dialog.getByRole('button', { name: /add student/i }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });

    const { context, page: kiosk } = await openKiosk(browser, {
      viewport: { width: 390, height: 844 },
    });
    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /friday fellowship/i);

      await typeOnKiosk(kiosk, 'wilhelmina');
      await expect(kiosk.getByText(/no match/i)).toBeVisible({ timeout: 15_000 });
      await kiosk.getByRole('button', { name: /Search everyone/i }).click();
      await expect(kiosk.getByRole('button', { name: /wilhelmina/i }).first()).toBeVisible({
        timeout: 15_000,
      });

      const amount = await kiosk.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      expect(amount, `the kiosk overflows by ${amount}px with one long name in its results.`)
        .toBeLessThanOrEqual(1);
    } finally {
      // The kiosk closes and the child goes whatever the verdict, so a red run
      // leaves nothing behind for the specs after it.
      await context.close();
      const created = await firestore.until(
        'students',
        (docs) => docs.some((doc) => doc.data.lastName === surname),
        'the long-named student',
      );
      const id = created.find((doc) => doc.data.lastName === surname)?.id;
      if (id) await firestore.remove(`students/${id}`);
    }
  });
});
