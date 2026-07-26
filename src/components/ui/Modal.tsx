import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * How wide the panel is allowed to get once it stops being a sheet. Phones
 * ignore it entirely — a sheet is full-bleed by definition.
 */
export type ModalSize = 'sm' | 'md' | 'lg';

const SIZES: Record<ModalSize, string> = {
  /** Three fields and a verb. */
  sm: 'sm:max-w-[26rem]',
  /** The default: one column of form. */
  md: 'sm:max-w-[34rem]',
  /** Wide enough for two columns of sections side by side. */
  lg: 'sm:max-w-[62rem]',
};

/**
 * Cancel on the left, the primary on the right — but only once there is a
 * pointer. On a phone the two buttons split the width with the primary taking
 * the larger share, because they are thumb targets and the bar is the only
 * place to aim. On a desktop that same bar is a 900px-wide Cancel button, so
 * the actions shrink to their natural width and sit where a pointer user looks
 * for them.
 */
const ACTIONS =
  'flex items-center gap-2 [&>*]:flex-1 [&>*:last-child]:flex-[2] ' +
  'sm:justify-end sm:[&>*]:flex-none sm:[&>*:last-child]:flex-none sm:[&>*]:min-w-28';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Buttons, unwrapped. The footer lays them out — see `ACTIONS`. */
  footer?: ReactNode;
  size?: ModalSize;
}

/**
 * A focus-trapping dialog built on `<dialog>`.
 *
 * Journey 3 hangs on this being instant: the quick-add modal must open, accept
 * three fields and close without the counselor losing their place in the queue.
 *
 * ## Sheet below `sm`, window above it
 *
 * A bottom sheet is a phone control. It is anchored to the reachable half of
 * the screen and it is full-bleed because the screen is 390px wide and there is
 * nothing else to show. Rendered on a 27-inch monitor every one of those
 * properties turns into a defect: the panel spans two thousand pixels, a
 * datetime field that wants 180px gets 1900, and the save button ends up a
 * mouse-journey away from the field that was just filled in.
 *
 * So the two shapes are genuinely different, and the breakpoint — not a prop —
 * decides which one you get. `sm` (640px) is the line: below it we are on a
 * phone, above it there is room to centre a window, whether or not the person
 * is touching it.
 *
 * Density is a *separate* axis and keys off `pointer: fine` rather than width —
 * see `Field.tsx`. A tablet in a keyboard case is wide and still touched.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = `${headingId}-description`;

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

    /*
     * ⌘/Ctrl+Enter saves from anywhere in the dialog.
     *
     * Plain Enter already submits from a text input, but not from the notes
     * textarea and not from a native date picker — which on desktop is where
     * the caret usually is when somebody decides they are done. Rather than
     * teach every form the shortcut, the dialog submits whatever form it
     * contains.
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      const form = dialog.querySelector('form');
      if (!form) return;
      event.preventDefault();
      form.requestSubmit();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        'm-0 h-full max-h-full w-full max-w-full bg-transparent p-0 text-ink-100',
        'backdrop:bg-black/70 open:flex items-end justify-center',
        // Above `sm` the panel is a window: centred, inset from the viewport
        // edge so the backdrop reads as a layer behind it rather than a seam.
        'sm:items-center sm:p-6',
      )}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself) dismisses.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div
        className={cn(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden bg-ink-900 ring-1 ring-ink-700',
          'rounded-t-2xl animate-sheet-in',
          'sm:max-h-full sm:rounded-2xl sm:shadow-2xl sm:shadow-black/50 sm:animate-dialog-in',
          SIZES[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4 pointer-fine:py-3">
          <div>
            <h2 id={headingId} className="text-lg font-semibold text-ink-50 pointer-fine:text-base">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-sm leading-snug text-ink-400">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={
              '-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-lg ' +
              'text-2xl leading-none text-ink-400 hover:bg-ink-800 hover:text-ink-100 ' +
              'pointer-fine:size-8 pointer-fine:text-xl'
            }
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {/* `scroll-shadow` is the only thing that says "there is more below" on
            a desktop with overlay scrollbars — where a form clipped mid-field
            otherwise looks like a form that simply ends there. */}
        <div className="scroll-touch scroll-shadow flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className={cn('border-t border-ink-800 px-5 py-4 pb-safe sm:py-3', ACTIONS)}>
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
