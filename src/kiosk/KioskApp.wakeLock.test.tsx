/**
 * That the kiosk actually holds the screen awake.
 *
 * `wakeLock.test.ts` is where the lease behaviour lives — never two at once,
 * always ask again, let go on the way out. This is the one claim that needs the
 * whole app rendered: that the request goes out from *boot*, before pairing,
 * before a binding, before anything a parent could do, and that the lease is
 * given back when the app comes down. A kiosk that only asks once a gathering
 * is bound spends the quiet half-hour before the doors open going dark.
 *
 * The API is faked wholesale. jsdom has no `navigator.wakeLock` at all, which is
 * also the case this has to cover for a real older iPad.
 */
import { act, render } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';

type Sentinel = {
  release: ReturnType<typeof vi.fn>;
  addEventListener: (type: 'release', listener: () => void) => void;
  /** Play the browser taking the lease back. */
  drop: () => void;
};

/** Every sentinel handed out, in order. */
let granted: Sentinel[] = [];
/** What the next request does. Reassigned per test. */
let answer: () => Promise<Sentinel> = () => Promise.resolve(newSentinel());
let request: ReturnType<typeof vi.fn>;

function newSentinel(): Sentinel {
  const listeners: (() => void)[] = [];
  const sentinel: Sentinel = {
    release: vi.fn(async () => {}),
    addEventListener: (_type, listener) => listeners.push(listener),
    drop: () => listeners.forEach((listener) => listener()),
  };
  granted.push(sentinel);
  return sentinel;
}

function installWakeLock(): void {
  request = vi.fn(() => answer());
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    writable: true,
    value: { request },
  });
}

function removeWakeLock(): void {
  Reflect.deleteProperty(navigator as object, 'wakeLock');
}

/** jsdom's `visibilityState` is read-only, so it is redefined rather than set. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Let the request promise land. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  granted = [];
  answer = () => Promise.resolve(newSentinel());
  installWakeLock();
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  removeWakeLock();
  setVisibility('visible');
});

/* The wiring, mocked down to what a boot touches. */
vi.mock('@/kiosk/services', () => ({
  restoredUid: vi.fn(async () => null),
  beginPairing: vi.fn(async () => ({ code: 'HJ4K2P', secret: 's3cret', expiresInSeconds: 600 })),
  pollPairing: vi.fn(async () => null),
  replayQueue: vi.fn(async () => 0),
}) as unknown as KioskServices);

describe('the kiosk', () => {
  it('holds the screen awake from boot, and releases it on unmount', async () => {
    const view = render(<KioskApp />);
    await settle();

    expect(request).toHaveBeenCalledWith('screen');

    view.unmount();
    await settle();
    expect(granted[0]!.release).toHaveBeenCalled();
  });
});
