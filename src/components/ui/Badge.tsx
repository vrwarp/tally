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
          // No focus ring spelled out here: the one in `index.css` is the same
          // ring, drawn inside the badge so the roster row's `overflow-hidden`
          // card cannot clip it. Restating it with a positive offset — which is
          // what this line used to do — put the outward version back on the one
          // control most likely to be inside a clipping box.
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
  /**
   * What the warning actually says, spelled out on the badge: `Allergy:
   * peanuts` rather than `Allergy`.
   *
   * Only worth passing where the badge is the last thing somebody will read
   * before acting — the check-in row, where the alternative is leaving the
   * screen mid-queue. A badge given a detail stops being a fixed-width chip and
   * wraps to as many lines as the text needs; see below.
   */
  detail?: string | null;
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
export function WarningBadge({
  warning,
  detail,
  onPress,
  pressLabel,
  className,
}: WarningBadgeProps) {
  const meta = WARNING_META[warning];
  const note = detail?.trim() ? detail.trim() : null;
  const spoken = note ? `${meta.label}: ${note}` : meta.label;

  return (
    <Badge
      tone={meta.tone}
      title={spoken}
      onPress={onPress}
      pressLabel={pressLabel}
      className={cn(
        /*
         * The deliberate exception to `SHAPE`.
         *
         * Everything that keeps a badge one line — no shrinking, no wrapping —
         * exists so a lane of fixed-width chips cannot change a row's height as
         * the data changes. A medical note has the opposite requirement: it is
         * the content, it is as long as somebody upstream typed, and a clipped
         * one is worse than none because a counselor cannot tell it was cut.
         * So this badge shrinks, wraps, and takes the row height with it.
         */
        note && 'min-w-0 shrink items-start whitespace-normal px-2 py-1 text-left',
        className,
      )}
    >
      {meta.tone === 'warn' ? (
        // Held on the first line by `items-start` above, so a wrapped note reads
        // as one block of text rather than around a centred glyph.
        <span aria-hidden="true" className="leading-snug">
          ⚠
        </span>
      ) : null}
      {/* The full sentence for a screen reader, the short form for the eye —
          unless the button already carries its own label, in which case a
          second one inside it would be read out twice. */}
      {pressLabel ? null : <span className="sr-only">{spoken}</span>}
      {note ? (
        <span aria-hidden="true" className="min-w-0 break-words text-xs leading-snug">
          {meta.short}: <span className="font-medium">{note}</span>
        </span>
      ) : (
        <span aria-hidden="true">{meta.short}</span>
      )}
    </Badge>
  );
}
