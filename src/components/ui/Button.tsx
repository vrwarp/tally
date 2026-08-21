import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

/*
 * A filled button is three colours that have to be measured together.
 *
 * The fill, the label on it, and — because the app's focus ring is drawn
 * *inside* the border box (see `index.css`) — the ring, which lands on that same
 * fill rather than on the page. Every filled entry below therefore names all
 * three, and none of them is `white`: white is not a project token, so it cannot
 * flip, and it was the label on all three of these. On the brand fill it
 * measured 2.77:1 in the dark theme and 4.10:1 in the light one — under AA on
 * both grounds, on the control this app is pressed by most — and the hover made
 * the dark case worse rather than better, because the fill got *lighter* under
 * a white label. On the green it was 3.30:1 and 2.28:1 hovered.
 *
 * The ring is printed in the label's own ink. It is the one colour on the
 * control already known to have been measured against that fill, and at 4.6:1
 * or better everywhere it clears the 3:1 a non-text indicator needs with room
 * to spare. The unfilled variants sit on neutral ground and keep the global
 * ring, which is legible there.
 *
 * Measured, dark / light, label-and-ring against fill:
 *
 *   primary  7.28 / 5.61   hover  9.42 / 7.15
 *   success  6.12 / 4.74   hover  8.85 / 5.45
 *   danger   4.62 / 7.85   hover  6.18 / 9.47
 *
 * `src/tokens.test.ts` recomputes those from the stylesheet and fails under 4.5.
 */
const VARIANTS: Record<Variant, string> = {
  /*
   * The disabled primary sheds presence, not legibility.
   *
   * The shared `disabled:opacity-50` fades a filled button and its label by the
   * same amount, which on the brand fill left the label at about 2:1 against
   * its own background — the least readable text in the app, printed on its
   * largest colour field, on the one control that is not yet usable. A button
   * waiting for input should get quieter, not harder to read.
   */
  primary:
    'bg-brand-fill text-brand-ink hover:bg-brand-fill-hover active:bg-brand-fill-hover ' +
    'focus-visible:outline-brand-ink ' +
    'disabled:bg-ink-800 disabled:text-ink-400 disabled:opacity-100',
  secondary: 'bg-ink-800 text-ink-100 ring-1 ring-ink-700 hover:bg-ink-700',
  ghost: 'bg-transparent text-ink-300 hover:bg-ink-800 hover:text-ink-100',
  danger:
    'bg-danger-600 text-danger-ink hover:bg-danger-700 focus-visible:outline-danger-ink',
  success:
    'bg-present-600 text-present-ink hover:bg-present-fill-hover ' +
    'focus-visible:outline-present-ink',
};

const SIZES: Record<Size, string> = {
  // 44px minimum height throughout: these are thumb targets on a phone held in
  // one hand, not mouse targets.
  //
  // Where there *is* a mouse, they come down a step. A 56px "Schedule event" is
  // a thumb landing zone at the bottom of a phone; the same button on a desktop
  // dialog is just a large rectangle, and it pushes everything above it down.
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm pointer-fine:min-h-9',
  lg: 'min-h-14 px-5 text-base pointer-fine:min-h-10 pointer-fine:px-4 pointer-fine:text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  leading?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  leading,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        leading
      )}
      {children}
    </button>
  );
}
