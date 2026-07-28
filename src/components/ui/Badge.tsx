import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { WARNING_META } from '@/components/ui/warnings';
import type { RosterWarning } from '@/types';

type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-800 text-ink-300 ring-ink-700',
  brand: 'bg-brand-500/15 text-brand-300 ring-brand-500/30',
  success: 'bg-present-500/15 text-present-400 ring-present-500/30',
  warn: 'bg-warn-500/15 text-warn-400 ring-warn-500/30',
  danger: 'bg-danger-500/15 text-danger-400 ring-danger-500/30',
};

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
  /**
   * Makes the badge a button.
   *
   * A badge states a fact, and almost every fact on a roster row is one
   * somebody could do something about: a missing phone number is a number to
   * add, an allergy is a note to read, a visitor is a student to promote. Where
   * there is such an action the badge *is* the affordance — a second control
   * beside it would be a second thing to aim at in the same 44px lane.
   *
   * The hit area is the badge, which is smaller than a thumb target on purpose:
   * these live on the desktop roster, where the pointer is precise and the
   * whole row is already a link to the place with room to do everything. On a
   * phone the same badges stay readable and are simply not the way in.
   */
  onPress?: () => void;
  /** What the action is, for a screen reader. Required with `onPress`. */
  pressLabel?: string;
}

/**
 * `shrink-0` and `whitespace-nowrap` are not decoration.
 *
 * These sit in fixed-width lanes on two different roster rows. A badge allowed
 * to shrink wraps its own two-word label onto a second line and takes the row
 * height with it, which on a list of eighty-five students is a page that
 * changes length as the data changes.
 */
const SHAPE =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 ' +
  'text-[11px] font-semibold ring-1';

export function Badge({ tone = 'neutral', children, className, title, onPress, pressLabel }: BadgeProps) {
  if (onPress) {
    return (
      <button
        type="button"
        title={title}
        aria-label={pressLabel}
        onClick={(event) => {
          // These sit on top of a row-wide link. Without this a press on the
          // badge navigates to the detail page as well as opening the panel.
          event.preventDefault();
          event.stopPropagation();
          onPress();
        }}
        className={cn(
          SHAPE,
          TONES[tone],
          'cursor-pointer transition-[filter,box-shadow] hover:brightness-125',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
          className,
        )}
      >
        {children}
      </button>
    );
  }

  return (
    <span title={title} className={cn(SHAPE, TONES[tone], className)}>
      {children}
    </span>
  );
}

export interface WarningBadgeProps {
  warning: RosterWarning;
  /** See `BadgeProps.onPress`. Without it this is a plain, unpressable chip. */
  onPress?: () => void;
  /** The verb, for a screen reader: "Add a parent contact for Aaron Mensah". */
  pressLabel?: string;
  className?: string;
}

/**
 * Renders a roster warning as its badge. All warnings are advisory, and the ⚠
 * belongs only to the one with a consequence at the door — see `warnings.ts`.
 */
export function WarningBadge({ warning, onPress, pressLabel, className }: WarningBadgeProps) {
  const meta = WARNING_META[warning];
  return (
    <Badge
      tone={meta.tone}
      title={meta.label}
      onPress={onPress}
      pressLabel={pressLabel}
      className={className}
    >
      {meta.tone === 'warn' ? <span aria-hidden="true">⚠</span> : null}
      {/* The full sentence for a screen reader, the short form for the eye —
          unless the button already carries its own label, in which case a
          second one inside it would be read out twice. */}
      {pressLabel ? null : <span className="sr-only">{meta.label}</span>}
      <span aria-hidden="true">{meta.short}</span>
    </Badge>
  );
}
