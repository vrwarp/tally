/**
 * The kiosk's portrait-only gate.
 *
 * jsdom has no viewport and no Screen Orientation API, so both are faked the
 * way a browser would present them: a `matchMedia` whose landscape answer can
 * flip and announce the flip, and a `screen.orientation.lock` that refuses the
 * way every non-fullscreen tab does.
 */
import { useEffect } from 'react';
import { act, render, screen } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortraitOnly } from '@/kiosk/components/PortraitOnly';
import { lockPortrait } from '@/kiosk/orientation';

const TITLE = /turn the screen upright/i;

let landscape = false;
const listeners = new Set<() => void>();

function turn(to: 'landscape' | 'portrait'): void {
  landscape = to === 'landscape';
  act(() => {
    for (const listener of listeners) listener();
  });
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  landscape = false;
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === '(orientation: landscape)' && landscape;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  Reflect.deleteProperty(window.screen, 'orientation');
});

describe('PortraitOnly', () => {
  it('shows the kiosk and nothing else while the screen is upright', () => {
    render(
      <PortraitOnly>
        <button type="button">Kiosk</button>
      </PortraitOnly>,
    );

    expect(screen.getByRole('button', { name: 'Kiosk' })).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('covers the kiosk, and makes it inert, while the screen is sideways', () => {
    landscape = true;
    render(
      <PortraitOnly>
        <button type="button">Kiosk</button>
      </PortraitOnly>,
    );

    expect(screen.getByRole('alertdialog', { name: TITLE })).toBeInTheDocument();
    expect(screen.getByText('Kiosk').closest('[inert]')).not.toBeNull();
  });

  it('follows the tablet as it turns, without remounting the kiosk under it', () => {
    const mounts = vi.fn();
    function Kiosk() {
      useEffect(() => mounts(), []);
      return <div>Kiosk</div>;
    }
    render(
      <PortraitOnly>
        <Kiosk />
      </PortraitOnly>,
    );

    turn('landscape');
    expect(screen.getByText(TITLE)).toBeInTheDocument();

    turn('portrait');
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(screen.getByText('Kiosk').closest('[inert]')).toBeNull();
    // Mounted once, across both turns: a half-typed name survives the tablet
    // being knocked sideways and stood back up.
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it('asks the device to hold portrait on boot and again on entering fullscreen', () => {
    const lock = vi.fn(() => Promise.reject(new Error('not fullscreen')));
    Object.defineProperty(window.screen, 'orientation', { value: { lock }, configurable: true });

    render(
      <PortraitOnly>
        <div>Kiosk</div>
      </PortraitOnly>,
    );
    expect(lock).toHaveBeenCalledWith('portrait');

    document.dispatchEvent(new Event('fullscreenchange'));
    expect(lock).toHaveBeenCalledTimes(2);
  });
});

describe('lockPortrait', () => {
  it('is a no-op where the Screen Orientation API is missing', () => {
    expect(() => lockPortrait()).not.toThrow();
  });

  it('swallows an engine that throws instead of rejecting', () => {
    const lock = vi.fn(() => {
      throw new Error('NotSupportedError');
    });
    Object.defineProperty(window.screen, 'orientation', { value: { lock }, configurable: true });

    expect(() => lockPortrait()).not.toThrow();
  });
});
