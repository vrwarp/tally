import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ToastContext, type Toast, type ToastContextValue } from '@/context/toastContext';

/** How long a toast stays up when the caller says nothing. */
export const DEFAULT_DURATION_MS = 4000;

/**
 * For a confirmation the screen has already made another way.
 *
 * A check-in recolours the row it happened on, so the toast that follows is a
 * second copy of an answer already on screen — and on a phone it is a second
 * copy sitting in the thumb zone, over the next name in the queue. Callers in
 * that position pass this as `durationMs` so the echo clears while the queue is
 * still moving. Nothing opts in by default: `show` without a duration behaves
 * exactly as it always has.
 */
export const SHORT_DURATION_MS = 1800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    // Stryker disable next-line ConditionalExpression: `clearTimeout(undefined)`
    // does nothing and deleting a key that is not there does nothing, so the
    // guard changes no outcome. It says the map is expected to have gaps.
    if (timer) {
      clearTimeout(timer);
      // Stryker disable next-line CallExpression: nothing reads this map except
      // the two lines around it and the unmount sweep, and a stale entry there
      // only re-clears a timer that is already gone. It is here so a lobby
      // screen's map does not grow by one per check-in for the evening.
      timers.current.delete(id);
    }
  },
  // Stryker disable next-line ArrayDeclaration: any constant array is the same
  // array to React — the list is compared element by element against the last
  // render's, and a literal that never changes never differs from itself.
  []);

  const show = useCallback<ToastContextValue['show']>(
    (message, options = {}) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      const toast: Toast = { id, message, tone: options.tone ?? 'info' };
      if (options.action) toast.action = options.action;

      setToasts((current) => [...current.slice(-2), toast]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), options.durationMs ?? DEFAULT_DURATION_MS),
      );
      return id;
    },
    // Stryker disable next-line ArrayDeclaration: `dismiss` is a `useCallback`
    // over no state, so its identity never changes and an empty list would
    // behave the same. Naming it keeps that from being an accident.
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      // Stryker disable next-line CallExpression: the provider is going away
      // and the map with it, so nothing can observe this. It is here because a
      // map of dead handles is not a thing to hand to a garbage collector and
      // hope about.
      pending.clear();
    };
  },
  // Stryker disable next-line ArrayDeclaration: any constant array is the same
  // array to React — the list is compared element by element against the last
  // render's, and a literal that never changes never differs from itself.
  []);

  const value = useMemo<ToastContextValue>(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
       * Where the stack stands.
       *
       * On a phone it stays where it was — bottom-centre, above the safe area —
       * because there is no gutter to move it into and the bottom of the screen
       * is where a thumb can reach it. Above `lg` there is: the content column
       * is centred with a few hundred pixels of nothing either side, so the
       * stack moves into the right one instead of lying across the last roster
       * row. `lg:bottom-3` rather than `lg:pb-6` because `.pb-safe` is a
       * hand-written utility that is emitted after Tailwind's own — a
       * `lg:pb-*` would lose to it and never apply.
       */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pb-safe lg:bottom-3 lg:items-end lg:pr-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          /*
           * The panel is not a target and must not behave like one.
           *
           * It is fixed over the bottom of the check-in screen, which is where
           * the roster rows a counselor is tapping live — on a 412px phone the
           * bar covers the bottom half of the most-tapped row, and up to three
           * of them stack two rows deep. A tap on a panel that swallows it
           * produces no flash, no haptic and no write: a student who is
           * standing there is recorded absent, and the moment it is most likely
           * is straight after an undo, re-tapping the correct name. So the
           * panel passes taps through and only the two controls take them back.
           */
          <div
            key={toast.id}
            className={cn(
              'pointer-events-none flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ring-1 lg:max-w-sm',
              toast.tone === 'success' && 'bg-present-600 text-white ring-present-400/40',
              toast.tone === 'error' && 'bg-danger-600 text-white ring-danger-400/40',
              toast.tone === 'info' && 'bg-ink-800 text-ink-100 ring-ink-600',
            )}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                className="pointer-events-auto shrink-0 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
                onClick={() => {
                  // Stryker disable next-line OptionalChaining: this button is
                  // only rendered inside `toast.action ? … : null`, so the
                  // guard can never fire. TypeScript loses that narrowing
                  // across the closure and asks for it anyway.
                  toast.action?.onPress();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            {/*
             * A 44px target that costs no height.
             *
             * The glyph was an 18px box in the corner of a bar a thumb has one
             * pass at. `size-11` gives it the floor; `-my-3` cancels the bar's
             * own `py-3`, so the button's margin box is exactly the 20px line
             * it sits on and the bar is the same height it was. `-mr-3` spends
             * the extra width into the `px-4` padding instead of pushing the
             * message over, which leaves the × within a pixel of where it drew
             * before.
             */}
            <button
              type="button"
              aria-label="Dismiss"
              className="pointer-events-auto -my-3 -mr-3 grid size-11 shrink-0 place-items-center rounded-lg text-lg leading-none opacity-70 hover:opacity-100 focus-visible:opacity-100"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
