import type { RosterWarning } from '@/types';

/**
 * The three tones a flag is allowed to wear, loudest last.
 *
 * Deliberately not the `Badge` tone union: `brand` and `success` are not
 * available to a warning at all, and a table that could name them would be a
 * table somebody could reach into for a colour that means "checked in".
 */
export type WarningTone = 'neutral' | 'warn' | 'danger';

export interface WarningMeta {
  /** Full sentence for screen readers and tooltips. */
  label: string;
  /** Two-to-seven characters, for a badge on a roster row. */
  short: string;
  /** The one colour this condition wears, on every screen that shows it. */
  tone: WarningTone;
  /**
   * The mark that goes on the badge, or `null` for the ones that get none.
   *
   * A property rather than something derived from the tone, so that "the ⚠ is
   * the allergy's" is a fact written down once instead of a coincidence that
   * holds until a second condition is painted amber.
   */
  glyph: '⚠' | null;
}

/**
 * Every condition the app flags about a student, and what it is allowed to
 * look like. One row per condition, one tone per row — this table is the only
 * place any of it is decided.
 *
 * The rule it exists to hold:
 *
 * - **Amber and a ⚠ mean a physical consequence at a door.** An allergy is the
 *   only flag in this app that has one, so an allergy is the only flag that
 *   gets either. A counselor in a dim hallway with a queue either stops to read
 *   the 11px word on every amber row, or learns that amber is usually
 *   paperwork and stops reading amber — and the one they stop reading is the
 *   allergy. That is the whole reason "Missing parent contact" is a neutral
 *   chip here, and why it says what it means rather than "Info", which named
 *   nothing without a tooltip a thumb cannot produce.
 * - **Red means the app itself will refuse.** Not "this looks serious" —
 *   Tally does not gate a check-in on paperwork, and a badge that looked like a
 *   stop sign over a missing phone number would be claiming an authority the
 *   app does not have. A dead Planning Center record is the single case where
 *   it is not a claim: the database rejects the write until somebody fixes the
 *   record on the student's detail page, so the row is stating a fact about
 *   what will happen, and it keeps its distance from the allergy amber while
 *   doing it.
 * - **Everything else is a neutral chip.** Clerical, worth knowing, not worth
 *   a colour.
 *
 * The three call sites that used to hand-pick their own tone from this list
 * disagreed with it in all three directions at once, which is how a student's
 * missing phone number ended up amber on one screen and grey on another one
 * navigation away. Read a badge's colour off this table — `warningTone`,
 * `warningGlyph`, `warningShort` — or, better, render `WarningBadge`, which
 * does it for you.
 */
export const WARNING_META: Record<RosterWarning, WarningMeta> = {
  allergy: {
    label: 'Has allergies on file',
    short: 'Allergy',
    tone: 'warn',
    glyph: '⚠',
  },
  'record-missing': {
    label: 'Planning Center record missing — check-in frozen',
    short: 'Frozen',
    tone: 'danger',
    glyph: null,
  },
  'incomplete-profile': {
    label: 'Missing parent contact',
    short: 'No contact',
    tone: 'neutral',
    glyph: null,
  },
};

/**
 * Every flag, loudest first — which is also the order a badge lane should read
 * them in when a student carries more than one.
 *
 * Exported so "does the table cover everything the app flags?" is a question
 * with a runtime answer, not only a `Record<RosterWarning, …>` the compiler
 * checks and a reader has to trust.
 */
export const ROSTER_WARNINGS = [
  'allergy',
  'record-missing',
  'incomplete-profile',
] as const satisfies readonly RosterWarning[];

export function warningLabel(warning: RosterWarning): string {
  return WARNING_META[warning].label;
}

/** The short form for the eye. */
export function warningShort(warning: RosterWarning): string {
  return WARNING_META[warning].short;
}

/** The one colour this condition wears. There is no second opinion. */
export function warningTone(warning: RosterWarning): WarningTone {
  return WARNING_META[warning].tone;
}

/** The mark, or `null`. Only the allergy has one. */
export function warningGlyph(warning: RosterWarning): '⚠' | null {
  return WARNING_META[warning].glyph;
}
