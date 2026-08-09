import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

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
    'bg-brand-500 text-white hover:bg-brand-400 active:bg-brand-600 ' +
    'disabled:bg-ink-800 disabled:text-ink-400 disabled:opacity-100',
  secondary: 'bg-ink-800 text-ink-100 ring-1 ring-ink-700 hover:bg-ink-700',
  ghost: 'bg-transparent text-ink-300 hover:bg-ink-800 hover:text-ink-100',
  danger: 'bg-danger-600 text-white hover:bg-danger-500',
  success: 'bg-present-600 text-white hover:bg-present-500',
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
