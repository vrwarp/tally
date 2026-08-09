/**
 * Handing a generated file to the browser.
 *
 * The DOM half of the CSV export, kept apart from `csv.ts` so the serialiser
 * stays testable in node and never appears in a stack trace next to a `Blob`.
 *
 * Keep this module leaf-level for the same reason `csv.ts` is: the kiosk's byte
 * budget covers everything reachable from `kiosk.html`, and nothing the kiosk
 * imports may ever import this.
 */
import { isEmbeddedBrowser } from '@/lib/embeddedBrowser';

/**
 * Excel on Windows opens a BOM-less file in the system ANSI codepage.
 *
 * Not defensive: `composeFirstName` writes a nickname as `Benson “蔡秉洲” Tsai`
 * using U+201C/U+201D, so a roster export carries curly punctuation and CJK as a
 * matter of routine, and without this those names arrive as mojibake.
 */
const BOM = '﻿';

/** Thrown when the browser cannot be handed a file at all. */
export class DownloadUnsupportedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DownloadUnsupportedError';
  }
}

/**
 * True when the press will probably open a viewer instead of saving a file.
 *
 * Several in-app browsers ignore the `download` attribute and show the CSV as
 * text, with nothing detectable happening afterwards. Worth saying *before* the
 * press rather than after, which is why this is exported rather than checked
 * inside `downloadTextFile`.
 */
export function downloadOpensInViewer(): boolean {
  return isEmbeddedBrowser();
}

export function downloadTextFile(
  filename: string,
  contents: string,
  mimeType = 'text/csv;charset=utf-8',
): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new DownloadUnsupportedError('This browser cannot save files.');
  }

  let url: string;
  try {
    url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  } catch (cause) {
    // A locked-down browser can have the method and refuse the call. The
    // caller has one thing to say either way, so both arrive as one error.
    throw new DownloadUnsupportedError('This browser would not save the file.', { cause });
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Firefox will not follow a synthetic click on a detached node.
  anchor.style.display = 'none';
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Revoking synchronously races Safari, which has not read the blob yet.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** The CSV path: the BOM belongs here, exactly once, before the header. */
export function downloadCsv(filename: string, csv: string): void {
  downloadTextFile(filename, `${BOM}${csv}`);
}
