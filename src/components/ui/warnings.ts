import type { RosterWarning } from '@/types';

export type WarningTone = 'warn' | 'danger';

export interface WarningMeta {
  /** Full sentence for screen readers and tooltips. */
  label: string;
  /** Two-to-seven characters, for a badge on a roster row. */
  short: string;
  tone: WarningTone;
}

/**
 * Blocking issues read red, advisory ones yellow.
 *
 * The distinction is the whole point of Journey 4: a counselor scanning a queue
 * has to be able to tell "stop this student before the bus" from "worth knowing"
 * without reading either label.
 */
export const WARNING_META: Record<RosterWarning, WarningMeta> = {
  'missing-waiver': { label: 'Missing waiver', short: 'Waiver', tone: 'danger' },
  'missing-payment': { label: 'Payment due', short: 'Payment', tone: 'danger' },
  'incomplete-profile': { label: 'Missing parent contact', short: 'Info', tone: 'warn' },
  allergy: { label: 'Has allergies on file', short: 'Allergy', tone: 'warn' },
};

export function warningLabel(warning: RosterWarning): string {
  return WARNING_META[warning].label;
}
