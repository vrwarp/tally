import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasIPadWindowControls, watchWindowControls } from '@/lib/windowControls';

const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** An 11-inch iPad, which reports its portrait size whichever way it is held. */
function stub({
  ua = IPAD_DESKTOP_UA,
  touch = 5,
  standalone = true,
  landscape = false,
  innerWidth = 417,
}: {
  ua?: string;
  touch?: number;
  standalone?: boolean;
  landscape?: boolean;
  innerWidth?: number;
}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
  vi.spyOn(screen, 'width', 'get').mockReturnValue(834);
  vi.spyOn(screen, 'height', 'get').mockReturnValue(1194);
  vi.stubGlobal('innerWidth', innerWidth);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches:
        (standalone && query === '(display-mode: standalone)') ||
        (landscape && query === '(orientation: landscape)'),
    })),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  document.documentElement.removeAttribute('data-window-controls');
});

describe('hasIPadWindowControls', () => {
  it('is true for an installed app in a window on an iPad presenting as a Mac', () => {
    stub({});
    expect(hasIPadWindowControls()).toBe(true);
  });

  it('is true for an installed app in a window on an iPad presenting as itself', () => {
    stub({ ua: IPAD_UA });
    expect(hasIPadWindowControls()).toBe(true);
  });

  it('is false full screen, where the status bar has the corner instead', () => {
    stub({ innerWidth: 834 });
    expect(hasIPadWindowControls()).toBe(false);
  });

  it('measures a landscape window against the long edge', () => {
    stub({ landscape: true, innerWidth: 1194 });
    expect(hasIPadWindowControls()).toBe(false);
    stub({ landscape: true, innerWidth: 900 });
    expect(hasIPadWindowControls()).toBe(true);
  });

  it('is false in a Safari tab, where the browser chrome owns the corner', () => {
    stub({ standalone: false });
    expect(hasIPadWindowControls()).toBe(false);
  });

  it('is false for an installed app on a real Mac', () => {
    stub({ touch: 0 });
    expect(hasIPadWindowControls()).toBe(false);
  });
});

describe('watchWindowControls', () => {
  it('follows the window as it is resized', () => {
    stub({ innerWidth: 834 });
    const stop = watchWindowControls();
    expect(document.documentElement.hasAttribute('data-window-controls')).toBe(false);

    stub({ innerWidth: 417 });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.hasAttribute('data-window-controls')).toBe(true);

    stop();
    stub({ innerWidth: 834 });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.hasAttribute('data-window-controls')).toBe(true);
  });
});
