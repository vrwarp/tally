/**
 * A row of filter tabs.
 *
 * Lifted out of the attendance trend when the whole insights screen started
 * splitting by gathering: the strip's tabs and the page's tabs have to look and
 * behave identically, or a leader reads them as two different controls.
 *
 * `aria-pressed` rather than the tablist role on purpose. These select which
 * slice of one screen the content below describes; they do not swap panels in
 * and out, and announcing "tab 2 of 3" for a filter is a promise about keyboard
 * behaviour this does not keep.
 */
import { cn } from '@/lib/utils';

export interface TabOption {
  /** Value handed back to `onSelect`. */
  id: string;
  label: string;
  /** Optional trailing count, e.g. how many rows the slice holds. */
  count?: number;
}

export interface TabBarProps {
  /** Describes what is being narrowed, for a screen reader. */
  label: string;
  options: readonly TabOption[];
  selected: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function TabBar({ label, options, selected, onSelect, className }: TabBarProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex gap-2 overflow-x-auto scroll-touch', className)}
    >
      {options.map((option) => {
        const active = option.id === selected;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            aria-pressed={active}
            className={cn(
              'flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 transition-colors',
              active
                ? 'bg-brand-500/15 text-brand-300 ring-brand-500/30'
                : 'bg-ink-900 text-ink-400 ring-ink-800 hover:text-ink-200',
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                  active ? 'bg-brand-500/20 text-brand-200' : 'bg-ink-800 text-ink-400',
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
