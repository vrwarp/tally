/**
 * Keeping the lobby screen lit.
 *
 * A wake lock is a lease rather than a setting: the browser hands out a
 * sentinel and takes it back the moment the page stops being the visible one.
 * So almost nothing here is about *getting* the lock — it is about what happens
 * around losing it, because the failure this module exists to prevent is a
 * parent walking up to a black rectangle that wants a passcode.
 *
 * Three claims, and each of them is a way to end up dark:
 *
 * - **Never two leases at once.** A request in flight, or a lock already held,
 *   means the next event does nothing. Without that guard the four things that
 *   ask (a tick, a visibility change, a focus, a touch) stack leases the
 *   teardown then releases one of.
 * - **Always ask again.** A refusal is not permanent — a battery that was low
 *   at boot is on the charger it lives on by seven — so the retry keeps going
 *   rather than deciding once that this device does not do wake locks.
 * - **Let go of everything on the way out.** A timer and three listeners, all
 *   holding a closure over a lease that the next mount will ask for again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAKE_LOCK_RETRY_MS, keepScreenAwake } from '@/kiosk/wakeLock';

/** A sentinel that records its own release and hands back its listeners. */
function sentinel() {
  const listeners: Array<() => void> = [];
  const record = {
    released: 0,
    releaseFails: false,
    listeners,
    release: vi.fn(async () => {
      record.released += 1;
      if (record.releaseFails) throw new Error('already released');
    }),
    addEventListener: vi.fn((_type: 'release', listener: () => void) => {
      listeners.push(listener);
    }),
    /** What the browser does on every app switch. */
    browserTakesItBack() {
      for (const listener of [...listeners]) listener();
    },
  };
  return record;
}

let request: ReturnType<typeof vi.fn>;
let granted: ReturnType<typeof sentinel>;

/** jsdom has no way to set `visibilityState`, so it is redefined per test. */
function visibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

/** Lets the promise chain inside `acquire` settle. */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility('visible');
  granted = sentinel();
  request = vi.fn(async () => granted);
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    writable: true,
    value: { request },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator as object, 'wakeLock');
});

