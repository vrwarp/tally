/**
 * The narrowest instrument the kiosk has.
 *
 * It exists because of noise: the perf suite puts the cost of a keystroke at a
 * few milliseconds against a floor of about twelve, which is the size of the
 * things left to fix — so "did this component stop re-rendering per letter"
 * cannot be answered with a stopwatch at all. A count answers it exactly, on
 * any machine, which is what carries over to the Raspberry Pi the kiosk
 * actually runs on.
 *
 * What has to hold is that it costs a church nothing. There is no build flag,
 * deliberately — an instrument that ships in a special build measures the
 * special build — so on a lobby screen `window.__kioskPerf` is undefined and
 * this must be a lookup, a truthiness test and a return.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { tallyRender } from '@/kiosk/renderTally';

type Probe = { renders?: Record<string, number> };

function probe(renders?: Record<string, number>) {
  (window as { __kioskPerf?: Probe }).__kioskPerf = renders ? { renders } : {};
}

afterEach(() => {
  Reflect.deleteProperty(window, '__kioskPerf');
});

describe('tallyRender', () => {
  it('does nothing at all when nobody is measuring', () => {
    expect(() => tallyRender('KioskApp')).not.toThrow();
    expect((window as { __kioskPerf?: Probe }).__kioskPerf).toBeUndefined();
  });

  it('does nothing when the probe is there but holds no counters', () => {
    probe();

    expect(() => tallyRender('KioskApp')).not.toThrow();
    expect((window as { __kioskPerf?: Probe }).__kioskPerf?.renders).toBeUndefined();
  });

  it('counts the first render of a component', () => {
    const renders: Record<string, number> = {};
    probe(renders);

    tallyRender('KioskApp');

    expect(renders).toEqual({ KioskApp: 1 });
  });

  it('adds to a count that is already there', () => {
    const renders: Record<string, number> = { KioskApp: 4 };
    probe(renders);

    tallyRender('KioskApp');

    expect(renders.KioskApp).toBe(5);
  });

  it('counts each component separately', () => {
    const renders: Record<string, number> = {};
    probe(renders);

    tallyRender('KioskApp');
    tallyRender('Keyboard');
    tallyRender('KioskApp');

    expect(renders).toEqual({ KioskApp: 2, Keyboard: 1 });
  });
});
