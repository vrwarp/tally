import { describe, expect, it } from 'vitest';
import { compressFor } from '@/kiosk/printing/compression';

describe('compressFor', () => {
  it('compresses for the models whose table says they take it', () => {
    expect(compressFor('QL-810W')).toBe(true);
    expect(compressFor('QL-820NWB')).toBe(true);
    expect(compressFor('QL-1110NWB')).toBe(true);
  });

  it('leaves it off for a model that does not, and for one it does not know', () => {
    expect(compressFor('QL-500')).toBe(false);
    expect(compressFor('QL-9000')).toBe(false);
    expect(compressFor('')).toBe(false);
  });
});
