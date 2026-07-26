import { useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn, haptic } from '@/lib/utils';

/*
 * Two sizes, chosen by pointer rather than by viewport.
 *
 * `py-3` on a 16px line box is a 48px control — a thumb target, and correct on
 * the phone this app is mostly used on. The same 48px on a desktop form of a
 * dozen fields is ~1200px of column in a 900px window, which is how the event
 * editor ended up scrolling a form that would otherwise fit on one screen.
 *
 * `pointer: fine` is the honest signal for "this is being driven by a mouse",
 * and it is not the same question as "is this window wide". A tablet in a
 * keyboard case reports coarse and keeps the big targets; a small laptop window
 * reports fine and gets the tight ones. See also the font-size rule in
 * `index.css`, which is what actually shrinks the line box underneath this.
 */
const CONTROL =
  'w-full rounded-xl bg-ink-900 px-3 py-3 text-ink-100 ring-1 ring-ink-700 ' +
  'placeholder:text-ink-500 focus:ring-2 focus:ring-brand-400 focus:outline-none ' +
  'disabled:opacity-50 pointer-fine:rounded-lg pointer-fine:px-2.5 pointer-fine:py-2';

/*
 * Room for an adornment, stated at both sizes.
 *
 * `CONTROL` narrows its padding under `pointer: fine`, and that variant is
 * emitted after the plain `pl-9`/`pr-9` below it in the stylesheet — so a bare
 * `pl-9` was silently reset to 10px on a mouse, and the search icon printed
 * itself over the placeholder. Anything that reserves a gutter has to reserve
 * it in the same two sizes the control is drawn in.
 */
const ICON_GUTTER_LEFT = 'pl-9 pointer-fine:pl-8';
const ICON_GUTTER_RIGHT = 'pr-9 pointer-fine:pr-8';
const ICON_INSET_LEFT = 'left-3 pointer-fine:left-2.5';
const ICON_INSET_RIGHT = 'right-3 pointer-fine:right-2.5';

/* The clear button is a tap target rather than a glyph, so it needs more room
   than the chevron does. */
const CLEAR_GUTTER_RIGHT = 'pr-12 pointer-fine:pr-10';

interface FieldShellProps {
  label: string;
  labelHidden?: boolean;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}

function FieldShell({ label, labelHidden, hint, error, required, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 pointer-fine:gap-1">
      {/* `sr-only` is absolutely positioned, so a hidden label is not a flex
          item and leaves no gap of its own above the control. */}
      <label
        htmlFor={id}
        className={cn(
          'text-sm font-medium text-ink-300 pointer-fine:text-xs',
          labelHidden && 'sr-only',
        )}
      >
        {label}
        {required ? <span className="ml-1 text-danger-400">*</span> : null}
      </label>
      {children({ id, describedBy })}
      {hint && !error ? (
        <p id={hintId} className="text-xs leading-snug text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs leading-snug text-danger-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /**
   * Keep the label for screen readers but not on screen. For a field whose
   * purpose is already obvious from its position — the search box pinned above
   * the check-in roster — a printed "Search" is a line of chrome between the
   * volunteer and the list. The `<label>` stays in the DOM either way, so the
   * control keeps a real accessible name and a bigger hit area than an
   * `aria-label` alone would give it.
   */
  labelHidden?: boolean;
  hint?: string;
  error?: string | null;
  /**
   * Show a clear button, and clear on Escape, while the field has a value.
   * Reads `value`, so it only does anything on a controlled field.
   */
  onClear?: () => void;
}

export function TextField({
  label,
  labelHidden,
  hint,
  error,
  className,
  required,
  onClear,
  onKeyDown,
  ...rest
}: TextFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // A search box and a dropdown rendered as identical rounded rectangles are
  // genuinely ambiguous: people tap the filter expecting a keyboard. The icon
  // is what tells them which one they are about to touch.
  const isSearch = rest.type === 'search';
  const clearable = onClear !== undefined && String(rest.value ?? '').length > 0;

  const clear = () => {
    onClear?.();
    // Keep the keyboard up: clearing is usually a prelude to retyping.
    inputRef.current?.focus();
  };

  return (
    <FieldShell
      label={label}
      labelHidden={labelHidden}
      hint={hint}
      error={error}
      required={required}
    >
      {({ id, describedBy }) => (
        <span className="relative block">
          {isSearch ? (
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0 flex items-center text-ink-500',
                ICON_INSET_LEFT,
              )}
            >
              <svg viewBox="0 0 20 20" fill="none" className="size-4">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" />
                <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
          ) : null}
          <input
            ref={inputRef}
            id={id}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            required={required}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (clearable && !event.defaultPrevented && event.key === 'Escape') {
                event.preventDefault();
                clear();
              }
            }}
            className={cn(
              CONTROL,
              isSearch && ICON_GUTTER_LEFT,
              // Reserved whether or not the button is showing, so the text does
              // not reflow out from under the cursor on the first keystroke.
              onClear && CLEAR_GUTTER_RIGHT,
              // WebKit draws its own ✕ for `type="search"`. Ours is the one
              // sized for a thumb; two of them side by side is just confusing.
              onClear && '[&::-webkit-search-cancel-button]:appearance-none',
              error && 'ring-danger-500',
              className,
            )}
            {...rest}
          />
          {clearable ? (
            <button
              type="button"
              aria-label={isSearch ? 'Clear search' : `Clear ${label.toLowerCase()}`}
              onClick={clear}
              className={
                'absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center ' +
                'justify-center rounded-full text-xl leading-none text-ink-400 ' +
                'active:bg-ink-800 pointer-fine:size-8 pointer-fine:text-base ' +
                'pointer-fine:hover:bg-ink-800'
              }
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </span>
      )}
    </FieldShell>
  );
}

export interface NumberStepperFieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  value: number;
  /** Inclusive bounds for the buttons. Typing is not clamped — see below. */
  min?: number;
  max?: number;
  disabled?: boolean;
  onValueChange: (value: number) => void;
}

