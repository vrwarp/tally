/**
 * The two children the label editor previews against.
 *
 * Two, not one, because a template has two ways to be wrong and a single sample
 * can only show the first. A long name that shrinks or wraps is a *layout*
 * question, and the full child below is built to provoke it. Whether the lines
 * still make sense when half the values are missing is a *template* question —
 * and that one is invisible until somebody with no grade and no allergy walks up
 * to the kiosk, which on most rosters is most people.
 *
 * Their own module rather than constants hanging off `LabelPreview`, which is
 * what the fast-refresh rule wants of a file exporting a component, and which is
 * fair here: `LabelTemplateField` reaches for these to drive its own toggle.
 */
import type { LabelTokenValues } from '@/lib/labelTemplate';

/**
 * A child who exercises the layout rather than flattering it.
 *
 * Long enough to shrink at `xl` on a 62mm label, so a leader sees the machinery
 * work on the sample instead of discovering it on a Bartholomew.
 */
export const SAMPLE_VALUES: LabelTokenValues = {
  firstName: 'Bartholomew',
  lastName: 'Fitzwilliam',
  lastInitial: 'F',
  grade: '8th grade',
  // A real-shaped allergy line rather than the word "Peanuts": most of what is
  // on file is a sentence, and a leader should find that out here rather than on
  // the first child it wraps for.
  allergy: 'Peanuts — EpiPen in his bag',
  eventTitle: 'Sunday Nursery',
  date: 'Aug 9',
  time: '9:04 AM',
};

/**
 * The other child — the one the sample above flatters the template into
 * forgetting.
 *
 * No grade, no allergy, no surname worth an initial. This is where a template
 * misbehaves: lines that vanish, and captions like "Allergy:" left standing with
 * nothing after them. Offering it beside the full sample is what turns
 * `LabelLine.requiresValue` from a checkbox somebody has to reason about into
 * something they can simply look at.
 *
 * Empty strings rather than absent keys, deliberately. Absent is what a kiosk
 * that never looked sends; empty is what it sends for a child who genuinely has
 * nothing on file, and it is that second case a leader is previewing.
 */
export const SPARSE_SAMPLE_VALUES: LabelTokenValues = {
  firstName: 'Ada',
  lastName: '',
  lastInitial: '',
  grade: '',
  allergy: '',
  eventTitle: 'Sunday Nursery',
  date: 'Aug 9',
  time: '9:04 AM',
};
