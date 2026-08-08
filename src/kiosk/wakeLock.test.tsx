/**
 * The screen that is not allowed to go to sleep.
 *
 * A wake lock is a lease the browser can take back at any time, so what these
 * pin is not "one request was made" but the recovery: every ordinary way of
 * losing the lock is followed by taking it again, and every way of failing to
 * get one is followed by asking later. The one thing deliberately *not*
 * attempted is a request while the page is hidden — the spec refuses those, and
 * a kiosk in the background has no claim on a device's screen anyway.
 *
 * The API is faked wholesale. jsdom has no `navigator.wakeLock` at all, which is
 * also the case these have to cover for a real older iPad.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskApp, type KioskServices } from '@/kiosk/KioskApp';
import { keepScreenAwake, WAKE_LOCK_RETRY_MS } from '@/kiosk/wakeLock';

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

describe('keepScreenAwake', () => {
  it('takes a screen lock straight away', async () => {
    const stop = keepScreenAwake();
    await settle();

    expect(request).toHaveBeenCalledWith('screen');
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  it('holds one lock rather than stacking them', async () => {
    const stop = keepScreenAwake();
    await settle();

    // Everything that could plausibly prompt a re-request, while a lock is held.
    setVisibility('visible');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pointerdown'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAKE_LOCK_RETRY_MS * 3);
    });

    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  it('takes another when the browser drops the one it had', async () => {
    const stop = keepScreenAwake();
    await settle();

    // What an app switch looks like: released, then hidden. Nothing is asked
    // for while hidden — the spec would refuse it.
    granted[0]!.drop();
    setVisibility('hidden');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  it('asks again after a refusal', async () => {
    // A browser saying no — low battery, or a policy that forbids it.
    answer = () => Promise.reject(new Error('NotAllowedError'));
    const stop = keepScreenAwake();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(granted).toHaveLength(0);

    answer = () => Promise.resolve(newSentinel());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAKE_LOCK_RETRY_MS);
    });
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
    expect(granted).toHaveLength(1);
    stop();
  });

  it('waits for the page to be visible before its first request', async () => {
    setVisibility('hidden');
    const stop = keepScreenAwake();
    await settle();
    expect(request).not.toHaveBeenCalled();

    setVisibility('visible');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  it('releases what it holds on teardown, and stops asking', async () => {
    const stop = keepScreenAwake();
    await settle();
    stop();

    expect(granted[0]!.release).toHaveBeenCalled();

    setVisibility('hidden');
    setVisibility('visible');
    window.dispatchEvent(new Event('pointerdown'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAKE_LOCK_RETRY_MS * 3);
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('releases a lock that arrives after teardown', async () => {
    // Torn down while the browser was still thinking: nothing else would ever
    // let this lease go.
    const stop = keepScreenAwake();
    stop();
    await settle();

    expect(granted[0]!.release).toHaveBeenCalled();
  });

  it('does nothing at all where there is no wake lock', async () => {
    removeWakeLock();

    const stop = keepScreenAwake();
    await settle();
    expect(() => stop()).not.toThrow();
  });
});

/*
 * The wiring, mocked down to what a boot touches. The claim is only that the
 * kiosk asks for the lock from mount — before pairing, before a binding, before
 * anything a parent could do — and lets it go when the app comes down.
 */
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
