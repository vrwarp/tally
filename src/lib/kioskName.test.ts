import { describe, expect, it } from 'vitest';
import { KIOSK_NAME_MAX, kioskName } from '@/lib/kioskName';

describe('kioskName', () => {
  it('keeps a name as people say it, tidied', () => {
    expect(kioskName('Lobby')).toBe('Lobby');
    expect(kioskName('  Nursery \t  door \n')).toBe('Nursery door');
  });

  it('reads nothing, or nothing but space, as no name at all', () => {
    for (const blank of ['', '   ', '\n\t', null, undefined, 7, { toString: () => 'Lobby' }]) {
      expect(kioskName(blank)).toBeNull();
    }
  });

  it('cuts a long name at the limit, at a whole character, with no space left hanging', () => {
    expect(kioskName('x'.repeat(KIOSK_NAME_MAX))).toBe('x'.repeat(KIOSK_NAME_MAX));
    expect(kioskName('x'.repeat(KIOSK_NAME_MAX + 1))).toBe('x'.repeat(KIOSK_NAME_MAX));
    // A cut after the space would end the name on it.
    expect(kioskName(`${'x'.repeat(KIOSK_NAME_MAX - 1)} door`)).toBe('x'.repeat(KIOSK_NAME_MAX - 1));
    // An emoji is two units: it goes whole or not at all.
    const name = kioskName(`${'x'.repeat(KIOSK_NAME_MAX - 1)}🚪`);
    expect(name).toBe('x'.repeat(KIOSK_NAME_MAX - 1));
    expect(kioskName(`${'x'.repeat(KIOSK_NAME_MAX - 2)}🚪`)).toBe(`${'x'.repeat(KIOSK_NAME_MAX - 2)}🚪`);
  });
});
