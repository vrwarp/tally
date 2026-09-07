/**
 * The three sticky bars on check-in, and the numbers that keep them stacked.
 *
 * Nothing renders this hook's output — it writes a CSS custom property on
 * `<html>` and `position: sticky` reads it — so a test is the only thing that
 * can see it at all. What has to hold: the height reaches the document element,
 * it is republished when the element resizes or the breakpoint flips, and it is
 * taken away on unmount rather than left behind to strand whatever sticks under
 * it.
 */
import { render, renderHook } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHeightVar } from '@/hooks/useHeightVar';

/** jsdom lays nothing out, so `offsetHeight` is whatever a test says it is. */
function fixHeight(height: number) {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.height ?? height);
    },
  });
}

/** The observers built during a render, so a test can fire one by hand. */
const observers: { element: Element; fire: () => void }[] = [];

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(element: Element) {
    observers.push({ element, fire: () => this.callback() });
  }
  disconnect() {
    // Recorded rather than acted on: what matters is that it happened.
    disconnected += 1;
  }
  unobserve() {}
}

let disconnected = 0;

function Bar({ name, height }: { name: string; height?: number }) {
  const ref = useHeightVar<HTMLDivElement>(name);
  return <div ref={ref} data-testid="bar" data-height={height} />;
}

beforeEach(() => {
  observers.length = 0;
  disconnected = 0;
  fixHeight(48);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  document.documentElement.style.removeProperty('--top-bar');
  document.documentElement.style.removeProperty('--search-bar');
  vi.unstubAllGlobals();
});

describe('useHeightVar', () => {
  it('publishes the height under the name it was given', () => {
    render(<Bar name="--top-bar" />);
    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('48px');
  });

  it('publishes pixels, because that is what `top:` needs', () => {
    render(<Bar name="--top-bar" height={72} />);
    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('72px');
  });

  it('publishes zero for a bar the breakpoint has hidden', () => {
    // `offsetHeight` reads 0 for a `display: none` element, which is exactly
    // what a `lg:hidden` bar should contribute to the offset below it.
    render(<Bar name="--top-bar" height={0} />);
    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('0px');
  });

  it('republishes when the element resizes', () => {
    const { getByTestId } = render(<Bar name="--top-bar" height={48} />);
    getByTestId('bar').dataset.height = '96';

    expect(observers).toHaveLength(1);
    observers[0]!.fire();

    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('96px');
  });

  it('republishes on a window resize, which is how the breakpoint flip arrives', () => {
    // The observer sees content changes; it does not see an element being
    // hidden by a media query, because that is not a resize of the element.
    const { getByTestId } = render(<Bar name="--top-bar" height={48} />);
    getByTestId('bar').dataset.height = '0';

    window.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('0px');
  });

  it('takes the property away again on unmount', () => {
    const { unmount } = render(<Bar name="--top-bar" />);
    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('48px');

    unmount();

    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('');
    expect(disconnected).toBe(1);
  });

  it('stops listening to the window on unmount', () => {
    const { unmount } = render(<Bar name="--top-bar" height={48} />);
    unmount();

    // Nothing should answer this now; the assertion is that it does not throw
    // and does not put the property back.
    window.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('');
  });

  it('takes back the exact resize handler it put on the window', () => {
    // Three of these are mounted on the check-in screen and it remounts on
    // every navigation; a handler left behind measures a node that is gone and
    // writes a height for a bar nobody can see.
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<Bar name="--top-bar" height={48} />);
    const added = add.mock.calls.find(([type]) => type === 'resize');
    expect(added).toBeDefined();

    unmount();

    expect(remove).toHaveBeenCalledWith('resize', added![1]);
  });

  it('follows the name when it changes', () => {
    // A callback pinned to the first name would go on writing the old property
    // and never write the new one, leaving whatever sticks below it offset by a
    // number nothing updates.
    const { result, rerender } = renderHook(({ name }) => useHeightVar<HTMLDivElement>(name), {
      initialProps: { name: '--top-bar' },
    });
    const first = result.current;

    rerender({ name: '--search-bar' });

    expect(result.current).not.toBe(first);
    result.current(document.createElement('div'));
    expect(document.documentElement.style.getPropertyValue('--search-bar')).toBe('48px');
    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('');
  });

  it('does nothing when handed no element', () => {
    // React 19 calls the cleanup this returns instead of calling the ref with
    // null, so nothing in the app reaches this — but a ref is a plain function
    // anybody may call, and reading `offsetHeight` off null throws.
    const { result } = renderHook(() => useHeightVar<HTMLDivElement>('--top-bar'));

    expect(() => result.current(null)).not.toThrow();
    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('');
  });

  it('works where ResizeObserver does not exist', () => {
    // Older Safari on the tablets in the lobby. The resize listener still
    // carries the breakpoint flip, which is the case that matters most there.
    vi.stubGlobal('ResizeObserver', undefined);

    const { getByTestId, unmount } = render(<Bar name="--top-bar" height={40} />);
    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('40px');

    getByTestId('bar').dataset.height = '80';
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--top-bar')).toBe('80px');

    expect(() => unmount()).not.toThrow();
  });
});