describe('on a device that has the API', () => {
  it('asks for the screen the moment the kiosk mounts', async () => {
    const stop = keepScreenAwake();
    await settle();

    expect(request).toHaveBeenCalledWith('screen');
    stop();
  });

  it('does not ask twice while one request is in flight', async () => {
    let hand = (value: ReturnType<typeof sentinel>) => {
      void value;
    };
    request.mockReturnValueOnce(
      new Promise((resolve) => {
        hand = resolve;
      }),
    );

    const stop = keepScreenAwake();
    // Four events land while the browser is still thinking about the first ask.
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(WAKE_LOCK_RETRY_MS);

    expect(request).toHaveBeenCalledTimes(1);

    hand(granted);
    await settle();
    stop();
  });

  it('does not ask again while a lock is held', async () => {
    const stop = keepScreenAwake();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(WAKE_LOCK_RETRY_MS * 4);
    await settle();

    // Stacked leases are worse than none: the teardown releases one of them.
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  it('asks again once the browser has taken the lease back', async () => {
    const stop = keepScreenAwake();
    await settle();

    // An app switch. Nothing to be done about losing it — a kiosk in the
    // background has no business keeping a tablet awake.
    granted.browserTakesItBack();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  it('listens for the release on the lease it was actually given', async () => {
    const stop = keepScreenAwake();
    await settle();

    expect(granted.addEventListener).toHaveBeenCalledWith('release', expect.any(Function));
    stop();
  });

  it('ignores a release from a lease it has already replaced', async () => {
    const first = granted;
    const second = sentinel();
    const stop = keepScreenAwake();
    await settle();

    first.browserTakesItBack();
    request.mockResolvedValue(second);
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(request).toHaveBeenCalledTimes(2);

    // A late `release` from the old sentinel must not drop the new lease, or
    // the kiosk asks for a third while holding a perfectly good second.
    first.browserTakesItBack();
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('when the browser will not grant one', () => {
  it('says nothing and keeps asking', async () => {
    request.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const stop = keepScreenAwake();
    await settle();

    // Low battery at boot is the ordinary refusal, and the tablet is on the
    // charger it lives on by seven.
    vi.advanceTimersByTime(WAKE_LOCK_RETRY_MS);
    await settle();
    expect(request).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(WAKE_LOCK_RETRY_MS);
    await settle();
    expect(request).toHaveBeenCalledTimes(3);

    stop();
  });

  it('does not ask while the page is not the visible one', async () => {
    visibility('hidden');
    const stop = keepScreenAwake();
    await settle();

    // The spec refuses a hidden document, and a refusal is a rejection; the
    // visible case is the only one that can succeed.
    expect(request).not.toHaveBeenCalled();

    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('on the way out', () => {
  it('releases the lease it is holding', async () => {
    const stop = keepScreenAwake();
    await settle();

    stop();
    await settle();

    expect(granted.release).toHaveBeenCalledTimes(1);
  });

  it('releases a lease that arrived after the teardown', async () => {
    let hand = (value: ReturnType<typeof sentinel>) => {
      void value;
    };
    request.mockReturnValueOnce(
      new Promise((resolve) => {
        hand = resolve;
      }),
    );
    const stop = keepScreenAwake();

    stop();
    hand(granted);
    await settle();

    // Nobody would ever release this one otherwise, and a kiosk that unmounts
    // its app is usually about to reload the page.
    expect(granted.release).toHaveBeenCalledTimes(1);
  });

  it('survives a release the browser refuses', async () => {
    granted.releaseFails = true;
    const stop = keepScreenAwake();
    await settle();

    expect(() => stop()).not.toThrow();
    await settle();
  });

  it('stops the retry and all three listeners', async () => {
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    const started = vi.spyOn(globalThis, 'setInterval');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const addDocument = vi.spyOn(document, 'addEventListener');
    const addWindow = vi.spyOn(window, 'addEventListener');

    const stop = keepScreenAwake();
    await settle();

    const handle = started.mock.results.at(-1)?.value as ReturnType<typeof setInterval>;
    const visibilityAdded = addDocument.mock.calls.find(([type]) => type === 'visibilitychange');
    const focusAdded = addWindow.mock.calls.find(([type]) => type === 'focus');
    const touchAdded = addWindow.mock.calls.find(([type]) => type === 'pointerdown');
    expect(visibilityAdded).toBeDefined();
    expect(focusAdded).toBeDefined();
    expect(touchAdded).toBeDefined();

    stop();

    // The same name and the same function, because `removeEventListener`
    // matches on both — either being wrong leaves a closure over a dead lease.
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', visibilityAdded![1]);
    expect(removeWindow).toHaveBeenCalledWith('focus', focusAdded![1]);
    expect(removeWindow).toHaveBeenCalledWith('pointerdown', touchAdded![1]);
    // And the timer: a kiosk that mounts and unmounts through an evening would
    // otherwise leave one interval per mount running against a closure that
    // can no longer do anything with what it asks for.
    expect(cleared).toHaveBeenCalledWith(handle);
  });

  it('asks for nothing more once it has been stopped', async () => {
    const stop = keepScreenAwake();
    await settle();
    stop();
    await settle();

    vi.advanceTimersByTime(WAKE_LOCK_RETRY_MS * 3);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pointerdown'));
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('releases exactly once, however often it is stopped', async () => {
    const stop = keepScreenAwake();
    await settle();

    stop();
    stop();
    await settle();

    expect(granted.release).toHaveBeenCalledTimes(1);
  });
});

describe('on a device that has no wake lock at all', () => {
  it('does nothing, and says nothing a parent could act on', async () => {
    Reflect.deleteProperty(navigator as object, 'wakeLock');

    const stop = keepScreenAwake();
    await settle();

    expect(() => stop()).not.toThrow();
    // No timer either: an older iPad should not wake up twice a minute to find
    // out again that it cannot do this.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the retry cadence', () => {
  it('is under every stock display timeout worth naming', () => {
    expect(WAKE_LOCK_RETRY_MS).toBe(30_000);
  });
});
