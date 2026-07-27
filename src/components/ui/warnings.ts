import type { RosterWarning } from '@/types';

export interface WarningMeta {
  /** Full sentence for screen readers and tooltips. */
  label: string;
  /** Two-to-seven characters, for a badge on a roster row. */
  short: string;
}

/**
 * Every warning is advisory, so they all read the same yellow.
 *
 * There is deliberately no red tier. Tally does not gate a check-in on
 * paperwork — a counselor at the door decides who is present, and a badge that
 * looked like a stop sign would be claiming an authority the app does not have.
 */
export const WARNING_META: Record<RosterWarning, WarningMeta> = {
  'incomplete-profile': { label: 'Missing parent contact', short: 'Info' },
  allergy: { label: 'Has allergies on file', short: 'Allergy' },
};

export function warningLabel(warning: RosterWarning): string {
  return WARNING_META[warning].label;
}
