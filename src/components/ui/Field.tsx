import {
  useId,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn, formatPhoneInput, haptic } from '@/lib/utils';

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
  /**
   * A second handle on the input, for a field that has to drive the caret —
   * `MaskedField` below is the one that does. The clear button keeps its own
   * handle either way, so this cannot take the keyboard focus away from it.
   */
  inputRef?: RefObject<HTMLInputElement | null>;
  /**
   * The rest of the shape this field is being typed into, drawn faded after
   * whatever has been typed so far — `MM / DD / YYYY` on an empty birthday box,
   * ` / YYYY` once the day is in.
   *
   * A placeholder cannot do this: it is all or nothing, and it disappears on the
   * first keystroke, which is the moment the shape starts being useful. So it is
   * a second layer over the input, holding an invisible copy of the value to
   * push itself along by exactly the width of what is already there. Everything
   * about it that matters is the alignment — same font size, same padding, same
   * tabular digits — because a pixel out is a wobble on every keystroke.
   */
  ghost?: string;
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
  inputRef: externalRef,
  ghost,
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
            ref={(node) => {
              inputRef.current = node;
              if (externalRef) externalRef.current = node;
            }}
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
          {ghost ? (
            <span
              aria-hidden="true"
              className={cn(
                // `whitespace-pre` because the separators are spaces, and the
                // font sizes restate `index.css`'s rule for form controls — a
                // span does not inherit it.
                'pointer-events-none absolute inset-0 flex items-center whitespace-pre',
                'text-[16px] tabular-nums pointer-fine:text-[14px]',
                'px-3 py-3 pointer-fine:px-2.5 pointer-fine:py-2',
              )}
            >
              <span className="invisible">{String(rest.value ?? '')}</span>
              <span className="text-ink-600">{ghost}</span>
            </span>
          ) : null}
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

export interface MaskedFieldProps
  extends Omit<TextFieldProps, 'value' | 'onChange' | 'inputRef'> {
  value: string;
  /** Called with the already-formatted value — never with what was typed. */
  onValueChange: (value: string) => void;
  /** Whatever is in the box, in the one shape this field holds it in. */
  format: (raw: string) => string;
}

/**
 * A field that re-punctuates itself while somebody types into it — a phone
 * number as `XXX-XXX-XXXX`, a birthday as `MM / DD / YYYY`.
 *
 * Formatting as it is typed rather than on blur or on save is the point: both
 * of those values are read back off a screen by somebody about to use them, and
 * a box that accepted `5105550142` unbroken was the one place a leader had to
 * count digits.
 *
 * The rest of this is caret work, and it exists because reformatting a
 * controlled input on every keystroke otherwise throws the cursor to the end of
 * the value: editing the area code of a number already typed would move the
 * caret past the last digit on the first keystroke. So each edit records which
 * digit the caret was sitting after, and puts it back after that same digit once
 * the new value has rendered. Digits are the anchor because they are the only
 * part a person typed; the separators belong to the format and move around.
 */
export function MaskedField({
  value,
  onValueChange,
  format,
  onKeyDown,
  ...rest
}: MaskedFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  const applyCaret = () => {
    const node = inputRef.current;
    if (!node || caret.current === null) return;
    node.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  };

  useLayoutEffect(applyCaret);

  /** Re-format, then aim the caret at the far side of the same digit. */
  const commit = (next: string, digitsBefore: number) => {
    const formatted = format(next);
    caret.current = caretAfterDigits(formatted, digitsBefore);
    onValueChange(formatted);
    // Nothing changed — a letter, or an eleventh digit — so no render is coming
    // to run the layout effect. React restores the input's own value at the end
    // of this event; the microtask lands after that.
    if (formatted === value) queueMicrotask(applyCaret);
  };

  return (
    <TextField
      {...rest}
      inputRef={inputRef}
      value={value}
      onChange={(event) => {
        const node = event.target;
        const pos = node.selectionStart ?? node.value.length;
        commit(node.value, digitCount(node.value.slice(0, pos)));
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;

        const { selectionStart: start, selectionEnd: end } = event.currentTarget;
        if (start === null || start !== end) return;

        /*
         * A separator is ours, not something anybody typed, so a delete key
         * aimed at one has to reach past it for the nearest digit. Left alone,
         * the formatter would put the separator straight back and the key would
         * appear dead — and a birthday's separators are three characters wide,
         * so "the character behind it" is not good enough either.
         */
        if (event.key === 'Backspace' && !isDigit(value[start - 1])) {
          const at = lastDigitBefore(value, start);
          if (at === null) return;
          event.preventDefault();
          commit(value.slice(0, at) + value.slice(at + 1), digitCount(value.slice(0, at)));
        } else if (event.key === 'Delete' && !isDigit(value[start])) {
          const at = firstDigitFrom(value, start);
          if (at === null) return;
          event.preventDefault();
          commit(value.slice(0, at) + value.slice(at + 1), digitCount(value.slice(0, at)));
        }
      }}
    />
  );
}

