/**
 * Reaching the three roster actions at either width.
 *
 * "New visitor", "Add from Planning Center" (or "Add from directory", once a
 * second backend is connected) and "Export CSV" live on the /students header
 * row — but only from `lg` up. Below it they are a ragged stair of
 * administrative buttons above the list the page exists to show, so they
 * collapse behind one "Actions" button that opens a "Roster actions" sheet
 * holding all three. See the header block in `StudentsPage.tsx`.
 *
 * That is a real difference in what is on screen, and the four Playwright
 * projects run two of them at phone size, so every spec that reaches one of
 * these controls has to know about both shapes. It knows about them here,
 * once, instead of in eight places.
 *
 * ## Why this hands back a locator instead of clicking
 *
 * Two of the three are pressed and forgotten; the export is not. Its
 * accessible name carries the count of what would be written — "Export CSV
 * (12 students)" — and `export.spec.ts` asserts on the button before and
 * after filtering. A helper that clicked would have nothing to hand back, so
 * this one resolves the control and leaves pressing it to the caller, who can
 * assert on it, hold it across a `Promise.all` with a download wait, or click
 * it straight away.
 */
import type { Locator, Page } from '@playwright/test';

/**
 * The phone's one header control. Rendered at every width — `lg:hidden` is
 * what decides which of the two shapes is on screen — which is what makes
 * "is it visible?" a safe question to ask rather than a race.
 */
const OPENER = /^actions$/i;

/**
 * Which shape is on screen is read off this button, so it has to be findable
 * in the shape where it is *not* the answer.
 *
 * `getByRole` drops elements ARIA calls hidden, and `lg:hidden` is
 * `display: none`, so on a laptop the plain role query matches nothing — which
 * is indistinguishable from a page that has not finished rendering. Asking for
 * hidden ones too turns "no such button" into "there it is, and it is not for
 * this width", which is the question actually being asked below.
 */
const OPENER_OPTIONS = { name: OPENER, includeHidden: true } as const;

/** The sheet it opens. */
const SHEET = /^roster actions$/i;

export interface RosterActionOptions {
  /**
   * How long to wait for the control to be there.
   *
   * Several callers allow 20s because the label they are waiting for only
   * becomes correct once the roster's backends have answered — "Add from
   * Planning Center" is renamed "Add from directory" the moment a second
   * backend is connected. The wait belongs on whichever element appears late,
   * so it is applied to both hops: opening the sheet and finding the button
   * inside it. Omitted, Playwright's own defaults apply.
   */
  timeout?: number;
}

/**
 * The header action `name` describes, wherever this viewport keeps it.
 *
 * Below `lg` that means opening the sheet first and returning the button
 * scoped to it — the sheet closes itself on press and opens whatever the
 * action asked for, so callers must not dismiss it themselves.
 *
 * `name` is matched against the accessible name, so pass a pattern rather than
 * a string: the export button's name carries a count that changes with the
 * filters.
 */
export async function rosterAction(
  page: Page,
  name: RegExp,
  { timeout }: RosterActionOptions = {},
): Promise<Locator> {
  const opener = page.getByRole('button', OPENER_OPTIONS);
  await opener.waitFor({ state: 'attached', timeout });

  let scope: Page | Locator = page;
  if (await opener.isVisible()) {
    await opener.click();
    scope = page.getByRole('dialog', { name: SHEET });
  }

  const button = scope.getByRole('button', { name });
  await button.waitFor({ state: 'visible', timeout });
  return button;
}
