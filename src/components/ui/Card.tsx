import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl bg-ink-900 ring-1 ring-ink-800', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  count,
  description,
  action,
}: {
  title: string;
  count?: number;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-ink-800 px-4 py-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-100">
          {title}
          {count !== undefined ? (
            <span className="rounded-full bg-ink-800 px-2 py-0.5 text-xs font-semibold text-ink-300">
              {count}
            </span>
          ) : null}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'warn' | 'danger' | 'success';
}) {
  return (
    <div
      className={cn(
        'rounded-2xl px-4 py-3 ring-1',
        tone === 'neutral' && 'bg-ink-900 ring-ink-800',
        tone === 'success' && 'bg-present-500/10 ring-present-500/25',
        tone === 'warn' && 'bg-warn-500/10 ring-warn-500/25',
        tone === 'danger' && 'bg-danger-500/10 ring-danger-500/25',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink-50">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
