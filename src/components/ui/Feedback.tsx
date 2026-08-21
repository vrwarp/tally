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

/**
 * `details` is the slot for whatever the sentence cannot say.
 *
 * Deliberately a node rather than a string: what belongs under "Could not reach
 * Planning Center" is a request and a response somebody can copy, and that is
 * the caller's shape to build, not this component's to know about.
 *
 * `action` is the way out, for the failures that have one. It sits inside the
 * alert rather than beside it, so that the control and the sentence explaining
 * it are one thing to a screen reader; and it renders nothing at all when a
 * caller passes none, so a banner without one is the element it always was.
 */
export function ErrorBanner({
  message,
  details,
  action,
  className,
}: {
  message: string;
  details?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl bg-danger-500/10 px-4 py-3 text-sm text-danger-400 ring-1 ring-danger-500/30',
        className,
      )}
    >
      {message}
      {details}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * Skeleton row used while the first roster snapshot is in flight.
 *
 * The pulsing boxes are `aria-hidden` and always were — there is nothing in a
 * grey rectangle to read out. What was missing is anything in their place: at
 * every one of the many call sites but one, somebody who cannot see the screen
 * got silence and then a list, with no way to tell a slow read from an empty
 * result. The two longest waits in the app — the student directory on a cold
 * Planning Center read, and the check-in roster's prediction — are exactly the
 * two where that silence lasts.
 *
 * So the announcement lives here rather than at the call sites, and every
 * caller gets it by existing. `label` is the sentence: a caller with a better
 * one passes it ("Loading the roster"), and a caller that already announces for
 * itself passes `label={null}` so the two do not speak over each other.
 *
 * The rows carry `aria-hidden` individually now rather than as a block, because
 * the wrapper has to stay in the accessibility tree for the status beside them
 * to be in it. `sr-only` is absolutely positioned, so it takes no part in the
 * flex column and moves nothing.
 */
export function SkeletonRows({
  count = 6,
  label = 'Loading',
}: {
  count?: number;
  label?: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {label ? (
        <span role="status" className="sr-only">
          {label}
        </span>
      ) : null}
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-16 animate-pulse rounded-xl bg-ink-800/60"
        />
      ))}
    </div>
  );
}
