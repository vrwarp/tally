/**
 * The guard is a thing that swallows clicks, so the tests that matter most are
 * the ones proving what it lets through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { swallowTrailingClick, TRAILING_CLICK_MS } from '@/components/ui/trailingClick';

const disarms: Array<() => void> = [];

function arm(press: Parameters<typeof swallowTrailingClick>[0]) {
  const disarm = swallowTrailingClick(press);
  disarms.push(disarm);
  return disarm;
}

afterEach(() => {
  while (disarms.length) disarms.pop()?.();
});

/** A button standing in for whatever the dismissal uncovered. */
function target() {
  const button = document.createElement('button');
  const onClick = vi.fn();
  button.addEventListener('click', onClick);
  document.body.append(button);
  return { button, onClick };
}

function clickAt(button: HTMLElement, x: number, y: number) {
  return button.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
}

describe('swallowTrailingClick', () => {
  it('swallows the click that lands where the press did', () => {
    const { button, onClick } = target();
    arm({ x: 100, y: 100, at: Date.now() });

    const delivered = clickAt(button, 100, 100);

    expect(onClick).not.toHaveBeenCalled();
    // Cancelled as well as stopped, so a `<summary>` or an `<a>` underneath is
    // not toggled or followed either.
    expect(delivered).toBe(false);
  });

  it('forgives the wobble of a hand held still', () => {
    const { button, onClick } = target();
    arm({ x: 100, y: 100, at: Date.now() });

    clickAt(button, 108, 94);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('leaves a click somewhere else alone', () => {
    const { button, onClick } = target();
    arm({ x: 100, y: 100, at: Date.now() });

    clickAt(button, 400, 100);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('arms nothing when no press produced the dismissal', () => {
    const { button, onClick } = target();
    arm(null);

    clickAt(button, 100, 100);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('arms nothing for a press whose gesture is long over', () => {
    const { button, onClick } = target();
    arm({ x: 100, y: 100, at: Date.now() - TRAILING_CLICK_MS - 1 });

    clickAt(button, 100, 100);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /*
   * The safety property the whole design rests on: every real press by a real
   * hand brings its own `pointerdown`, so no real press is ever swallowed —
   * not even one aimed at the very spot the dismissal happened.
   */
  it('lets through a click that brought a press of its own', () => {
    const { button, onClick } = target();
    arm({ x: 100, y: 100, at: Date.now() });

    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    clickAt(button, 100, 100);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('lets through a click the keyboard asked for', () => {
    const { button, onClick } = target();
    arm({ x: 100, y: 100, at: Date.now() });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    clickAt(button, 100, 100);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('swallows one click and no more', () => {
    const { button, onClick } = target();
    arm({ x: 100, y: 100, at: Date.now() });

    clickAt(button, 100, 100);
    clickAt(button, 100, 100);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('gives up once the gesture can no longer be in flight', () => {
    vi.useFakeTimers();
    try {
      const { button, onClick } = target();
      arm({ x: 100, y: 100, at: Date.now() });

      vi.advanceTimersByTime(TRAILING_CLICK_MS + 1);
      clickAt(button, 100, 100);

      expect(onClick).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops listening when disarmed', () => {
    const { button, onClick } = target();
    arm({ x: 100, y: 100, at: Date.now() })();

    clickAt(button, 100, 100);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
