/**
 * The backdrop model: the id shape, and the sanitizers three layers rely on
 * saying exactly the same thing — the converter reading an event document,
 * the server building a chooser row, and the kiosk persisting a binding. The
 * id becomes a Firestore document path and a Cache API key on a shelf device,
 * which is why the shape is pinned this hard.
 */
import { describe, expect, it } from 'vitest';
import {
  KIOSK_BACKDROP_MAX_BYTES,
  KIOSK_BACKDROP_TARGET_BYTES,
  kioskBackdropId,
  sanitizeKioskBackdropId,
  sanitizeKioskBackdropType,
} from './kioskBackdrop';

describe('sanitizeKioskBackdropId', () => {
  it('accepts the shape this repo mints', () => {
    expect(sanitizeKioskBackdropId('b0123456789abcdef')).toBe('b0123456789abcdef');
    expect(sanitizeKioskBackdropId(`b${'a'.repeat(64)}`)).toBe(`b${'a'.repeat(64)}`);
  });

  it('refuses everything else, null for the ordinary absence', () => {
    for (const value of [
      null,
      undefined,
      '',
      42,
      'b0123', // too short to be a digest prefix
      `b${'a'.repeat(65)}`, // too long to be one
      'x0123456789abcdef', // wrong sigil
      'B0123456789ABCDEF', // hex is minted lowercase; case-folding here would
      // make two spellings of one document path
      'b0123456789abcdeg', // not hex
      'b0123456789abcde/', // a path separator is a different document
      'kioskBackdrops/b0123456789abcdef',
    ]) {
      expect(sanitizeKioskBackdropId(value)).toBeNull();
    }
  });
});

describe('sanitizeKioskBackdropType', () => {
  it('accepts exactly what the editor can encode', () => {
    expect(sanitizeKioskBackdropType('image/webp')).toBe('image/webp');
    expect(sanitizeKioskBackdropType('image/jpeg')).toBe('image/jpeg');
  });

  it('refuses the rest — png would be the largest possible photograph', () => {
    for (const value of ['image/png', 'image/svg+xml', 'text/html', '', null, 7]) {
      expect(sanitizeKioskBackdropType(value)).toBeNull();
    }
  });
});

describe('kioskBackdropId', () => {
  it('mints an id its own sanitizer accepts', () => {
    const id = kioskBackdropId('ab'.repeat(32));
    expect(id).toBe(`b${'ab'.repeat(16)}`);
    expect(sanitizeKioskBackdropId(id)).toBe(id);
  });
});

describe('the caps', () => {
  it('leave the editor aiming well under the ceiling, and the ceiling well under a document', () => {
    expect(KIOSK_BACKDROP_TARGET_BYTES).toBeLessThan(KIOSK_BACKDROP_MAX_BYTES);
    // Firestore's limit is 1,048,576 bytes for the whole document; the image
    // must leave room for its sibling fields.
    expect(KIOSK_BACKDROP_MAX_BYTES).toBeLessThan(1_000_000);
  });
});
