/**
 * Throwaway. Reproduces the sibling card's commit press and reports what the
 * browser thinks is at the button's own centre point — the question being
 * whether a real reviewer could press it.
 */
import { gotoReady } from './support/auth';
import { expect, test } from './support/fixtures';
import { removeRegistration, seedRegistration } from './support/registrations';
import { readCollection } from './support/emulator';

test('diagnose the sibling commit', async ({ page, signedInAs }) => {
  const students = await readCollection('students');
  const anchor = students.find(
    (doc) => doc.data.status === 'active' && typeof doc.data.firstName === 'string',
  )!;
  const registrationId = 'diag-sibling';
  await signedInAs('core');
  await seedRegistration({
    registrationId,
    guardian: null,
    last4: '0347',
    anchorStudentIds: [anchor.id],
    children: [{ firstName: 'Diagchild', lastName: 'Probe', grade: 4 }],
  });

  try {
    await gotoReady(page, '/review');
    const card = page.locator('section', { hasText: 'Diagchild' }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    await card.getByRole('button', { name: /Approve and add/i }).click();
    const commit = card.getByRole('button', { name: /^Yes — add/i });
    await expect(commit).toBeVisible();

    const report = await commit.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const at = document.elementFromPoint(cx, cy);
      return {
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        disabled: (el as HTMLButtonElement).disabled,
        pointerEvents: getComputedStyle(el).pointerEvents,
        atPointTag: at?.tagName ?? null,
        atPointText: at?.textContent?.slice(0, 40) ?? null,
        atPointIsSelf: at === el || el.contains(at),
        viewport: { w: window.innerWidth, h: window.innerHeight },
      };
    });
    console.log('DIAG', JSON.stringify(report));

    await commit.click();
    await page.waitForTimeout(2_000);
    const after = await card
      .getByRole('button', { name: /^Yes — add/i })
      .count()
      .catch(() => -1);
    console.log('DIAG after click, commit buttons still present:', after);
  } finally {
    await removeRegistration(registrationId, 1);
  }
});
