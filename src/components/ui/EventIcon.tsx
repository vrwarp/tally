/**
 * A gathering's icon, as a tile.
 *
 * Every event that renders in a list renders one of these, whether or not
 * somebody picked an icon: a row with a tile and a row without are different
 * heights and different left edges, and a list that alternates between them
 * reads as broken rather than as sparse. An event with nothing chosen gets the
 * calendar glyph in a muted tone — present, obviously generic, and out of the
 * way.
 *
 * The glyph itself is inline SVG from the bundled catalogue (`lib/eventIcons`),
 * so it paints on the first frame with no font to download.
 */
import { findEventIcon } from '@/lib/eventIcons';
import { cn } from '@/lib/utils';

/** The calendar glyph, for a gathering nobody gave an icon. */
const FALLBACK = 'event';

export type EventIconSize = 'sm' | 'md' | 'lg';

const TILE: Record<EventIconSize, string> = {
  sm: 'size-9 rounded-lg',
  md: 'size-11 rounded-xl',
  lg: 'size-14 rounded-2xl',
};

const GLYPH: Record<EventIconSize, string> = {
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-8',
};

export interface EventIconProps {
  /** The stored Material Symbols name, or null for the generic tile. */
  name: string | null | undefined;
  size?: EventIconSize;
  /**
   * `brand` for the hero, where the gathering is the subject of the screen.
   * `neutral` everywhere it is one row among many.
   */
  tone?: 'neutral' | 'brand' | 'muted';
  className?: string;
}

export function EventIcon({ name, size = 'md', tone = 'neutral', className }: EventIconProps) {
  const icon = findEventIcon(name) ?? findEventIcon(FALLBACK);
  if (!icon) return null;

  // A chosen icon is worth full contrast; the fallback is deliberately quieter,
  // so a list of them does not look like a list of decisions nobody made.
  const generic = icon.name === FALLBACK && name !== FALLBACK;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center ring-1',
        TILE[size],
        tone === 'brand' && 'bg-brand-500/15 text-brand-300 ring-brand-500/25',
        tone === 'neutral' && !generic && 'bg-ink-800 text-ink-200 ring-ink-700',
        tone === 'neutral' && generic && 'bg-ink-800/60 text-ink-500 ring-ink-800',
        tone === 'muted' && 'bg-transparent text-ink-500 ring-transparent',
        className,
      )}
    >
      <svg viewBox="0 -960 960 960" fill="currentColor" className={GLYPH[size]}>
        <path d={icon.path} />
      </svg>
    </span>
  );
}
