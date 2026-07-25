import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { RosterWarning } from '@/types';

type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-800 text-ink-300 ring-ink-700',
  brand: 'bg-brand-500/15 text-brand-300 ring-brand-500/30',
  success: 'bg-present-500/15 text-present-400 ring-present-500/30',
  warn: 'bg-warn-500/15 text-warn-400 ring-warn-500/30',
  danger: 'bg-danger-500/15 text-danger-400 ring-danger-500/30',
};

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = 'neutral', children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const WARNING_META: Record<RosterWarning, { label: string; short: string; tone: Tone }> = {
  'missing-waiver': { label: 'Missing waiver', short: 'Waiver', tone: 'danger' },
  'missing-payment': { label: 'Payment due', short: 'Payment', tone: 'danger' },
  'incomplete-profile': { label: 'Missing parent contact', short: 'Info', tone: 'warn' },
  allergy: { label: 'Has allergies on file', short: 'Allergy', tone: 'warn' },
};

/** Renders a roster warning as its badge. Blocking issues read red, not yellow. */
export function WarningBadge({ warning }: { warning: RosterWarning }) {
  const meta = WARNING_META[warning];
  return (
    <Badge tone={meta.tone} title={meta.label}>
      <span aria-hidden="true">{meta.tone === 'danger' ? '⛔' : '⚠'}</span>
      <span className="sr-only">{meta.label}</span>
      <span aria-hidden="true">{meta.short}</span>
    </Badge>
  );
}

export function warningLabel(warning: RosterWarning): string {
  return WARNING_META[warning].label;
}
