import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasIPadWindowControls, markWindowControls } from '@/lib/windowControls';

const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function stub({ ua, touch, standalone }: { ua: string; touch: number; standalone: boolean }) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: standalone && query === '(display-mode: standalone)' })),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  document.documentElement.removeAttribute('data-window-controls');
});

describe('hasIPadWindowControls', () => {
  it('is true for an installed app on an iPad presenting as a Mac', () => {
    stub({ ua: IPAD_DESKTOP_UA, touch: 5, standalone: true });
    expect(hasIPadWindowControls()).toBe(true);
  });

  it('is true for an installed app on an iPad presenting as itself', () => {
    stub({ ua: IPAD_UA, touch: 5, standalone: true });
    expect(hasIPadWindowControls()).toBe(true);
  });

  it('is false in a Safari tab, where the browser chrome owns the corner', () => {
    stub({ ua: IPAD_DESKTOP_UA, touch: 5, standalone: false });
    expect(hasIPadWindowControls()).toBe(false);
  });

  it('is false for an installed app on a real Mac', () => {
    stub({ ua: IPAD_DESKTOP_UA, touch: 0, standalone: true });
    expect(hasIPadWindowControls()).toBe(false);
  });
});

describe('markWindowControls', () => {
  it('marks the document only when the controls are there', () => {
    stub({ ua: IPAD_DESKTOP_UA, touch: 0, standalone: true });
    markWindowControls();
    expect(document.documentElement.hasAttribute('data-window-controls')).toBe(false);

    stub({ ua: IPAD_DESKTOP_UA, touch: 5, standalone: true });
    markWindowControls();
    expect(document.documentElement.hasAttribute('data-window-controls')).toBe(true);
  });
});