export interface PhoneFieldProps
  extends Omit<TextFieldProps, 'value' | 'onChange' | 'type' | 'inputMode' | 'inputRef'> {
  value: string;
  /** Called with the already-formatted value — never with what was typed. */
  onValueChange: (value: string) => void;
}

/** A phone number, grouped as `XXX-XXX-XXXX` while it is typed. */
export function PhoneField({ className, ...rest }: PhoneFieldProps) {
  return (
    <MaskedField
      {...rest}
      format={formatPhoneInput}
      type="tel"
      inputMode="tel"
      // 12 characters is a full `XXX-XXX-XXXX`. The formatter already refuses to
      // return more; this stops the browser accepting a longer paste first.
      maxLength={12}
      className={cn('tabular-nums', className)}
    />
  );
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function digitCount(text: string): number {
  return text.replace(/\D/g, '').length;
}

/** The digit a backspace at `from` should take, however many separators away. */
function lastDigitBefore(text: string, from: number): number | null {
  for (let i = from - 1; i >= 0; i -= 1) if (isDigit(text[i])) return i;
  return null;
}

function firstDigitFrom(text: string, from: number): number | null {
  for (let i = from; i < text.length; i += 1) if (isDigit(text[i])) return i;
  return null;
}

/**
 * The offset just past the `count`-th digit of `text`.
 *
 * With one exception, which is the whole reason a birthday box works: when
 * nothing but separators follows that digit, the caret goes to the end instead.
 * A format that puts a separator on *after* the last digit — `12 / 14 / ` — would
 * otherwise park the caret in front of it on every keystroke, and the next
 * character typed would land inside the value rather than after it. Anywhere
 * there are still digits ahead, the caret stays where it was aimed, so editing
 * the middle of a phone number is untouched.
 */
function caretAfterDigits(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (isDigit(text[i]) && ++seen === count) {
      return digitCount(text.slice(i + 1)) === 0 ? text.length : i + 1;
    }
  }
  return text.length;
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
            side="left"
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
            side="right"
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
  side,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  /**
   * Which end of the stepper this is.
   *
   * It buys the button the shell's own corner radius, which it needs because
   * it sits flush in the end of a `rounded-xl overflow-hidden` box: a focus
   * ring traces the *button's* radius, and a square one has its corners cut
   * off by the shell's curve.
   */
  side: 'left' | 'right';
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
        'pointer-fine:min-h-9 pointer-fine:w-9 pointer-fine:text-base ' +
        (side === 'left' ? 'rounded-l-xl' : 'rounded-r-xl')
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
        /*
         * Drawn, not delegated.
         *
         * `border-ink-600 bg-ink-900 accent-brand-500` were three classes that
         * never reached the pixel: a native checkbox is painted by the user
         * agent, so what shipped was Chrome's own control — a warm grey slab
         * off Tally's ramp, reading as *filled* where it means empty, and with
         * no answer at all for the light theme, since the ramp flips and the
         * widget does not. `appearance-none` is what makes the box ours: an
         * ink-950 recess with a ramp-coloured edge, and the same brand fill it
         * already had when checked.
         */
        className={cn(
          'mt-0.5 size-5 shrink-0 appearance-none rounded bg-ink-950 ring-1 ring-inset ring-ink-600',
          'checked:bg-brand-500 checked:ring-brand-500',
          // The tick itself is one rule in `index.css` — an arbitrary `bg-[url(…)]`
          // holding an inline SVG does not survive Tailwind's value parser.
          'ui-check',
          className,
        )}
        {...rest}
      />
      <label htmlFor={id} className="text-sm text-ink-200">
        {label}
        {hint ? <span className="block text-xs text-ink-500">{hint}</span> : null}
      </label>
    </div>
  );
}
