/**
 * What a kiosk will draw as a `d` attribute.
 *
 * The path arrives from the server, is persisted into the binding and is read
 * back out of localStorage for the rest of the evening — so the interesting
 * cases are not "does a Material path pass" but "what does a kiosk do with a
 * string somebody put in that key".
 */
import { describe, expect, it } from 'vitest';
import { EVENT_ICONS } from '@/lib/eventIcons';
import { sanitizeIconPath } from './icon';

describe('sanitizeIconPath', () => {
  it('accepts every path in the catalogue the server draws from', () => {
    // The one test that keeps the two halves of this honest: the server sends
    // `EventIconDef.path` verbatim, so anything this rejects is a gathering
    // whose icon silently disappears between the app and the lobby screen.
    for (const icon of EVENT_ICONS) {
      expect(sanitizeIconPath(icon.path), icon.name).toBe(icon.path);
    }
  });

  it('accepts curves and arcs the catalogue does not use yet', () => {
    // Material's outlined set is straight lines and quadratics today. A glyph
    // added upstream with a `C` or an `A` in it must not come out as an event
    // that lost its icon.
    expect(sanitizeIconPath('M10 10 C 20 20, 40 20, 50 10 A 5 5 0 0 1 10 10 Z')).not.toBeNull();
  });

  it('rejects a string that is not a path', () => {
    expect(sanitizeIconPath('')).toBeNull();
    expect(sanitizeIconPath('   ')).toBeNull();
    // Must start with a moveto, which is what SVG itself requires.
    expect(sanitizeIconPath('L10 10')).toBeNull();
    expect(sanitizeIconPath('javascript:alert(1)')).toBeNull();
    expect(sanitizeIconPath('M10 10"/><script>alert(1)</script>')).toBeNull();
    expect(sanitizeIconPath('url(#x)')).toBeNull();
  });

  it('rejects anything that is not a string', () => {
    expect(sanitizeIconPath(undefined)).toBeNull();
    expect(sanitizeIconPath(null)).toBeNull();
    expect(sanitizeIconPath(42)).toBeNull();
    expect(sanitizeIconPath({ path: 'M0 0' })).toBeNull();
  });

  it('refuses a path far longer than any glyph', () => {
    // A stop rather than a limit: the catalogue's longest is 1,318 characters.
    expect(sanitizeIconPath(`M0 0${' 1'.repeat(4000)}`)).toBeNull();
  });

  it('draws a path of exactly the length it stops at', () => {
    // Four thousand is the stop, and it is inclusive: a glyph landing exactly
    // on it is the last one drawn, not the first one dropped.
    const exact = `M0 0${'1'.repeat(3996)}`;
    expect(exact).toHaveLength(4000);
    expect(sanitizeIconPath(exact)).toBe(exact);

    expect(sanitizeIconPath(`${exact}1`)).toBeNull();
  });

  it('refuses an empty path rather than drawing nothing', () => {
    expect(sanitizeIconPath('')).toBeNull();
    expect(sanitizeIconPath('   ')).toBeNull();
  });

  it('trims, because a stored value is not a literal', () => {
    expect(sanitizeIconPath('  M0 0h10v10z  ')).toBe('M0 0h10v10z');
  });
});
