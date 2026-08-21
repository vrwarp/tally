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
      // Wraps rather than scrolls: a ministry with four gatherings would
      // otherwise have the fourth tab clipped at the edge of the screen with
      // nothing to say it was there.
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map((option) => {
        const active = option.id === selected;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            aria-pressed={active}
            /*
             * The full label, for the tab whose own text has been cut.
             *
             * The accessible name still comes from the text content, which is
             * the whole title either way; this is for the pointer.
             */
            title={option.label}
            className={cn(
              'flex min-h-11 min-w-0 max-w-56 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 transition-colors',
              active
                ? 'bg-brand-500/15 text-brand-300 ring-brand-500/30'
                : 'bg-ink-900 text-ink-400 ring-ink-800 hover:text-ink-200',
            )}
          >
            {/*
              Capped and cut, because these labels are event titles and nothing
              anywhere caps *those*: the editor asks only that a title is not
              empty, and ministries write "Friday Fellowship — Senior High
              (Fellowship Hall, term time only)".

              A flex item that cannot shrink takes its max-content width, so a
              title like that became one ~600px button — `flex-wrap` gives it
              its own line but does not narrow it — and with no `overflow-x`
              anywhere above it the *page* scrolled sideways instead, dragging
              every card and every call row off the right edge of a phone. On
              the screen whose whole job is working a call list.

              The cut is the rule the event rows already apply to the same
              strings, and at the titles a ministry actually types it costs
              nothing: "Friday Fellowship" is 153px of the 224 allowed.
            */}
            <span className="truncate">{option.label}</span>
            {option.count !== undefined ? (
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
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
