import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Sheets slide up from the bottom — the reachable half of a phone screen. */
  variant?: 'sheet' | 'centered';
}

/**
 * A focus-trapping dialog built on `<dialog>`.
 *
 * Journey 3 hangs on this being instant: the quick-add modal must open, accept
 * three fields and close without the counselor losing their place in the queue.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'sheet',
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      // Put the caret in the first field so a counselor can start typing
      // immediately instead of aiming at a text box.
      const firstField = dialog.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select, textarea',
      );
      firstField?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      className={cn(
        'backdrop:bg-black/70 bg-transparent p-0 text-ink-100 open:flex',
        variant === 'sheet'
          ? 'm-0 max-h-full h-full w-full max-w-full items-end justify-center'
          : 'm-auto max-h-[90dvh] w-[min(32rem,92vw)] items-center',
      )}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself) dismisses.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div
        className={cn(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden bg-ink-900 ring-1 ring-ink-700',
          variant === 'sheet' ? 'rounded-t-2xl' : 'rounded-2xl',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-50">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-ink-400">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 rounded-lg px-2 py-1 text-2xl leading-none text-ink-400 hover:text-ink-100"
          >
            ×
          </button>
        </header>

        <div className="scroll-touch flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="border-t border-ink-800 px-5 py-4 pb-safe">{footer}</footer>
        ) : null}
      </div>
    </dialog>
  );
}
