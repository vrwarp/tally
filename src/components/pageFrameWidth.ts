/**
 * The page frame's placement and measure, as classes rather than as an element.
 *
 * `PageFrame` is the element form, and is what a page should reach for. This
 * exists for the one screen that cannot use it: check-in's bands are siblings
 * rather than blocks in a column — the search box sticks to the app bar, the
 * filter rule sits under it, the roster scrolls beneath both — so each band
 * applies the same measurements itself and the screen still has one left edge.
 *
 * It lives in its own module so `PageFrame.tsx` stays a component file; the two
 * are read together.
 */
import { cn } from '@/lib/utils';

/**
 * The phone measure. Kept per-page because these screens genuinely differ at
 * 390px — a call list wants a narrow column, a calendar wants what it can get —
 * and because it stops mattering at `lg` for a page that widens.
 */
export type PageWidth = 'lg' | '2xl' | '3xl';

const WIDTHS: Record<PageWidth, string> = {
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
};

export interface PageFrameWidthOptions {
  width?: PageWidth;
  /**
   * Whether the frame takes the window above `lg`.
   *
   * By default it does, because the room beside the rail is there to be spent
   * on columns — and the rule is that it *is* spent on columns, never on a
   * longer line.
   *
   * Check-in was the long-standing exception, on the reasoning that a roster
   * row stretched across a monitor puts a student's name and the control that
   * checks them in a foot apart. That was an argument against one row per
   * window, not against the width: the roster now draws two ~600px columns and
   * the gathering chooser two cards to a row, so both take it like everything
   * else. What remains behind this flag is the kiosk preview, which genuinely
   * has nothing to put beside itself.
   *
   * Either way the frame stops *centring* — that half is about where a page
   * starts, not how wide it is, and it has to be the same on every screen or
   * the left edge moves as a leader changes tabs.
   */
  widen?: boolean;
}

/**
 * Anchoring is conditional on there being something to anchor *to*.
 *
 * "Not centred" only reads as deliberate next to a sidebar: it is what attaches
 * the page to the rail beside it. The four core-team screens always have that
 * rail, so for them this is always on. Check-in does not — a counselor's
 * account has one tab, `AppShell` draws no sidebar for it, and a column jammed
 * against the left edge of a 1440px window with 700px of void beside it is not
 * alignment, it is a page that lost its layout.
 *
 * So the shell says whether the rail is up (`data-rail` on the element carrying
 * `group/shell`) and the frame follows it, rather than each page re-deriving
 * "does this person see navigation" and drifting from the answer `AppShell`
 * actually used.
 */
const ANCHORED = 'lg:group-data-[rail]/shell:mx-0';

export function pageFrameWidth({ width = '3xl', widen = true }: PageFrameWidthOptions = {}): string {
  return cn(
    'mx-auto w-full px-4',
    WIDTHS[width],
    // Above lg: one gutter from the rail's edge, one from the right.
    ANCHORED,
    'lg:px-8',
    widen && 'lg:max-w-7xl',
  );
}
