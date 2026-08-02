import type { RosterWarning } from '@/types';

export interface WarningMeta {
  /** Full sentence for screen readers and tooltips. */
  label: string;
  /** Two-to-seven characters, for a badge on a roster row. */
  short: string;
  /**
   * Amber and a ⚠ mean one thing on a roster row: something about this student
   * has a consequence at the door. Everything else is a neutral chip.
   */
  tone: 'warn' | 'neutral';
}

/**
 * Advisory, all of them — but not equally a counselor's problem.
 *
 * There is deliberately no red tier. Tally does not gate a check-in on
 * paperwork: a counselor at the door decides who is present, and a badge that
 * looked like a stop sign would be claiming an authority the app does not have.
 *
 * Both of these used to read the same amber ⚠, distinguished by one 11px word.
 * One of them is an allergy — the only flag in this app with a physical
 * consequence — and the other means an office has not typed in a parent's phone
 * number. A counselor in a dim hallway with a queue either stops to read the
 * word on every amber row, or learns that amber is usually clerical and stops
 * reading it, and the one they stop reading is the allergy. So the clerical one
 * is a neutral chip now, and it says what it means rather than "Info", which
 * named nothing without the tooltip a thumb cannot produce.
 */
export const WARNING_META: Record<RosterWarning, WarningMeta> = {
  'incomplete-profile': { label: 'Missing parent contact', short: 'No contact', tone: 'neutral' },
  allergy: { label: 'Has allergies on file', short: 'Allergy', tone: 'warn' },
  /*
   * Amber like the allergy, because it has a consequence at the door: this
   * student cannot be checked in — the database itself refuses — until their
   * dead Planning Center record is dealt with on their detail page.
   */
  'record-missing': { label: 'Planning Center record missing — check-in frozen', short: 'Frozen', tone: 'warn' },
};

export function warningLabel(warning: RosterWarning): string {
  return WARNING_META[warning].label;
}
