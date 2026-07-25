/**
 * The always-present roster search.
 *
 * No debounce on purpose: the whole student list is already in memory from the
 * shared snapshot, so filtering is a synchronous array pass. Journey 1 promises
 * "types two letters, the list filters instantly" — a timer would only add lag.
 */
import { useRef } from 'react';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search students…' }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="px-3 pb-2">
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg leading-none text-ink-500"
        >
          ⌕
        </span>

        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search students by name"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && value) {
              event.preventDefault();
              onChange('');
            }
          }}
          className="min-h-12 w-full rounded-xl bg-ink-900 py-3 pl-9 pr-12 text-ink-100 ring-1 ring-ink-700 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-400 [&::-webkit-search-cancel-button]:appearance-none"
        />

        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onChange('');
              // Keep the keyboard up: clearing is usually a prelude to retyping.
              inputRef.current?.focus();
            }}
            className="absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-xl leading-none text-ink-400 active:bg-ink-800"
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
