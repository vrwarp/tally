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

/**
 * The top layer, written down. See the note beside `data-uxr-modal` below.
 *
 * The attribute selector out-specifies the `bg-transparent` on the dialog's own
 * class list, which is correct: transparent was right when a `::backdrop`
 * pseudo-element was painting behind it, and there is no pseudo-element in a
 * static file.
 */
const MODAL_RULE = [
  'dialog[open][data-uxr-modal]{position:fixed;inset:0;z-index:60;',
  'background:rgb(0 0 0 / 0.7);max-height:100dvh;max-width:100vw;}',
].join('');

export async function freeze(page: Page): Promise<string> {
  // Passed in rather than closed over: the body of `evaluate` is serialised and
  // run in the page, where nothing in this module's scope exists.
  return page.evaluate((modalRule: string) => {
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

    /*
     * An open <dialog> is the one thing on a page that a clone cannot carry.
     *
     * `showModal()` puts the element in the *top layer* — above everything,
     * centred against the viewport, with `::backdrop` painted behind it — and
     * none of that is expressed in the DOM or in a stylesheet. The `open`
     * attribute survives the clone and means something much weaker: a non-modal
     * dialog, absolutely positioned in the flow, no backdrop. So a frozen
     * scene whose whole subject is a form in a modal came out as the page
     * behind it, with the form sitting a screen and a half further down.
     *
     * Re-expressing it is a translation rather than a decoration: fixed to the
     * viewport, above the page, with the backdrop's own colour moved onto the
     * element — which is what the browser was painting a moment ago. Anything
     * that reads the frame afterwards is looking at the same pixels.
     */
    root.querySelectorAll('dialog[open]').forEach((dialog) => {
      dialog.setAttribute('data-uxr-modal', '');
    });

    const style = document.createElement('style');
    style.setAttribute('data-uxr', 'frozen');
    style.textContent = `${sheets}\n\n${modalRule}`;
    root.querySelector('head')?.appendChild(style);

    /* A hook for the ideation agent: every prototype carries an empty override
       block at the end of <head>, so a refinement can be expressed as CSS on
       top of the captured baseline rather than by rewriting the markup. */
    const overrides = document.createElement('style');
    overrides.setAttribute('data-uxr', 'overrides');
    overrides.textContent = '/* UXR overrides go here. */';
    root.querySelector('head')?.appendChild(overrides);

    return `<!doctype html>\n${root.outerHTML}`;
  }, MODAL_RULE);
}
