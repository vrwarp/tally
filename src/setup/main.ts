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
import { encodeQr, qrPath } from '@/lib/qr';
import {
  ADB_DEVICE_OWNER,
  TESTDPC_QR_PAYLOAD,
  maintenanceWindow,
  policyRows,
  type PolicyRow,
} from './policy';

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

/**
 * The provisioning code, drawn here rather than fetched.
 *
 * Imported outright and not behind `await import()`, which is the opposite of
 * what the Team screen does with the same encoder — and for the same reason.
 * There the bytes are avoided for the many people who never press QR; here the
 * square is the section. A static import is preloaded from this page's own
 * markup, so the encoder arrives alongside it rather than after it, which is
 * what matters on a tablet four minutes into an unfamiliar network.
 *
 * `crispEdges` because a 232px box holding a 73-module symbol lands two or
 * three pixels on each module, and an anti-aliased boundary at that size is a
 * grey smear rather than an edge.
 */
function qrNode(text: string, label: string): SVGSVGElement {
  const { d, extent } = qrPath(encodeQr(text).modules);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${extent} ${extent}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(path);
  return svg;
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

  const payload = main.querySelector<HTMLElement>('.payload')!;
  payload.textContent = TESTDPC_QR_PAYLOAD;
  main.querySelector('.payload-copy')!.replaceWith(copyButton(TESTDPC_QR_PAYLOAD, payload));

  /*
   * The square is the one thing on this page that can fail to be drawn at all
   * — a payload past the encoder's ceiling throws — and the page must not go
   * blank for it. The JSON above is already on screen and is what a code
   * generator would be fed, so the fallback is to say so and leave it there.
   */
  const square = main.querySelector<HTMLElement>('.qr')!;
  try {
    square.replaceChildren(qrNode(TESTDPC_QR_PAYLOAD, 'Test DPC provisioning code'));
  } catch {
    square.replaceWith(
      el(
        'p',
        'note',
        'This code could not be drawn here. Unfold the payload below and make a QR from it.',
      ),
    );
  }
}

render();
