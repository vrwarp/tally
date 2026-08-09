import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadUnsupportedError, downloadCsv, downloadTextFile } from '@/lib/download';

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
