/**
 * The frame every core-team screen stands in.
 *
 * Below `lg` this is what it always was: a phone column, centred, at whatever
 * measure the page asked for. Above `lg` it stops centring and anchors to the
 * sidebar instead — one gutter from the rail's edge, one gutter from the right
 * — and takes the whole window up to 80rem.
 *
 * Both halves of that were bugs before it existed. Insights, Events, Students
 * and Settings each wrote the container out by hand, at `max-w-lg`,
 * `max-w-3xl`, `max-w-2xl` and `max-w-3xl`, so on a 1440px laptop the content's
 * left edge jumped 592 → 464 → 512 as a leader moved between three tabs whose
 * sidebar never moved: four siblings reading as four unrelated documents that
 * happened to share furniture. And centring a 480px column in the 1216px beside
 * the rail put a 370px void between the navigation and the thing it navigates.
 *
 * The recovered width is deliberately *not* spent on a wider measure — a
 * 1200px-wide line of prose is worse than a 480px one. It is spent on columns:
 * see the two-column grids on Insights and Events, and the toolbar row and
 * single-line rows on Students. `PageFrame` only makes the room.
 *
 * Check-in is the fifth screen and the one that arrived late. It kept the
 * centred phone column after the other four stopped, so a leader moving from
 * Students to Check in watched the page slide 80px right and the rail detach
 * from what it navigates. It now takes the same left edge as its siblings via
 * `pageFrameWidth` — and, since the roster learned to draw two columns of
 * names and the chooser two cards to a row, the same measure as well. Both
 * screens of that tab widen together, because the shared left edge is the
 * thing a counselor tapping from one to the other must not see move.
 */
import type { ReactNode } from 'react';
import { pageFrameWidth, type PageFrameWidthOptions } from '@/components/pageFrameWidth';
import { cn } from '@/lib/utils';

export interface PageFrameProps extends PageFrameWidthOptions {
  /** Gap between the page's own top-level blocks. */
  gap?: 'md' | 'lg';
  className?: string;
  children: ReactNode;
}

export function PageFrame({
  width = '3xl',
  widen = true,
  gap = 'md',
  className,
  children,
}: PageFrameProps) {
  return (
    <div
      className={cn(
        'flex flex-col py-4 lg:py-6',
        pageFrameWidth({ width, widen }),
        gap === 'lg' ? 'gap-8' : 'gap-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