/**
 * A small integer, adjusted by thumb rather than by keyboard.
 *
 * Every number in Tally's settings is a single digit or two — "2 of the last 3",
 * "MIA after 3 misses". Raising a numeric keypad over the whole screen to change
 * a 2 into a 3 costs more than the edit is worth, and on iOS it scrolls the very
 * sentence explaining what the number means out of view. The buttons are the
 * fast path; the input stays a real `<input type="number">` so a pointer user
 * can still select it and type, and so screen readers announce it as a spin
 * button rather than as three unrelated controls.
 *
 * Typing is deliberately *not* clamped. Clamping as you type turns a half-typed
 * "1" (on the way to "12") into a silent correction, and it would also suppress
 * the cross-field errors — "cannot ask for more gatherings than the window
 * holds" — that are the whole reason those errors exist.
 */
export function NumberStepperField({
  label,
  hint,
  error,
  value,
  min = 1,
  max = 99,
  disabled,
  onValueChange,
}: NumberStepperFieldProps) {
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, (Number.isFinite(value) ? value : min) + delta));
    // Nothing changed: the value is already at the end of its range. A buzz here
    // would report success for a press that did nothing.
    if (next === value) return;
    haptic(8);
    onValueChange(next);
  };

  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <div
          className={cn(
            'flex items-stretch overflow-hidden rounded-xl bg-ink-900 ring-1 ring-ink-700',
            'focus-within:ring-2 focus-within:ring-brand-400',
            error && 'ring-danger-500',
            disabled && 'opacity-50',
          )}
        >
          <StepButton
            label={`Decrease ${label}`}
            glyph="−"
            disabled={disabled || value <= min}
            onClick={() => step(-1)}
          />
          <input
            id={id}
            type="number"
            inputMode="numeric"
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            min={min}
            max={max}
            value={value}
            disabled={disabled}
            onChange={(changed) => {
              const next = Number(changed.target.value);
              onValueChange(Number.isFinite(next) ? next : 0);
            }}
            className={
              'w-full min-w-0 border-x border-ink-800 bg-transparent py-3 text-center text-lg ' +
              'font-semibold tabular-nums text-ink-100 focus:outline-none pointer-fine:py-1.5 ' +
              // The native spinners are a third way to change the value, at a
              // size no thumb can hit. The buttons replace them.
              '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ' +
              '[&::-webkit-outer-spin-button]:appearance-none'
            }
          />
          <StepButton
            label={`Increase ${label}`}
            glyph="+"
            disabled={disabled || value >= max}
            onClick={() => step(1)}
          />
        </div>
      )}
    </FieldShell>
  );
}

function StepButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        'flex min-h-12 w-12 shrink-0 items-center justify-center text-xl leading-none ' +
        'text-ink-300 select-none hover:bg-ink-800 active:bg-ink-700 ' +
        'disabled:pointer-events-none disabled:text-ink-600 ' +
        'pointer-fine:min-h-9 pointer-fine:w-9 pointer-fine:text-base'
      }
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function SelectField({ label, hint, error, className, required, children, ...rest }: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <span className="relative block">
          <select
            id={id}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            required={required}
            className={cn(CONTROL, 'appearance-none', ICON_GUTTER_RIGHT, error && 'ring-danger-500', className)}
            {...rest}
          >
            {children}
          </select>
          {/* `appearance-none` removes the platform arrow, so a dropdown would
              otherwise be indistinguishable from a text box. */}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 flex items-center text-ink-400',
              ICON_INSET_RIGHT,
            )}
          >
            <svg viewBox="0 0 20 20" fill="none" className="size-4">
              <path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      )}
    </FieldShell>
  );
}

export interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextAreaField({ label, hint, error, className, required, ...rest }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          required={required}
          rows={3}
          className={cn(CONTROL, error && 'ring-danger-500', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
}

export function CheckboxField({ label, hint, className, ...rest }: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className={cn('mt-0.5 size-5 shrink-0 rounded border-ink-600 bg-ink-900 accent-brand-500', className)}
        {...rest}
      />
      <label htmlFor={id} className="text-sm text-ink-200">
        {label}
        {hint ? <span className="block text-xs text-ink-500">{hint}</span> : null}
      </label>
    </div>
  );
}
