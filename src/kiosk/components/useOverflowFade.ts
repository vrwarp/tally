/**
 * A scrolling region that only wears its ramp when there is something below it.
 *
 * `.kiosk-list-fade` dissolves the last few pixels of a scroll region so a
 * clipped row leaves a strip of card with no ink in it. That is right when the
 * list is longer than the box. It is a lie when it is not — and the reprint
 * screen made it lie at every shape, because the clearance the ramp needs at
 * maximum scroll (`pb-16 tall:pb-20`) was applied unconditionally: sixty-four
 * pixels of padding *is* overflow, so a list of three rows in a track that
 * holds four fired the ramp over a row that was fully present and tappable,
 * with nowhere to scroll to un-dim it.
 *
 * So the clearance and the ramp both hang off one measured fact: is the content
 * taller than the box. The clearance is a sibling spacer rather than padding on
 * the content, which is what keeps the measurement from chasing itself — the
 * measured element's height does not depend on the answer.
 *
 * It also reports *how much* is below, because a ramp that is always a row deep
 * is a second way of lying. The reprint screen's capped state overran its region
 * by nine pixels and answered with an eighty-eight pixel dissolve and an
 * eighty-eight pixel spacer, so two thirds of a row that was fully present and
 * fully tappable went to luminance 20 against a page of 8 — with bare page
 * underneath it, inside the same faded band. The ramp exists to stop a clipped
 * row from reading as a whole one; where nine pixels are clipped, nine pixels is
 * the whole of what it has to cover. `hidden` is that number, and the sheet
 * clamps it to the row-deep maximum for the lists that really do run on.
 *
 * `contentRef` goes on whatever the region actually holds — the rows, and
 * *only* the rows. Anything that is true of the result set rather than of the
 * box (a "keep typing" caption) belongs outside the scroller entirely: inside
 * it, the sentence is what makes the box overflow, the overflow is what fires
 * the ramp, and the ramp is what erases the sentence.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export function useOverflowFade<
  Region extends HTMLElement = HTMLDivElement,
  Content extends HTMLElement = HTMLDivElement,
>() {
  const regionRef = useRef<Region>(null);
  const contentRef = useRef<Content>(null);
  const [hidden, setHidden] = useState(0);

  useLayoutEffect(() => {
    const region = regionRef.current;
    const content = contentRef.current;
    if (!region || !content) return;
    const measure = () => setHidden(Math.max(0, content.offsetHeight - region.clientHeight));
    measure();
    /*
     * Guarded, because the measurement is an improvement on a fixed ramp rather
     * than a requirement for one: a runtime with no `ResizeObserver` — jsdom,
     * and whatever old WebKit is on the tablet the church already owned — gets
     * the layout-time measurement and stops there. What it loses is a ramp that
     * follows a list growing under it, which is a worse frame and not a broken
     * screen.
     */
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const overflowing = hidden > 1;

  return {
    regionRef,
    contentRef,
    overflowing,
    hidden,
    /**
     * Spread onto the scroller alongside `.kiosk-list-fade`. The sheet takes
     * the ramp as `min(--kiosk-hidden, one row)`; the clearance spacer under
     * the content reads the same computed depth back out of `--kiosk-fade`, so
     * the room reserved at maximum scroll is exactly the room the ramp needs
     * and never more than the overflow it is covering.
     */
    fadeVars: { '--kiosk-hidden': `${hidden}px` } as CSSProperties,
  };
}
