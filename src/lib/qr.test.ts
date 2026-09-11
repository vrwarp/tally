/**
 * Whether the squares this draws are the squares a phone camera expects.
 *
 * A QR encoder is the rare piece of code whose output nobody can eyeball. It
 * either scans or it does not, and "does not" arrives as a volunteer standing
 * in a foyer holding a phone at a screen. So the encoder is checked two ways
 * that do not share its reasoning:
 *
 * 1. **It is read back.** `decode` below is a second implementation — its own
 *    function-pattern map, its own placement walk, its own block table — and
 *    it recovers the original text from the finished matrix. A byte written to
 *    the wrong module, a mask undone in the wrong order, a character count in
 *    the wrong width: all of them come back as the wrong string.
 * 2. **It is pinned.** `JOIN_URL_MATRIX` is one whole symbol, module for
 *    module. It was checked outside this repository against
 *    [segno](https://github.com/heuer/segno), an unrelated Python encoder — the
 *    two agree exactly on this payload, and OpenCV's detector reads the
 *    rendered image back as the URL. Nothing here can drift without the fixture
 *    failing.
 *
 * The one thing deliberately *not* asserted is which of the eight masks gets
 * chosen for an arbitrary payload. See the note in `qr.ts`: implementations
 * disagree about whether the format modules count towards the penalty score,
 * every answer is a valid symbol, and pinning ours would be pinning a
 * preference rather than a fact.
 */
import { describe, expect, it } from 'vitest';
import { encodeQr } from '@/lib/qr';

/* -------------------------------------------------------------------------- */
/* A second implementation, for reading one back                               */
/* -------------------------------------------------------------------------- */

const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const ALIGNMENT: Readonly<Record<number, readonly number[]>> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** Data codewords per block, level M — written out from the spec's table again. */
const BLOCKS: Readonly<Record<number, readonly number[]>> = {
  1: [16],
  2: [28],
  3: [44],
  4: [32, 32],
  5: [43, 43],
  6: [27, 27, 27, 27],
  7: [31, 31, 31, 31],
  8: [38, 38, 39, 39],
  9: [36, 36, 36, 37, 37],
  10: [43, 43, 43, 43, 44],
};

/** Every module a function pattern owns, worked out from the version alone. */
function functionMap(version: number, size: number): boolean[][] {
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const claim = (row: number, col: number) => {
    if (row >= 0 && row < size && col >= 0 && col < size) map[row]![col] = true;
  };

  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let dy = -1; dy <= 7; dy += 1) for (let dx = -1; dx <= 7; dx += 1) claim(top + dy, left + dx);
  }
  for (let i = 0; i < size; i += 1) {
    claim(6, i);
    claim(i, 6);
  }
  const centres = ALIGNMENT[version]!;
  for (const row of centres) {
    for (const col of centres) {
      const corner =
        (row === 6 && col === 6) ||
        (row === 6 && col === size - 7) ||
        (row === size - 7 && col === 6);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) claim(row + dy, col + dx);
    }
  }
  for (let i = 0; i < 9; i += 1) {
    claim(8, i);
    claim(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    claim(8, size - 1 - i);
    claim(size - 1 - i, 8);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      claim(Math.floor(i / 3), size - 11 + (i % 3));
      claim(size - 11 + (i % 3), Math.floor(i / 3));
    }
  }
  return map;
}

interface Decoded {
  level: number;
  mask: number;
  text: string;
}

/** Reads a finished symbol the way a scanner would, minus the optics. */
function decode(modules: readonly boolean[][]): Decoded {
  const size = modules.length;
  const version = (size - 17) / 4;

  // The format information, from the copy beside the top-left finder.
  let format = 0;
  const formatCells: [number, number][] = [];
  for (let i = 0; i <= 5; i += 1) formatCells.push([i, 8]);
  formatCells.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i <= 14; i += 1) formatCells.push([8, 14 - i]);
  formatCells.forEach(([row, col], index) => {
    if (modules[row]![col]) format |= 1 << index;
  });
  // The low ten bits are the BCH check; the five above them are the payload.
  const meaning = (format ^ 0x5412) >> 10;
  const level = (meaning >> 3) & 3;
  const mask = meaning & 7;

  // Undo the mask over everything the function patterns do not own.
  const map = functionMap(version, size);
  const condition = MASKS[mask]!;
  const plain = modules.map((row, r) =>
    row.map((dark, c) => (!map[r]![c] && condition(r, c) ? !dark : dark)),
  );

  // Walk the same zigzag and collect the bits back into codewords.
  const bits: boolean[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!map[y]![x]) bits.push(plain[y]![x]!);
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | (bits[i + b] ? 1 : 0);
    codewords.push(byte);
  }

  // Un-interleave: the blocks were written a codeword at a time, round-robin.
  const lengths = BLOCKS[version]!;
  const blocks: number[][] = lengths.map(() => []);
  let cursor = 0;
  for (let i = 0; i < Math.max(...lengths); i += 1) {
    for (let block = 0; block < lengths.length; block += 1) {
      if (i < lengths[block]!) blocks[block]!.push(codewords[cursor++]!);
    }
  }
  const data = blocks.flat();

  // Mode, length, and the bytes themselves. Error correction is not applied —
  // nothing here is damaged, and repairing it would only hide a mistake.
  let bit = 0;
  const take = (width: number) => {
    let value = 0;
    for (let i = 0; i < width; i += 1, bit += 1) {
      value = (value << 1) | ((data[bit >> 3]! >> (7 - (bit & 7))) & 1);
    }
    return value;
  };
  const mode = take(4);
  expect(mode).toBe(0b0100);
  const length = take(version < 10 ? 8 : 16);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = take(8);

  return { level, mask, text: new TextDecoder().decode(bytes) };
}

