/**
 * The two things worth checking here are both negative.
 *
 * One: the kiosk cannot be talked into writing a property it did not expect —
 * `warn` above all, since that is what an allergy line is painted in. Two:
 * rebinding *removes* the last gathering's colours rather than merely failing
 * to set them again, which is the bug that would leave a nursery's ember on a
 * Friday youth night.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { applyKioskTheme, sanitizeKioskPalette } from './theme';

const root = () => document.documentElement;

function meta(): HTMLMetaElement {
  let tag = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = 'theme-color';
    document.head.append(tag);
  }
  return tag;
}

afterEach(() => {
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe('sanitizeKioskPalette', () => {
  it('keeps colours at property names the kiosk actually has', () => {
    expect(
      sanitizeKioskPalette({ '--color-brand-400': '#F29551', '--color-ink-950': '#0d0500' }),
    ).toEqual({ '--color-brand-400': '#F29551', '--color-ink-950': '#0d0500' });
  });

  it('refuses to carry warn or danger, whatever the server said', () => {
    // Amber is fixed because it is what an allergy line is painted in. Nothing
    // upstream sends this; the fence is here so nothing ever can.
    expect(
      sanitizeKioskPalette({ '--color-warn-400': '#facc15', '--color-danger-500': '#ef4444' }),
    ).toBeNull();
  });

  it('refuses anything that is not a plain six-digit hex', () => {
    expect(
      sanitizeKioskPalette({
        '--color-ink-950': 'red',
        '--color-ink-900': 'url(https://example.com)',
        '--color-ink-800': '#fff',
        '--color-ink-700': 'var(--color-ink-50)',
      }),
    ).toBeNull();
  });

  it('refuses a property name that is not one of ours', () => {
    expect(sanitizeKioskPalette({ background: '#000000', '--tally-x': '#000000' })).toBeNull();
  });

  it('reads anything that is not an object as no palette', () => {
    expect(sanitizeKioskPalette(null)).toBeNull();
    expect(sanitizeKioskPalette(undefined)).toBeNull();
    expect(sanitizeKioskPalette('#ff0000')).toBeNull();
    expect(sanitizeKioskPalette(['#ff0000'])).toBeNull();
  });
});

describe('applyKioskTheme', () => {
  it('stamps the ground and the colours', () => {
    meta().content = '#0f172a';
    applyKioskTheme('light', { '--color-brand-400': '#b96213', '--color-ink-950': '#f8f3f0' });

    expect(root().dataset.theme).toBe('light');
    expect(root().style.getPropertyValue('--color-brand-400')).toBe('#b96213');
    expect(meta().content).toBe('#f8f3f0');
  });

  it('takes the last gathering off before putting the next one on', () => {
    applyKioskTheme('dark', { '--color-brand-400': '#b96213', '--color-ink-950': '#0d0500' });
    applyKioskTheme('dark', { '--color-brand-400': '#37b470' });

    expect(root().style.getPropertyValue('--color-brand-400')).toBe('#37b470');
    // The ember page did not survive the rebind to forest.
    expect(root().style.getPropertyValue('--color-ink-950')).toBe('');
  });

  it('goes back to the kiosk that shipped when nothing is bound', () => {
    meta().content = '#0f172a';
    applyKioskTheme('light', { '--color-ink-950': '#f8f3f0' });
    applyKioskTheme(null, null);

    expect(root().dataset.theme).toBe('dark');
    expect(root().style.getPropertyValue('--color-ink-950')).toBe('');
  });

  it('honours a ground with no palette behind it', () => {
    // A gathering that went light and kept Tally's own hues is themed, not
    // unthemed: there is nothing to set, and `data-theme` still has to move.
    applyKioskTheme('light', null);
    expect(root().dataset.theme).toBe('light');
    expect(root().getAttribute('style')).toBeFalsy();
  });

  it('leaves properties it did not set alone', () => {
    root().style.setProperty('--spacing-safe-top', '44px');
    applyKioskTheme('dark', { '--color-brand-400': '#37b470' });
    applyKioskTheme(null, null);

    expect(root().style.getPropertyValue('--spacing-safe-top')).toBe('44px');
  });
});
