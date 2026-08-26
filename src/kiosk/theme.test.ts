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

  it('refuses a colour that is not a string, however it reads as one', () => {
    /*
     * `HEX.test` coerces, so a one-element array or anything with a `toString`
     * passes the pattern and is then handed to `setProperty` as an object. The
     * `typeof` is what keeps a value that only *looks* like a colour out of the
     * thing the kiosk reads back out of storage for the rest of the evening.
     */
    expect(sanitizeKioskPalette({ '--color-ink-950': ['#0d0500'] })).toBeNull();
    expect(
      sanitizeKioskPalette({ '--color-ink-950': { toString: () => '#0d0500' } }),
    ).toBeNull();
  });

  it('refuses a property name that is not one of ours', () => {
    expect(sanitizeKioskPalette({ background: '#000000', '--tally-x': '#000000' })).toBeNull();
  });

  it('stops at a sensible number of colours', () => {
    // The kiosk has nineteen property names it will accept, so a palette
    // carrying more than that is a server sending something else — and
    // `setProperty` is being handed every key of it.
    const flood: Record<string, string> = {};
    for (let index = 0; index < 40; index += 1) flood[`--color-ink-${index}`] = '#ff0000';
    // Every one of the real names, so the cap is reached with usable entries.
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      flood[`--color-ink-${step}`] = '#ff0000';
      flood[`--color-brand-${step}`] = '#00ff00';
      flood[`--color-present-${step}`] = '#0000ff';
    }

    const safe = sanitizeKioskPalette(flood);

    expect(Object.keys(safe ?? {}).length).toBeLessThanOrEqual(32);
    expect(Object.keys(safe ?? {}).length).toBeGreaterThan(0);
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

  it('paints the status bar the page colour the palette chose', () => {
    // `--color-ink-950` is the page. iOS and Android paint the bar above the
    // screen with this, and a themed kiosk with the shipped slate above it
    // reads as a rendering fault.
    meta().content = '#0f172a';
    applyKioskTheme('dark', { '--color-ink-950': '#0d0500' });

    expect(meta().content).toBe('#0d0500');
  });

  it('paints it Tally’s own light page for a light gathering with no palette', () => {
    meta().content = '#0f172a';
    applyKioskTheme('light', null);

    expect(meta().content).toBe('#e4f1fe');
  });

  it('never writes an empty colour over the bar', () => {
    /*
     * The untinted answer is the document's own `theme-color`, read once
     * before anything moves it — and in a document that shipped without one
     * there is nothing to go back to. Writing the empty string there is worse
     * than leaving the last gathering's colour up: it hands the platform no
     * answer at all, and what a phone does with that is its own business.
     */
    meta().content = '#0f172a';
    applyKioskTheme('light', { '--color-ink-950': '#f8f3f0' });
    expect(meta().content).toBe('#f8f3f0');

    applyKioskTheme(null, null);

    // Whatever was up stays up. `setAttribute` with nothing to say writes the
    // string `null` into the tag, which is not a colour and not an absence.
    expect(meta().content).toBe('#f8f3f0');
  });

  it('leaves properties it did not set alone', () => {
    root().style.setProperty('--spacing-safe-top', '44px');
    applyKioskTheme('dark', { '--color-brand-400': '#37b470' });
    applyKioskTheme(null, null);

    expect(root().style.getPropertyValue('--spacing-safe-top')).toBe('44px');
  });
});