/* -------------------------------------------------------------------------- */

/** A join link of the shape the Team screen mints, at 52 bytes: version 4. */
const JOIN_URL = 'https://tally.example.org/join/8Qk2mZp1vR7tLb0aWc3XyD';

/**
 * The whole symbol for `JOIN_URL`, dark modules as `1`.
 *
 * Verified module for module against segno 1.6.6 outside this repository, and
 * read back as the URL by OpenCV's `QRCodeDetector` from a rendered image.
 * Segno has one deviation the comparison had to account for — it writes an
 * extra zero pad codeword when the bit stream already ends on a codeword
 * boundary, which in byte mode it always does — and with that patched out the
 * two encoders agree on every one of the 1,089 modules.
 */
const JOIN_URL_MATRIX = [
  '111111101010100010110101101111111',
  '100000101100001011100101101000001',
  '101110100110011010011010001011101',
  '101110101111100000100001101011101',
  '101110100100110010000110101011101',
  '100000100111101111111100001000001',
  '111111101010101010101010101111111',
  '000000001011001111001001100000000',
  '101101110001000111100101101001011',
  '000110011110110011111101001101101',
  '110010111000110010101001001111011',
  '110101011101000101011010100101000',
  '101101111101001010011011110011000',
  '110100011110011000010001110001110',
  '011101110011011001110000001011100',
  '100100011010011100000110011100100',
  '110110101110100000111111011010100',
  '011010010100001100101001101011000',
  '110100100001000100100100110110110',
  '011000010111101101101011100010001',
  '000110101010011110011001100101111',
  '101001001011100110001011010000101',
  '000101111110100100000001111011111',
  '010011010110000100000011110001000',
  '101001101011100001001010111110010',
  '000000001111011110010001100011010',
  '111111101101010001111101101010010',
  '100000101010101011101111100011111',
  '101110100010001111110111111110110',
  '101110101111010010000011000101101',
  '101110101111101111001100101101100',
  '100000100011101001111010101110001',
  '111111101111000011010100011011000',
];

const asRows = (modules: readonly boolean[][]) =>
  modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));

describe('encodeQr', () => {
  it('draws the symbol an unrelated encoder draws for the same link', () => {
    expect(asRows(encodeQr(JOIN_URL).modules)).toEqual(JOIN_URL_MATRIX);
  });

  it('reads back as the link it was given', () => {
    const decoded = decode(encodeQr(JOIN_URL).modules);
    expect(decoded.text).toBe(JOIN_URL);
    // 0 is level M, which is what the whole module is fixed at.
    expect(decoded.level).toBe(0);
  });

  it('reads back at every size it can produce', () => {
    // One payload per version boundary at level M in byte mode: the last
    // length that fits, and the first that does not. Both are where an
    // off-by-one in the capacity table or the terminator shows up.
    const lengths = [1, 14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 123, 152, 153, 180, 181, 213];
    const versions = new Set<number>();
    for (const length of lengths) {
      // A payload with no repetition in it, so a bit written twice or dropped
      // cannot decode back to the same string by luck.
      const text = Array.from({ length }, (_, i) =>
        'abcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@'.charAt(
          (i * 7 + Math.floor(i / 11)) % 46,
        ),
      ).join('');
      const code = encodeQr(text);
      versions.add(code.version);
      expect(decode(code.modules).text, `${length} bytes`).toBe(text);
    }
    expect([...versions].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('carries anything a URL can carry, including what is not ASCII', () => {
    // Byte mode is UTF-8 here, so the length in the symbol is a byte count and
    // not a character count — an encoder that confused the two would produce a
    // symbol that decodes short.
    const text = 'https://tally.example.org/join/Ünïcode—ok';
    expect(decode(encodeQr(text).modules).text).toBe(text);
  });

  it('picks the smallest symbol the payload fits in', () => {
    // A bigger symbol is a worse one across a room: the same camera has to
    // resolve more modules in the same square of screen.
    expect(encodeQr('a'.repeat(14)).version).toBe(1);
    expect(encodeQr('a'.repeat(15)).version).toBe(2);
    expect(encodeQr('a'.repeat(26)).version).toBe(2);
    expect(encodeQr('a'.repeat(27)).version).toBe(3);
  });

  it('is square, and the size its version says', () => {
    const code = encodeQr(JOIN_URL);
    expect(code.size).toBe(code.version * 4 + 17);
    expect(code.modules).toHaveLength(code.size);
    for (const row of code.modules) expect(row).toHaveLength(code.size);
  });

  it('refuses a payload it cannot hold rather than truncating it', () => {
    // The caller falls back to the link. A QR that encodes half a token is
    // indistinguishable from one that works until somebody scans it.
    expect(() => encodeQr('a'.repeat(214))).toThrow(/Too long/);
  });
});
