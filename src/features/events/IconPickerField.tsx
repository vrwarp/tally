/**
 * Picking the glyph a gathering wears.
 *
 * Inline rather than a dialog of its own. The editor is already a modal, and a
 * second one over it would need its own dismissal story on a phone, where the
 * back gesture closes whichever sheet is on top — a leader trying to shut the
 * icon grid would find they had abandoned the whole form. So this is a
 * disclosure: a row stating the current choice, which opens a searchable grid
 * underneath it and collapses again the moment something is picked.
 *
 * The grid is capped and scrolls on its own. A hundred-odd icons is five
 * screens of thumb-sized tiles, and a picker that pushes the Save button off
 * the bottom of the form is a picker people close without choosing anything.
 */
import { useId, useMemo, useState } from 'react';
import { EventIcon } from '@/components/ui/EventIcon';
import { TextField } from '@/components/ui';
import { findEventIcon, searchEventIcons } from '@/lib/eventIcons';
import { cn } from '@/lib/utils';

export interface IconPickerFieldProps {
  /** The selected Material Symbols name, or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  hint?: string;
}

export function IconPickerField({ value, onChange, hint }: IconPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  /*
   * The field's own label, borrowed by the button.
   *
   * There is no `<label htmlFor>` to be had here — the control is a button, not
   * an input — so without this the disclosure announces as "Church", a word
   * with no clue in it about what it is a button *for*. "Icon, Church" is the
   * same thing a sighted reader gets from the row above it.
   */
  const labelId = useId();
  const valueId = useId();

  const selected = findEventIcon(value);
  const results = useMemo(() => searchEventIcons(query), [query]);

  const choose = (name: string | null) => {
    onChange(name);
    setOpen(false);
    // Next time it opens it should be the whole catalogue again: a stale search
    // reads as "these are the only icons there are".
    setQuery('');
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 pointer-fine:gap-1">
      <span id={labelId} className="text-sm font-medium text-ink-300 pointer-fine:text-xs">
        Icon
      </span>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        className={cn(
          'flex min-h-14 items-center gap-3 rounded-xl bg-ink-900 px-3 text-left ring-1',
          'pointer-fine:min-h-11 pointer-fine:rounded-lg',
          open ? 'ring-brand-400' : 'ring-ink-700 active:bg-ink-800',
        )}
      >
        <EventIcon name={value} size="md" tone={selected ? 'brand' : 'neutral'} />
        <span id={valueId} className="min-w-0 flex-1 truncate text-sm text-ink-200">
          {selected ? selected.label : 'No icon'}
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs font-semibold text-brand-300">
          {open ? 'Done' : 'Change'}
        </span>
      </button>

      {open ? (
        <div className="mt-1 flex flex-col gap-2 rounded-xl bg-ink-950 p-2 ring-1 ring-ink-800">
          <TextField
            label="Search icons"
            labelHidden
            type="search"
            value={query}
            onChange={(changed) => setQuery(changed.target.value)}
            onClear={() => setQuery('')}
            placeholder="Search icons — campfire, pizza, bus…"
            autoComplete="off"
          />

          {results.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-ink-500">
              Nothing matches “{query.trim()}”. Try what the thing is rather than what it is
              called — “fire”, “food”, “trip”.
            </p>
          ) : (
            <ul className="scroll-touch grid max-h-56 grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1 overflow-y-auto">
              {results.map((icon) => {
                const active = icon.name === value;
                return (
                  <li key={icon.name}>
                    <button
                      type="button"
                      onClick={() => choose(active ? null : icon.name)}
                      aria-pressed={active}
                      title={icon.label}
                      className={cn(
                        // No focus ring here, and no `focus:outline-none`: a
                        // `ring` is a box-shadow painted outside the button, and
                        // this grid is the inside of a `max-h-56 overflow-y-auto`
                        // box — so the top and bottom rows of icons had theirs
                        // cut in half. The app's own ring is drawn inward and
                        // survives the scroller.
                        'flex aspect-square w-full items-center justify-center rounded-lg',
                        active
                          ? 'bg-brand-500/20 text-brand-300 ring-1 ring-brand-500/40'
                          : 'text-ink-300 active:bg-ink-800 pointer-fine:hover:bg-ink-900',
                      )}
                    >
                      <svg viewBox="0 -960 960 960" fill="currentColor" className="size-6">
                        <path d={icon.path} />
                      </svg>
                      <span className="sr-only">{icon.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {value ? (
            <button
              type="button"
              onClick={() => choose(null)}
              className="min-h-11 rounded-lg text-xs font-semibold text-ink-400 active:bg-ink-900 pointer-fine:min-h-8"
            >
              Remove icon
            </button>
          ) : null}
        </div>
      ) : null}

      {hint ? <p className="text-xs leading-snug text-ink-500">{hint}</p> : null}
    </div>
  );
}
