/**
 * These are pure user-agent and display-mode checks, but the consequences of
 * getting them wrong are not visible in testing: a counselor with an installed
 * PWA taps "Continue with Google" and the app hangs forever with no error. So
 * the table below is deliberately concrete about the real strings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  googleSignInStrategy,
  isEmbeddedBrowser,
  isFirstPartyAuthDomain,
  isStandaloneDisplay,
} from '@/lib/embeddedBrowser';

const REAL_UA = navigator.userAgent;

function setUserAgent(value: string): void {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function setDisplayMode(mode: string | null): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mode !== null && query.includes(`display-mode: ${mode}`),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

afterEach(() => {
  setUserAgent(REAL_UA);
  setDisplayMode(null);
  Reflect.deleteProperty(window.navigator as object, 'standalone');
});

describe('isEmbeddedBrowser', () => {
  const WEBVIEWS: Array<[string, string]> = [
    ['Facebook', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) [FBAN/FBIOS;FBAV/440.0]'],
    ['Messenger', 'Mozilla/5.0 (iPhone) Messenger/440.0.0.0'],
    ['Instagram', 'Mozilla/5.0 (Linux; Android 14) Instagram 300.0.0.0 Android'],
    ['Line', 'Mozilla/5.0 (iPhone) Line/13.0.0'],
    ['WeChat', 'Mozilla/5.0 (iPhone) MicroMessenger/8.0.40'],
    ['the Google app', 'Mozilla/5.0 (iPhone) GSA/300.0.0'],
    ['a generic Android WebView', 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/120.0.0.0'],
  ];

  it.each(WEBVIEWS)('detects %s', (_name, ua) => {
    setUserAgent(ua);
    expect(isEmbeddedBrowser()).toBe(true);
  });

  const REAL_BROWSERS: Array<[string, string]> = [
    ['iOS Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/605.1.15'],
    ['Android Chrome', 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120.0.0.0 Mobile Safari/537.36'],
    ['desktop Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36'],
    ['desktop Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'],
  ];

  it.each(REAL_BROWSERS)('leaves %s alone', (_name, ua) => {
    setUserAgent(ua);
    expect(isEmbeddedBrowser()).toBe(false);
  });
});

describe('isStandaloneDisplay', () => {
  it.each(['standalone', 'fullscreen', 'minimal-ui'])('detects display-mode %s', (mode) => {
    setDisplayMode(mode);
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('treats an ordinary tab as not standalone', () => {
    setDisplayMode('browser');
    expect(isStandaloneDisplay()).toBe(false);
  });

  it('detects an iOS home-screen app, which reports no display-mode match', () => {
    setDisplayMode(null);
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('survives a browser that throws on an unknown media query', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('unsupported');
      },
    });
    expect(() => isStandaloneDisplay()).not.toThrow();
    expect(isStandaloneDisplay()).toBe(false);
  });
});

describe('isFirstPartyAuthDomain', () => {
  it('is true only when the auth handler shares the app origin', () => {
    // jsdom serves the app from localhost.
    expect(isFirstPartyAuthDomain(window.location.host)).toBe(true);
    expect(isFirstPartyAuthDomain('tally-76406.firebaseapp.com')).toBe(false);
  });

  it('ignores case and treats a missing domain as third-party', () => {
    expect(isFirstPartyAuthDomain(window.location.host.toUpperCase())).toBe(true);
    expect(isFirstPartyAuthDomain(undefined)).toBe(false);
  });
});

describe('googleSignInStrategy', () => {
  const THIRD_PARTY = 'tally-76406.firebaseapp.com';
  const FACEBOOK_UA = 'Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/440.0]';

  it('uses a popup in an ordinary tab', () => {
    setDisplayMode('browser');
    expect(googleSignInStrategy(window.location.host)).toBe('popup');
  });

  it('redirects in an installed app when the auth handler is first-party', () => {
    setDisplayMode('standalone');
    expect(googleSignInStrategy(window.location.host)).toBe('redirect');
  });

  /**
   * The case this whole mechanism exists for. A third-party redirect handler
   * loses its sessionStorage to storage partitioning and fails with "missing
   * initial state", and the popup an installed app would otherwise fall back
   * to hangs on Android and is blocked on iOS. Refusing is better than a flow
   * that half-works — but it is also why `VITE_AUTH_DOMAINS` matters: with it
   * set, the case above applies instead and iOS can sign in at all.
   */
  it('refuses in an installed app when the auth handler is third-party', () => {
    setDisplayMode('standalone');
    expect(googleSignInStrategy(THIRD_PARTY)).toBe('unavailable');
  });

  /**
   * In-app browsers block `window.open`, so the popup has little chance and
   * the redirect — an ordinary same-window navigation — has a real one.
   */
  it('prefers the redirect inside an in-app browser when it can complete', () => {
    setUserAgent(FACEBOOK_UA);
    expect(googleSignInStrategy(window.location.host)).toBe('redirect');
  });

  /**
   * The regression this guards is a lockout, not a bad flow. Google is the
   * only door into Tally, so a user-agent match — which is a heuristic, and
   * will be wrong sometimes — must never be what stops somebody trying.
   */
  it('still attempts a popup inside an in-app browser rather than refusing', () => {
    setUserAgent(FACEBOOK_UA);
    expect(googleSignInStrategy(THIRD_PARTY)).toBe('popup');
  });

  it('never reports an in-app browser as unavailable, on any known webview', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone) Messenger/440.0.0.0',
      'Mozilla/5.0 (Linux; Android 14) Instagram 300.0.0.0 Android',
      'Mozilla/5.0 (iPhone) MicroMessenger/8.0.40',
      'Mozilla/5.0 (Linux; Android 14; wv) Chrome/120.0.0.0',
    ]) {
      setUserAgent(ua);
      expect(googleSignInStrategy(THIRD_PARTY)).not.toBe('unavailable');
      expect(googleSignInStrategy(window.location.host)).not.toBe('unavailable');
    }
  });

  /**
   * An installed app is checked first: the popup there does not fail, it
   * hangs, and no catch block can rescue a call that never returns.
   */
  it('treats an installed app as installed even if the webview sniff also fires', () => {
    setUserAgent(FACEBOOK_UA);
    setDisplayMode('standalone');
    expect(googleSignInStrategy(THIRD_PARTY)).toBe('unavailable');
  });
});
