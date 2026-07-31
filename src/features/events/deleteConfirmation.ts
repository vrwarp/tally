/**
 * The words somebody has to type before a gathering is erased.
 *
 * Every other destructive action in Tally is reversible or narrow. Cancelling
 * puts an event back with one tap; undoing a check-in re-taps the student;
 * taking somebody off the roster deactivates them rather than deleting them.
 * These two are neither. Deleting a night removes the attendance it holds, and
 * deleting a chain removes every night in it — years of them, all at once — and
 * nothing in the app puts any of it back.
 *
 * A second tap is not friction for that. A second tap is what somebody does
 * reflexively when a dialog appears mid-thought, and "Delete" sitting where
 * "Cancel event" was is exactly the muscle memory that gets a Friday erased at
 * five to seven. Typing is different in kind: it cannot be done without reading
 * the box, and the phrase decides how much reading.
 *
 * Two phrases, because the two acts are not the same size:
 *
 *  - One gathering asks for `DELETE`. Short, because the scope is one night and
 *    the count of what goes with it is on screen above the box.
 *  - A whole chain asks for the gathering's own name. Longer by nature, and
 *    longer in the way that matters — it cannot be typed without naming which
 *    of the ministry's gatherings is about to stop existing, so the failure
 *    mode this catches is not "I did not mean to press it" but "I did not mean
 *    *this one*".
 *
 * Matching is forgiving about case and about runs of whitespace, and about
 * nothing else. A phone autocapitalises the first letter of a text field and a
 * name typed at a door picks up a trailing space; neither is evidence that
 * somebody meant a different gathering, and rejecting them teaches people to
 * paste rather than to read.
 */

/** What a single gathering asks for. Not a title — there is one of these. */
export const EVENT_PHRASE = 'DELETE';

/**
 * The fallback when a chain's title is blank.
 *
 * Nothing in the app writes an untitled event, but an import or a seed could,
 * and a confirmation box that asks somebody to type nothing at all is a
 * confirmation that confirms nothing.
 */
export const UNTITLED_CHAIN_PHRASE = 'DELETE EVERY GATHERING';

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export interface ConfirmationTarget {
  scope: 'event' | 'chain';
  /** What the gathering is called. Ignored for a single event. */
  title: string;
}

/** The phrase to show, and the one to check what was typed against. */
export function confirmationPhrase(target: ConfirmationTarget): string {
  if (target.scope === 'event') return EVENT_PHRASE;
  return collapse(target.title) || UNTITLED_CHAIN_PHRASE;
}

/** Whether what somebody typed is the phrase they were asked for. */
export function matchesConfirmation(typed: string, phrase: string): boolean {
  const wanted = collapse(phrase);
  if (wanted.length === 0) return false;
  return collapse(typed).toLocaleLowerCase() === wanted.toLocaleLowerCase();
}
