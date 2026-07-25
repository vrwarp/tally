import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const CONTROL =
  'w-full rounded-xl bg-ink-900 px-3 py-3 text-ink-100 ring-1 ring-ink-700 ' +
  'placeholder:text-ink-500 focus:ring-2 focus:ring-brand-400 focus:outline-none ' +
  'disabled:opacity-50';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}

function FieldShell({ label, hint, error, required, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-300">
        {label}
        {required ? <span className="ml-1 text-danger-400">*</span> : null}
      </label>
      {children({ id, describedBy })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-danger-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, className, required, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          required={required}
          className={cn(CONTROL, error && 'ring-danger-500', className)}
          {...rest}
        />
      )}
    </FieldShell>
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
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          required={required}
          className={cn(CONTROL, 'appearance-none', error && 'ring-danger-500', className)}
          {...rest}
        >
          {children}
        </select>
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
