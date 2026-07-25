import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  /** Optional single action, e.g. "Undo" on a check-in. */
  action?: { label: string; onPress: () => void };
}

export interface ToastContextValue {
  toasts: Toast[];
  show: (message: string, options?: { tone?: ToastTone; action?: Toast['action']; durationMs?: number }) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>.');
  return value;
}
