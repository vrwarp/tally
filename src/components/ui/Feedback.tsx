import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block size-5 animate-spin rounded-full border-2 border-ink-600 border-t-brand-400',
        className,
      )}
    />
  );
}

export function LoadingScreen({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-ink-400">
      <Spinner className="size-8" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      {icon ? <div className="text-3xl opacity-60">{icon}</div> : null}
      <p className="font-medium text-ink-200">{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl bg-danger-500/10 px-4 py-3 text-sm text-danger-400 ring-1 ring-danger-500/30',
        className,
      )}
    >
      {message}
    </div>
  );
}

/** Skeleton row used while the first roster snapshot is in flight. */
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-xl bg-ink-800/60" />
      ))}
    </div>
  );
}
