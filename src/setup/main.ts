/**
 * The tablet staging page: every managed-configuration value, with a copy
 * button, generated for wherever this is served from.
 *
 * No framework, no Firebase, no sign-in. Three reasons, and they are all the
 * same reason: this page is opened *on the tablet being staged*, in Chrome,
 * before that tablet is a kiosk and possibly before it has been given a
 * network it likes. It should be a handful of kilobytes that render from the
 * URL alone.
 *
 * Deliberately not staff-gated. There is nothing secret on it — a USB vendor id
 * is published by Brother and the origin is printed on the kiosk's own screen —
 * and a login here would mean signing a staff Google account into the browser
 * of a tablet about to be handed to the public, which is the exact thing the
 * kiosk's pairing design exists to avoid. See `docs/tablet-management.md` §6.3.
 *
 * The pairing token of §6.4 must never appear here. That one is a credential.
 */
import { ADB_DEVICE_OWNER, maintenanceWindow, policyRows, type PolicyRow } from './policy';

const ORIGIN = window.location.origin;

/** Text into a DOM node, never markup: every value here is data. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * A copy button that says whether it worked.
 *
 * `navigator.clipboard` is unavailable on an insecure origin and can be refused
 * outright, and a button that silently does nothing on a staging tablet is
 * worse than no button: the value still has to get across, so a refusal falls
 * back to selecting the text for a long-press copy.
 */
function copyButton(value: string, target: HTMLElement): HTMLButtonElement {
  const button = el('button', 'copy', 'Copy');
  button.type = 'button';
  button.addEventListener('click', () => {
    const settle = (text: string) => {
      button.textContent = text;
      window.setTimeout(() => (button.textContent = 'Copy'), 1500);
    };
    void (async () => {
      try {
        await navigator.clipboard.writeText(value);
        settle('Copied');
      } catch {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        settle('Select and hold to copy');
      }
    })();
  });
  return button;
}

function rowNode(row: PolicyRow): HTMLElement {
  const section = el('section', `row ${row.weight}`);
  const head = el('div', 'head');
  head.append(el('code', 'key', row.key), el('span', `tag ${row.weight}`, row.weight));
  const value = el('pre', 'value', row.value);
  const foot = el('div', 'foot');
  foot.append(copyButton(row.value, value), el('p', 'note', row.note));
  section.append(head, value, foot);
  return section;
}

function render(): void {
  const main = document.querySelector('main');
  if (!main) return;

  main.querySelector('.origin')!.textContent = ORIGIN;

  const rows = el('div', 'rows');
  for (const row of policyRows(ORIGIN)) rows.append(rowNode(row));
  main.querySelector('#rows')!.replaceWith(rows);

  const window_ = maintenanceWindow();
  main.querySelector('.window')!.textContent =
    `${window_.label} — startMinutes ${window_.startMinutes}, endMinutes ${window_.endMinutes}`;

  const adb = main.querySelector<HTMLElement>('.adb')!;
  adb.textContent = ADB_DEVICE_OWNER;
  adb.after(copyButton(ADB_DEVICE_OWNER, adb));
}

render();
