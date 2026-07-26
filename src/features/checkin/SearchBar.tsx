/**
 * The always-present roster search.
 *
 * No debounce on purpose: the whole student list is already in memory from the
 * shared snapshot, so filtering is a synchronous array pass. Journey 1 promises
 * "types two letters, the list filters instantly" — a timer would only add lag.
 *
 * The control itself is `TextField`. This used to be a hand-rolled input with
 * its own rounded rectangle, and it drifted: it kept a 48px thumb target on a
 * desktop that had shrunk every other field, and it never picked up the icon
 * the shared search fields draw.
 */
import { TextField } from '@/components/ui/Field';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search students…' }: SearchBarProps) {
  return (
    <div className="px-3 pb-2">
      <TextField
        label="Search students by name"
        labelHidden
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onClear={() => onChange('')}
      />
    </div>
  );
}
