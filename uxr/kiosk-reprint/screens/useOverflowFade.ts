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
 * `contentRef` goes on whatever the region actually holds (rows *and* any
 * sentence under them); `regionRef` on the scroller.
 */
import { useLayoutEffect, useRef, useState } from 'react';

export function useOverflowFade<
  Region extends HTMLElement = HTMLDivElement,
  Content extends HTMLElement = HTMLDivElement,
>() {
  const regionRef = useRef<Region>(null);
  const contentRef = useRef<Content>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const region = regionRef.current;
    const content = contentRef.current;
    if (!region || !content) return;
    const measure = () => setOverflowing(content.offsetHeight - region.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return { regionRef, contentRef, overflowing };
}
