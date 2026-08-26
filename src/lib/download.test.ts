/**
 * Handing a generated file to the browser, and the three ways that fails.
 *
 * The export button's whole job is to end with a file on somebody's laptop, and
 * every failure mode here is silent by nature: a browser that ignores the
 * `download` attribute shows the CSV as text, a locked-down one refuses the
 * object URL, and a detached anchor in Firefox does nothing at all. None of
 * them throws on their own, so each has to be either detected or prevented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DownloadUnsupportedError,
  downloadCsv,
  downloadOpensInViewer,
  downloadTextFile,
} from '@/lib/download';
import { isEmbeddedBrowser } from '@/lib/embeddedBrowser';

vi.mock('@/lib/embeddedBrowser', () => ({ isEmbeddedBrowser: vi.fn(() => false) }));

/** What `createObjectURL` was handed, so the bytes can be inspected. */
let lastBlob: Blob | null = null;

beforeEach(() => {
  lastBlob = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    lastBlob = blob as Blob;
    return 'blob:tally/test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.mocked(isEmbeddedBrowser).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadTextFile', () => {
  it('clicks an anchor carrying the filename, then cleans up after itself', () => {
    downloadTextFile('tally-roster-2026-08-09.csv', 'a,b\r\n');

    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    expect(click).toHaveBeenCalledOnce();

    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('tally-roster-2026-08-09.csv');
    expect(anchor.href).toBe('blob:tally/test');
    // Removed synchronously; the URL survives one tick for Safari's sake.
    expect(anchor.isConnected).toBe(false);
  });

  it('revokes the object URL, but not before the click has landed', async () => {
    downloadTextFile('x.csv', 'a\r\n');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:tally/test');
  });

  it('reports a typed error when the browser refuses to mint an object URL', () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new TypeError('blocked');
    });
    // The caller turns this into a toast rather than failing silently, and a
    // browser that *has* the method but refuses the call is the same story to
    // the person pressing the button as one that lacks it.
    expect(() => downloadTextFile('x.csv', 'a')).toThrow(DownloadUnsupportedError);
  });

  it('keeps the underlying refusal on the error it throws', () => {
    const blocked = new TypeError('blocked by policy');
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw blocked;
    });

    try {
      downloadTextFile('x.csv', 'a');
      expect.unreachable('should have thrown');
    } catch (error) {
      // One sentence for the person, the real cause for the console.
      expect((error as Error).message).toBe('This browser would not save the file.');
      expect((error as Error).cause).toBe(blocked);
    }
  });

  it('says so before trying, on a browser with no object URLs at all', () => {
    vi.stubGlobal('URL', undefined);

    try {
      expect(() => downloadTextFile('x.csv', 'a')).toThrow('This browser cannot save files.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('says the same for a browser that has the name and not the method', () => {
    // A stub `URL` object turns up in hardened and embedded runtimes. Noticed
    // up front, so it is "cannot" — the same sentence as no `URL` at all —
    // rather than the "would not" that a refused call gets.
    vi.stubGlobal('URL', { revokeObjectURL: () => {} });

    try {
      expect(() => downloadTextFile('x.csv', 'a')).toThrow(DownloadUnsupportedError);
      expect(() => downloadTextFile('x.csv', 'a')).toThrow('This browser cannot save files.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not touch the document when it cannot mint a URL', () => {
    vi.stubGlobal('URL', {});
    const before = document.body.childElementCount;

    try {
      expect(() => downloadTextFile('x.csv', 'a')).toThrow();
      expect(document.body.childElementCount).toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('names itself, so a caller can tell this apart from any other failure', () => {
    // The export button branches on the name to offer "copy to clipboard"
    // instead; an anonymous `Error` gets the generic toast.
    const error = new DownloadUnsupportedError('nope');

    expect(error.name).toBe('DownloadUnsupportedError');
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toBe('DownloadUnsupportedError: nope');
  });

  it('clicks an anchor that is in the document, and invisible while it is', () => {
    const seen: Array<{ connected: boolean; display: string }> = [];
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      // Firefox will not follow a synthetic click on a detached node — and an
      // anchor attached without this is a visible link flashing on the page.
      seen.push({ connected: this.isConnected, display: this.style.display });
    });

    downloadTextFile('x.csv', 'a');

    expect(seen).toEqual([{ connected: true, display: 'none' }]);
  });

  it('takes the anchor back out even when the click throws', () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error('blocked');
    });
    const before = document.body.childElementCount;

    expect(() => downloadTextFile('x.csv', 'a')).toThrow('blocked');
    expect(document.body.childElementCount).toBe(before);
  });

  it('defaults to CSV, and takes another type when given one', async () => {
    downloadTextFile('notes.txt', 'hello', 'text/plain;charset=utf-8');
    expect(lastBlob!.type).toBe('text/plain;charset=utf-8');

    downloadTextFile('x.csv', 'a,b');
    expect(lastBlob!.type).toBe('text/csv;charset=utf-8');
  });

  it('writes the contents through untouched', async () => {
    downloadTextFile('x.csv', 'a,b\r\nc,d\r\n');

    expect(await lastBlob!.text()).toBe('a,b\r\nc,d\r\n');
  });
});

describe('downloadOpensInViewer', () => {
  it('is the warning worth giving before the press rather than after', () => {
    // Several in-app browsers ignore `download` and render the CSV as text,
    // with nothing detectable happening afterwards to report.
    vi.mocked(isEmbeddedBrowser).mockReturnValue(true);
    expect(downloadOpensInViewer()).toBe(true);

    vi.mocked(isEmbeddedBrowser).mockReturnValue(false);
    expect(downloadOpensInViewer()).toBe(false);
  });

  it('does not stop the download it warns about', () => {
    vi.mocked(isEmbeddedBrowser).mockReturnValue(true);

    expect(() => downloadTextFile('x.csv', 'a')).not.toThrow();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });
});

describe('downloadCsv', () => {
  it('prepends the UTF-8 BOM exactly once, before the header', async () => {
    downloadCsv('x.csv', 'first_name\r\nBenson “蔡秉洲”\r\n');

    expect(lastBlob).not.toBeNull();
    expect(lastBlob!.type).toBe('text/csv;charset=utf-8');

    // The bytes, not `.text()`: that method UTF-8-*decodes*, which strips the
    // BOM per spec and would pass whether or not it was ever written.
    const bytes = new Uint8Array(await lastBlob!.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const text = new TextDecoder('utf-8').decode(bytes.slice(3));
    expect(text.startsWith('first_name')).toBe(true);
    // Without the BOM, Excel on Windows reads this name in the ANSI codepage.
    expect(text).toContain('Benson “蔡秉洲”');
    expect(text).not.toContain('﻿');
  });
});
