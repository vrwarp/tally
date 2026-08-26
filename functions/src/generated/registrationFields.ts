/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/registrationFields.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * What a registration field may contain, in one place.
 *
 * These rules were written for the lobby kiosk and enforced in the Cloud
 * Function behind it. The Review screen now edits the same fields — a reviewer
 * correcting the surname a parent fat-fingered on a touchscreen — and a second
 * copy of "a name may not contain digits" is exactly the kind of drift this
 * repo already refuses elsewhere: a form that accepts what the server will
 * refuse wastes a round trip and reports the refusal in a different voice, and
 * a form that refuses what the server accepts silently narrows the product.
 *
 * So: one module, shared verbatim with the functions package through
 * `scripts/sync-functions-shared.mjs`, imported by both the door's validator
 * and the reviewer's form.
 *
 * The shape is `{ ok }` rather than a throw, because the two callers want
 * opposite things from a failure. The server turns it into an
 * `invalid-argument`; the form paints it under the box that caused it, which
 * needs the sentence in hand rather than in a catch. The sentences themselves
 * are the ones the door has always used.
 *
 * Imports nothing, on purpose — that is the price of being shareable.
 */

/** Long enough for any real name, short enough that nothing is a paragraph. */
export const NAME_MAX_LENGTH = 40;

/** Held for the reviewer on the registration record, then sent upstream. */
export const ALLERGIES_MAX_LENGTH = 200;

/**
 * Pre-K through 12th grade: `-1` is Pre-K, `0` is kindergarten.
 *
 * Mirrors `Grade` in src/types/index.ts, which cannot be imported here — this
 * module imports nothing, so that the functions package can take it verbatim.
 */
export const MIN_GRADE = -1;
export const MAX_GRADE = 12;

export type FieldCheck<T> = { ok: true; value: T } | { ok: false; error: string };

function bad<T>(error: string): FieldCheck<T> {
  return { ok: false, error };
}

/**
 * A name as a person typed it on a lobby keyboard, or as a reviewer retyped it
 * on a laptop.
 *
 * Digits are refused rather than stripped: "Room 3" and "555-0123" in a name
 * field are somebody misreading the question, and silently keeping "Room"
 * would put that on a sticker. Apostrophes and hyphens are kept — O'Brien and
 * Anne-Marie are names, and the kiosk keyboard has both keys for this reason.
 *
 * `field` is the subject of the sentence the caller shows, so it reads as
 * "The child's first name is required." from either end.
 */
export function checkName(raw: unknown, field: string): FieldCheck<string> {
  if (typeof raw !== 'string') return bad(`${field} is required.`);
  const value = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (value.length === 0) return bad(`${field} is required.`);
  if (value.length > NAME_MAX_LENGTH) return bad(`${field} is too long.`);
  if (/\d/.test(value)) return bad(`${field} cannot contain numbers.`);
  if (!/\p{L}/u.test(value)) return bad(`${field} needs at least one letter.`);
  return { ok: true, value };
}

/**
 * A grade, or the absence of one.
 *
 * Null is an answer rather than a blank — a child too young for a grade has
 * none — which is why this takes it happily and why nothing downstream
 * substitutes a zero for it. The floor is `-1` and not zero: that is Pre-K,
 * and a door that refused it would refuse the children a nursery registers
 * most.
 */
export function checkGrade(raw: unknown): FieldCheck<number | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (
    // Stryker disable next-line ConditionalExpression: `Number.isInteger` already
    // refuses everything that is not a number, so this clause changes no answer
    // at run time. It is here for the narrowing — without it `raw` is still
    // `unknown` at the comparisons below and at `value: raw`.
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < MIN_GRADE ||
    raw > MAX_GRADE
  ) {
    return bad('grade must be a whole number from -1 (Pre-K) to 12, or null.');
  }
  return { ok: true, value: raw };
}

/**
 * Ten digits, however they were punctuated.
 *
 * A repdigit — 0000000000, 5555555555 — is refused because it is what somebody
 * types to get past a field they do not want to answer, and the whole point of
 * the number is that four of its digits are a key their family will use next
 * week. A leading US country code is dropped rather than refused: 1 followed by
 * ten digits is the same number written longer.
 */
export function checkPhone(raw: unknown): FieldCheck<string> {
  if (typeof raw !== 'string') return bad('A phone number is required.');
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return bad('Enter a 10-digit phone number.');
  // Every digit the same. Spelled out rather than as `/^(\d)\1{9}$/`, which
  // restates the ten the line above has just enforced — and would go on
  // meaning "ten" if that number ever changed.
  if ([...digits].every((digit) => digit === digits[0])) {
    return bad('That does not look like a phone number.');
  }
  return { ok: true, value: digits };
}

/**
 * One allergy note, or nothing.
 *
 * Empty and whitespace both mean "nothing recorded" rather than an empty
 * string, so a note cleared on the Review screen is indistinguishable from one
 * the family never wrote — which is what it is.
 */
export function checkAllergyNote(raw: unknown): FieldCheck<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return bad('allergies must be text.');
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > ALLERGIES_MAX_LENGTH) return bad('That allergy note is too long.');
  return { ok: true, value };
}
