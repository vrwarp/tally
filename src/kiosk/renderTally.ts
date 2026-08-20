/**
 * Render counts, for the benchmark that reads them.
 *
 * The narrowest instrument the kiosk has, and the reason it exists is noise.
 * The perf suite's whole-phase profiles put the cost of a keystroke at a few
 * milliseconds against a noise floor of about twelve, which is the size of the
 * things left to fix — so "did this component stop re-rendering per letter"
 * cannot be answered by a stopwatch at all. A count can answer it exactly, on
 * any machine, which is the same argument `ThreadTime` makes for layout counts:
 * durations are about this machine, counts carry over to the Raspberry Pi the
 * kiosk actually runs on.
 *
 * It costs one property read per render when nobody is measuring. The probe
 * object only exists when `e2e/support/perf.ts` installed it before the page's
 * own scripts ran; on a church's kiosk `window.__kioskPerf` is undefined and
 * this is a lookup, a truthiness test and a return. No build flag, because the
 * bundle being measured must be the bundle a church is served — an instrument
 * that ships in a special build measures the special build.
 *
 * Called from the top of a component's body, which counts *renders* rather
 * than commits: React may render without committing. The kiosk has no
 * transitions or suspense boundaries on the paths this counts, so the two are
 * the same number here — and if that ever stops being true, a count that says
 * "the render ran" is still the cost being asked about, since the render is
 * where the time goes.
 */

/** The shape this needs of the probe — structural, so nothing imports e2e/. */
interface RenderProbe {
  renders?: Record<string, number>;
}

export function tallyRender(component: string): void {
  const renders = (window as { __kioskPerf?: RenderProbe }).__kioskPerf?.renders;
  if (renders) renders[component] = (renders[component] ?? 0) + 1;
}
