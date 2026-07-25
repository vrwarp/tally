import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ToastContext, type Toast, type ToastContextValue } from '@/context/toastContext';

const DEFAULT_DURATION_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

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
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pb-safe"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ring-1',
              toast.tone === 'success' && 'bg-present-600 text-white ring-present-400/40',
              toast.tone === 'error' && 'bg-danger-600 text-white ring-danger-400/40',
              toast.tone === 'info' && 'bg-ink-800 text-ink-100 ring-ink-600',
            )}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                className="shrink-0 rounded-lg bg-black/25 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
                onClick={() => {
                  toast.action?.onPress();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss"
              className="shrink-0 text-lg leading-none opacity-70"
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
