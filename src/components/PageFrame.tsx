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
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageFrameProps {
  /**
   * The phone measure. Kept per-page because these screens genuinely differ at
   * 390px — a call list wants a narrow column, a calendar wants what it can
   * get — and because it stops mattering at `lg`, where the frame takes over.
   */
  width?: 'lg' | '2xl' | '3xl';
  /** Gap between the page's own top-level blocks. */
  gap?: 'md' | 'lg';
  className?: string;
  children: ReactNode;
}

const WIDTHS = {
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
} as const;

export function PageFrame({ width = '3xl', gap = 'md', className, children }: PageFrameProps) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col px-4 py-4',
        WIDTHS[width],
        gap === 'lg' ? 'gap-8' : 'gap-4',
        // Above lg: anchored, not centred, and as wide as the window allows.
        'lg:mx-0 lg:max-w-7xl lg:px-8 lg:py-6',
        className,
      )}
    >
      {children}
    </div>
  );
}
