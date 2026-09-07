/**
 * Offering to install the kiosk, on a screen where the ordering still matters.
 *
 * The shelf device is set up once, by whoever is standing there with the
 * pairing code, and "Add to Home Screen" is four taps into a menu they have no
 * reason to open. On iOS it matters twice over: an installed web app gets its
 * own storage container, so a kiosk paired in Safari and *then* installed comes
 * up unpaired and asking for a fresh code. Install first, pair second.
 *
 * The prompt event is single-use, and that is the claim most worth pinning: it
 * is dropped on the way in, whatever the person chooses, because a dismissed
 * prompt cannot be re-shown from the same event. That is why the button
 * disappears after a dismissal rather than sitting there doing nothing when
 * tapped again.
 */
import { act, renderHook } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInstalled, needsManualInstall, promptInstall, useCanInstall } from '@/kiosk/install';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function parkedPrompt(prompt = vi.fn(async () => {})) {
  const event = { prompt } as unknown as InstallPromptEvent;
  window.__tallyKioskInstall = event;
  return { event, prompt };
}

beforeEach(() => {
  window.__tallyKioskInstall = null;
});

afterEach(() => {
  window.__tallyKioskInstall = null;
  vi.unstubAllGlobals();
});

describe('useCanInstall', () => {
  it('is false when nothing has offered a prompt', () => {
    const { result } = renderHook(() => useCanInstall());
    expect(result.current).toBe(false);
  });

  it('is true once kiosk.html has parked one', () => {
    parkedPrompt();
    const { result } = renderHook(() => useCanInstall());
    expect(result.current).toBe(true);
  });

  it('notices a prompt arriving after the screen mounted', () => {
    // Chrome fires `beforeinstallprompt` whenever it likes; the inline script
    // in kiosk.html has already parked it by the time the event reaches here.
    const { result } = renderHook(() => useCanInstall());
    expect(result.current).toBe(false);

    act(() => {
      parkedPrompt();
      window.dispatchEvent(new Event('beforeinstallprompt'));
    });

    expect(result.current).toBe(true);
  });

  it('notices the app being installed', () => {
    parkedPrompt();
    const { result } = renderHook(() => useCanInstall());

    act(() => {
      window.__tallyKioskInstall = null;
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current).toBe(false);
  });

  it('stops listening on unmount', () => {
    const { result, unmount } = renderHook(() => useCanInstall());
    unmount();

    act(() => {
      parkedPrompt();
      window.dispatchEvent(new Event('beforeinstallprompt'));
    });

    expect(result.current).toBe(false);
  });

  it('takes back the exact handlers it put on the window', () => {
    // The pairing screen mounts and unmounts this on every navigation; a
    // handler left behind is a `useSyncExternalStore` callback for a component
    // that no longer exists, called on every install event for the session.
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useCanInstall());
    const offered = add.mock.calls.find(([type]) => type === 'beforeinstallprompt');
    const installed = add.mock.calls.find(([type]) => type === 'appinstalled');
    expect(offered).toBeDefined();
    expect(installed).toBeDefined();

    unmount();

    expect(remove).toHaveBeenCalledWith('beforeinstallprompt', offered![1]);
    expect(remove).toHaveBeenCalledWith('appinstalled', installed![1]);
  });

  it('stops hearing about a spent prompt after unmount', () => {
    // The other half of the teardown: `promptInstall` reaches its subscribers
    // through a module-level set, which window events do not cover.
    parkedPrompt();
    const first = renderHook(() => useCanInstall());
    const second = renderHook(() => useCanInstall());
    expect(second.result.current).toBe(true);

    first.unmount();

    act(() => {
      window.__tallyKioskInstall = null;
      window.dispatchEvent(new Event('appinstalled'));
    });

    // The surviving one still hears; nothing threw for the departed one.
    expect(second.result.current).toBe(false);
    second.unmount();
  });
});

describe('rendering where there is no browser', () => {
  it('offers no install, rather than reading a window that is not there', async () => {
    // The kiosk does not server-render. The hook still has to answer if
    // something ever does, and the only honest answer is "no prompt".
    const { renderToString } = await import('react-dom/server');
    parkedPrompt();

    function Probe() {
      return <span>{String(useCanInstall())}</span>;
    }

    expect(renderToString(<Probe />)).toContain('false');
  });
});

describe('promptInstall', () => {
  it('shows the browser dialog', async () => {
    const { prompt } = parkedPrompt();

    await promptInstall();

    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no prompt on offer', async () => {
    await expect(promptInstall()).resolves.toBeUndefined();
  });

  it('tells nobody anything when there is no prompt on offer', async () => {
    // Not merely harmless: waking every subscriber would repaint the pairing
    // screen on a tap that could not have changed anything.
    const { result } = renderHook(() => useCanInstall());
    const before = result.current;
    let renders = 0;
    const counted = renderHook(() => {
      renders += 1;
      return useCanInstall();
    });
    const rendersBefore = renders;

    await promptInstall();

    expect(result.current).toBe(before);
    expect(renders).toBe(rendersBefore);
    counted.unmount();
  });

  it('spends the event, so the button goes away rather than doing nothing', async () => {
    // Single-use: a dismissed prompt cannot be re-shown from the same event,
    // and Chrome fires a fresh one on a later load.
    const { prompt } = parkedPrompt();
    const { result } = renderHook(() => useCanInstall());
    expect(result.current).toBe(true);

    await act(async () => {
      await promptInstall();
    });

    expect(result.current).toBe(false);
    await promptInstall();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('spends it even when the browser refuses to show the dialog', async () => {
    // Already installed in another profile, or the gesture was lost. Nothing a
    // lobby screen can do about either.
    parkedPrompt(vi.fn(async () => Promise.reject(new Error('not allowed'))));
    const { result } = renderHook(() => useCanInstall());

    await act(async () => {
      await expect(promptInstall()).resolves.toBeUndefined();
    });

    expect(result.current).toBe(false);
  });
});

describe('isInstalled', () => {
  it('is true in a standalone window', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('standalone'),
    }));

    expect(isInstalled()).toBe(true);
  });

  it('is true for the other two installed display modes', () => {
    for (const mode of ['fullscreen', 'minimal-ui']) {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes(mode) }));
      expect(isInstalled()).toBe(true);
    }
  });

  it('is false in an ordinary tab', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));

    expect(isInstalled()).toBe(false);
  });

  it('falls through to the iOS flag when matchMedia throws', () => {
    // Ancient or exotic engine. iOS home-screen apps report this instead of
    // matching a display mode anyway.
    vi.stubGlobal('matchMedia', () => {
      throw new Error('not implemented');
    });
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: true,
    });

    expect(isInstalled()).toBe(true);

    Reflect.deleteProperty(window.navigator, 'standalone');
  });

  it('is false where neither says so', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: false,
    });

    expect(isInstalled()).toBe(false);

    Reflect.deleteProperty(window.navigator, 'standalone');
  });
});

describe('needsManualInstall', () => {
  it('is true on iOS Safari, where no event announces installing', () => {
    // A feature detect rather than a UA sniff: `navigator.standalone` is the
    // one WebKit property that means "this is the browser Add to Home Screen
    // lives in", and an iPadOS Safari claiming to be macOS still has it.
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: false,
    });

    expect(needsManualInstall()).toBe(true);

    Reflect.deleteProperty(window.navigator, 'standalone');
  });

  it('is false everywhere else', () => {
    expect(needsManualInstall()).toBe(false);
  });
});
