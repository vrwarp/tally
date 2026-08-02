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
import type { RefObject } from 'react';
import { TextField } from '@/components/ui/Field';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Opens quick-add. Rendered beside the field — see the note below. */
  onQuickAdd?: () => void;
  /**
   * A handle on the input, so the screen can put the caret here when it has
   * just asked a question this field answers — picking the right person for a
   * check-in filed against the wrong one.
   */
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search students…',
  onQuickAdd,
  inputRef,
}: SearchBarProps) {
  /*
    Quick-add lives in the search band rather than floating over the list.

    It used to be a 56px disc fixed 80px off the bottom, which put it
    permanently on top of the right-hand edge of two roster rows — and the point
    a right thumb lands on was the seam between them. Every row is a button that
    checks a student in, so a tap that missed by 8px either checked in the next
    student, undid the last one, or threw a full-screen visitor form over the
    queue. The third is the dangerous one: the counselor sees something happen,
    dismisses it, moves on, and that student is not checked in. Padding the end
    of the list would only have protected the end of the list — nothing fixed
    inside the scroll plane is safe at every scroll position.

    It sits at the *leading* edge, not the trailing one. Put beside the field it
    landed 9px from the field's own clear button, which is two different
    consequences adjacent in the least accurate corner of the screen: a
    counselor reaching up to clear a query and missing right got the visitor
    form. Here its neighbour is the field itself, where a miss costs a focus
    ring. The cost is reach, and that is the right way round — the rare action
    takes the worse corner and the constant one keeps the better.
  */
  const quickAdd = onQuickAdd ? (
    <button
      type="button"
      onClick={onQuickAdd}
      aria-label="Quick add a visitor"
      className={
        'flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 ' +
        'text-2xl leading-none font-semibold text-brand-300 ring-1 ring-brand-500/30 ' +
        'hover:bg-brand-500/20 active:bg-brand-500/20 pointer-fine:size-9 pointer-fine:text-xl'
      }
    >
      <span aria-hidden="true">+</span>
    </button>
  ) : null;

  return (
    <div className="flex items-end gap-3 pb-2 pointer-fine:gap-2">
      {quickAdd}
      <div className="min-w-0 flex-1">
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
          inputRef={inputRef}
          onChange={(event) => onChange(event.target.value)}
          onClear={() => onChange('')}
        />
      </div>

    </div>
  );
}
