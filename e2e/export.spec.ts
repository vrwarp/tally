/**
 * The export, in a browser that actually writes a file.
 *
 * The unit suites own what is *in* each file — columns, quoting, the four
 * upstream states, absent-versus-zero. This owns the one thing they cannot
 * observe: that a real Chromium receives a download, with the filename we
 * chose and a UTF-8 BOM in front of the header.
 *
 * The BOM is the reason this is worth a browser at all. It is invisible in
 * every assertion a jsdom test can make, and it is the single byte between a
 * roster opening correctly in Excel and opening as mojibake.
 */
import { gotoReady } from './support/auth';
import { expect, test } from './support/fixtures';
import { rosterAction } from './support/rosterActions';

test.describe('CSV export', () => {
  test('writes a roster file with a BOM, a real header and real names', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/students');

    // Below `lg` this is inside the "Roster actions" sheet rather than on the
    // header row; either way it is the same control, held rather than pressed
    // because the count on its label is part of what is being checked.
    const button = await rosterAction(page, /Export CSV/);
    await expect(button).toBeEnabled();

    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);

    // What, and when — the only label the file carries once the screen is gone.
    expect(download.suggestedFilename()).toMatch(/^tally-roster-\d{4}-\d{2}-\d{2}\.csv$/);

    const path = await download.path();
    expect(path).not.toBeNull();

    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(path!);

    // The three bytes Excel needs before it will read the rest as UTF-8.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const text = bytes.subarray(3).toString('utf8');
    const [header, ...rows] = text.trimEnd().split('\r\n');

    // Never `ID`: a file whose first bytes are that is parsed as SYLK and
    // refused outright by Excel.
    expect(header?.split(',')[0]).toBe('student_id');
    expect(header).toContain('source_system');
    expect(header).not.toMatch(/parent_phone|parent_email|allergy_note|birthday/);

    // A file with only a header is the failure that looks like success.
    expect(rows.length).toBeGreaterThan(0);
  });

  test('exports the rows the filters left on screen, and says so in the name', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/students');

    const heading = page.getByRole('heading', { name: /students/i }).first();
    await expect(heading).toBeVisible();

    await page.getByRole('searchbox', { name: /search/i }).fill('a');
    // The count under the title is the same number the file should carry.
    const summary = page.locator('p', { hasText: /of \d+$/ }).first();
    await expect(summary).toBeVisible();
    const shown = Number(/^(\d+)/.exec((await summary.innerText()).trim())?.[1] ?? 0);
    expect(shown).toBeGreaterThan(0);

    // Resolved before the race is armed: on a phone reaching this button opens
    // a sheet, and that must not happen inside the `Promise.all`.
    const button = await rosterAction(page, /Export CSV/);
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);

    expect(download.suggestedFilename()).toMatch(/-filtered\.csv$/);

    const { readFile } = await import('node:fs/promises');
    const text = (await readFile((await download.path())!)).subarray(3).toString('utf8');
    // One header plus exactly the rows on screen — the bug this guards is
    // invisible in the artefact, because a whole-roster file looks just like a
    // filtered one.
    expect(text.trimEnd().split('\r\n')).toHaveLength(shown + 1);
  });
});
