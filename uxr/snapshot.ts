/**
 * Freezes a live page into a self-contained static HTML file.
 *
 * This is the pivot the whole refinement turns on. Iterating on the real app
 * means a Firestore emulator, a Planning Center simulator, a functions build
 * and a sign-in per idea; iterating on a frozen derivation of that same app
 * means opening a file. The frozen page is not a mockup — every pixel in it was
 * rendered by the real components against the real seeded ministry — it simply
 * no longer needs the stack behind it.
 *
 * What is preserved: the exact DOM, every stylesheet the page actually loaded
 * (inlined, because a published prototype cannot reach a dev server), the
 * runtime custom properties the sticky bars publish onto `<html>`, the resolved
 * theme, and the values sitting in form controls.
 *
 * What is dropped: scripts. A prototype that can still run React would re-render
 * over the very DOM the ideation agent just edited.
 */
import type { Page } from '@playwright/test';

export async function freeze(page: Page): Promise<string> {
  return page.evaluate(() => {
    /* Inline every rule the page is actually painting with. Same-origin, so
       `cssRules` is readable; the try/catch is for anything that is not. */
    const sheets = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules)
            .map((rule) => rule.cssText)
            .join('\n');
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .join('\n\n');

    /* A cloned <input> keeps its *attribute*, not the value a user typed, so
       the search box would freeze empty on the very scene that is about a
       search. Same for the checked state of the grade checkboxes. */
    document.querySelectorAll('input').forEach((input) => {
      if (input.type === 'checkbox' || input.type === 'radio') {
        if (input.checked) input.setAttribute('checked', '');
        else input.removeAttribute('checked');
      } else {
        input.setAttribute('value', input.value);
      }
    });
    document.querySelectorAll('select').forEach((select) => {
      Array.from(select.options).forEach((option) => {
        if (option.selected) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      });
    });

    const root = document.documentElement.cloneNode(true) as HTMLElement;
    root.querySelectorAll('script, link[rel="stylesheet"], style').forEach((node) => node.remove());

    const style = document.createElement('style');
    style.setAttribute('data-uxr', 'frozen');
    style.textContent = sheets;
    root.querySelector('head')?.appendChild(style);

    /* A hook for the ideation agent: every prototype carries an empty override
       block at the end of <head>, so a refinement can be expressed as CSS on
       top of the captured baseline rather than by rewriting the markup. */
    const overrides = document.createElement('style');
    overrides.setAttribute('data-uxr', 'overrides');
    overrides.textContent = '/* UXR overrides go here. */';
    root.querySelector('head')?.appendChild(overrides);

    return `<!doctype html>\n${root.outerHTML}`;
  });
}
